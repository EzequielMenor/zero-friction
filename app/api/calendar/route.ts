import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { prisma } from '@/lib/prisma'
import { AUTH_COOKIE, verifySession } from '@/lib/auth'
import { NOTE_SELECT_NEW_WITH_PROJECT, TASK_SELECT } from '@/lib/hubs'

export async function GET(): Promise<NextResponse> {
  const token = (await cookies()).get(AUTH_COOKIE)?.value
  if (!token) {
    return NextResponse.json({ ok: false, error: { code: 'unauthenticated', message: 'No autenticado' } }, { status: 401 })
  }

  const session = await verifySession(token)
  if (!session) {
    return NextResponse.json({ ok: false, error: { code: 'unauthenticated', message: 'No autenticado' } }, { status: 401 })
  }

  // Obtener Tasks con Note join para el calendario
  const tasks = await prisma.task.findMany({
    where: { userId: session.userId },
    select: {
      ...TASK_SELECT,
      note: { select: NOTE_SELECT_NEW_WITH_PROJECT },
    },
  })

  // Mapear a NoteItem style (para mantener compat con el frontend actual)
  const notes = tasks.map((t) => {
    const noteProject = ((t.note as Record<string, unknown>).project as { id: string; name: string; status: string } | undefined) ?? null
    return {
    id: t.note.id,
    title: t.note.title,
    content: t.note.content,
    domain: t.note.domain,
    noteStatus: t.note.noteStatus,
    tags: t.note.tags,
    dueDate: t.dueDate?.toISOString() ?? null,
    isImportant: t.isImportant,
    hasTask: true,
    taskId: t.id,
    taskStatus: t.status,
    taskDueDate: t.dueDate?.toISOString() ?? null,
    taskIsImportant: t.isImportant,
    project: noteProject ? { id: noteProject.id, name: noteProject.name, status: noteProject.status } : null,
    createdAt: t.note.createdAt.toISOString(),
    updatedAt: t.note.updatedAt.toISOString(),
  }})

  return NextResponse.json(
    { ok: true, data: notes },
    { headers: { 'Cache-Control': 'no-store' } }
  )
}
