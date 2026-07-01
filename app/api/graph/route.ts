import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { prisma } from '@/lib/prisma'
import { AUTH_COOKIE, verifySession } from '@/lib/auth'

export async function GET(_req: Request): Promise<NextResponse> {
  const token = (await cookies()).get(AUTH_COOKIE)?.value
  if (!token) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })
  }

  const session = await verifySession(token)
  if (!session) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })
  }

  const [notes, relationships] = await Promise.all([
    prisma.note.findMany({
      where: { userId: session.userId },
      select: { id: true, title: true, domain: true },
    }),
    prisma.noteRelationship.findMany({
      where: { userId: session.userId },
      select: { sourceNoteId: true, targetNoteId: true, similarity: true },
    }),
  ])

  const nodes = notes.map((n) => ({ id: n.id, title: n.title, domain: n.domain }))
  const links = relationships.map((r) => ({
    source: r.sourceNoteId,
    target: r.targetNoteId,
    similarity: r.similarity ?? 0,
  }))

  return NextResponse.json({ nodes, links }, { headers: { 'Cache-Control': 'no-store' } })
}
