import { NextResponse, type NextRequest } from 'next/server'
import { cookies } from 'next/headers'
import { prisma } from '@/lib/prisma'
import { AUTH_COOKIE, verifySession } from '@/lib/auth'

export async function GET(req: NextRequest) {
  const token = (await cookies()).get(AUTH_COOKIE)?.value
  if (!token) return NextResponse.json({ ok: false, error: { code: 'unauthenticated', message: 'No autenticado' } }, { status: 401 })
  const session = await verifySession(token)
  if (!session) return NextResponse.json({ ok: false, error: { code: 'unauthenticated', message: 'No autenticado' } }, { status: 401 })

  const q = req.nextUrl.searchParams.get('q')?.trim() ?? ''
  if (q.length < 2) return NextResponse.json({ ok: true, data: [] })

  const notes = await prisma.note.findMany({
    where: {
      userId: session.userId,
      OR: [
        { title: { contains: q, mode: 'insensitive' } },
        { content: { contains: q, mode: 'insensitive' } },
      ],
    },
    select: {
      id: true,
      title: true,
      content: true,
      domain: true,
      noteStatus: true,
      tags: true,
      createdAt: true,
      updatedAt: true,
      userId: true,
      task: { select: { id: true, isImportant: true, dueDate: true, status: true } },
    },
    orderBy: { createdAt: 'desc' },
    take: 8,
  })

  return NextResponse.json({
    ok: true,
    data: notes.map((n) => ({
      id: n.id,
      userId: n.userId,
      title: n.title,
      content: n.content,
      domain: n.domain,
      noteStatus: n.noteStatus,
      tags: n.tags,
      hasTask: Boolean(n.task),
      isImportant: n.task?.isImportant ?? false,
      dueDate: n.task?.dueDate?.toISOString() ?? null,
      createdAt: n.createdAt.toISOString(),
      updatedAt: n.updatedAt.toISOString(),
    })),
  })
}
