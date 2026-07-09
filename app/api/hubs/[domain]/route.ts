import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { prisma } from '@/lib/prisma'
import { AUTH_COOKIE, verifySession } from '@/lib/auth'
import { NOTE_SELECT_WITH_TASK_FLAG, toDomainEnum } from '@/lib/hubs'

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ domain: string }> }
): Promise<NextResponse> {
  const token = (await cookies()).get(AUTH_COOKIE)?.value
  if (!token) {
    return NextResponse.json({ ok: false, error: { code: 'unauthenticated', message: 'No autenticado' } }, { status: 401 })
  }

  const session = await verifySession(token)
  if (!session) {
    return NextResponse.json({ ok: false, error: { code: 'unauthenticated', message: 'No autenticado' } }, { status: 401 })
  }

  const { domain: slug } = await params
  const domainEnum = toDomainEnum(slug)
  if (!domainEnum) {
    return NextResponse.json({ ok: false, error: { code: 'invalid_domain', message: 'Dominio inválido' } }, { status: 400 })
  }

  const [notes, relationships] = await Promise.all([
    prisma.note.findMany({
      where: { userId: session.userId, domain: domainEnum },
      orderBy: { updatedAt: 'desc' },
      select: { ...NOTE_SELECT_WITH_TASK_FLAG, domain: true },
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
        sourceNote: { select: { ...NOTE_SELECT_WITH_TASK_FLAG, domain: true } },
        targetNote: { select: { ...NOTE_SELECT_WITH_TASK_FLAG, domain: true } },
      },
    }),
  ])

  // Pick the counterpart note from each relationship
  const seen = new Set<string>()
  const relatedItems: (typeof relationships)[number]['sourceNote'][] = []
  for (const rel of relationships) {
    const isSourceInCurrentDomain = rel.sourceNote.domain === domainEnum
    const other = (isSourceInCurrentDomain ? rel.targetNote : rel.sourceNote) as typeof rel.sourceNote
    if (other.domain === domainEnum) continue
    if (!seen.has(other.id)) {
      seen.add(other.id)
      relatedItems.push(other)
    }
  }

  const formattedNotes = notes.map((n: Record<string, unknown>) => formatNoteItem(n))
  const formattedRelated = relatedItems.map((n: Record<string, unknown>) => formatNoteItem(n))

  return NextResponse.json(
    { ok: true, data: { notes: formattedNotes, relatedItems: formattedRelated } },
    { headers: { 'Cache-Control': 'no-store' } }
  )
}

function formatNoteItem(n: Record<string, unknown>) {
  const note = n as {
    id: string; userId: string; title: string; content: string;
    domain: string; tags: string[]; noteStatus: string;
    createdAt: Date; updatedAt: Date;
    task?: { id: string } | null;
  }
  return {
    id: note.id, userId: note.userId, title: note.title,
    content: note.content, domain: note.domain,
    tags: note.tags ?? [], noteStatus: note.noteStatus,
    hasTask: Boolean(note.task),
    createdAt: note.createdAt instanceof Date ? note.createdAt.toISOString() : String(note.createdAt),
    updatedAt: note.updatedAt instanceof Date ? note.updatedAt.toISOString() : String(note.updatedAt),
  }
}
