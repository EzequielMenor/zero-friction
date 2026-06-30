import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { prisma } from '@/lib/prisma'
import { AUTH_COOKIE, verifySession } from '@/lib/auth'
import { NOTE_SELECT, toDomainEnum } from '@/lib/hubs'

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ domain: string }> }
): Promise<NextResponse> {
  const token = (await cookies()).get(AUTH_COOKIE)?.value
  if (!token) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })
  }

  const session = await verifySession(token)
  if (!session) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })
  }

  const { domain: slug } = await params
  const domainEnum = toDomainEnum(slug)
  if (!domainEnum) {
    return NextResponse.json({ error: 'invalid domain' }, { status: 400 })
  }

  const [notes, relationships] = await Promise.all([
    prisma.note.findMany({
      where: { userId: session.userId, domain: domainEnum },
      orderBy: { updatedAt: 'desc' },
      select: { ...NOTE_SELECT, domain: true },
    }),
    prisma.noteRelationship.findMany({
      where: {
        userId: session.userId,
        OR: [
          { sourceNote: { domain: domainEnum } },
          { targetNote: { domain: domainEnum } },
        ],
      },
      include: {
        sourceNote: { select: { ...NOTE_SELECT, domain: true } },
        targetNote: { select: { ...NOTE_SELECT, domain: true } },
      },
    }),
  ])

  // Pick the counterpart note from each relationship (the one whose domain !== current)
  const seen = new Set<string>()
  const relatedItems: (typeof relationships)[number]['sourceNote'][] = []
  for (const rel of relationships) {
    // ponytail: if both notes somehow share the same domain (edge case from re-capture),
    // this guard filters out the leak before it reaches relatedItems.
    const isSourceInCurrentDomain: boolean = rel.sourceNote.domain === domainEnum
    const other: typeof rel.sourceNote = isSourceInCurrentDomain ? rel.targetNote : rel.sourceNote
    if (other.domain === domainEnum) continue
    if (!seen.has(other.id)) {
      seen.add(other.id)
      relatedItems.push(other)
    }
  }

  return NextResponse.json(
    { notes, relatedItems },
    { headers: { 'Cache-Control': 'no-store' } }
  )
}
