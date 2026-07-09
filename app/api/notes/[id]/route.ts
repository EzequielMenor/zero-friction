import { NextResponse, type NextRequest } from 'next/server'
import { cookies } from 'next/headers'
import { prisma } from '@/lib/prisma'
import { AUTH_COOKIE, verifySession } from '@/lib/auth'
import { NOTE_SELECT_WITH_TASK_FLAG_PROJECT } from '@/lib/hubs'
import { findOwnProjectOrThrow, buildInvalidProjectIdResponse, logProjectEvent } from '@/lib/projects'
import type { InvalidProjectIdError } from '@/lib/types/project'
import type { Domain } from '@prisma/client'

const VALID_DOMAINS: Domain[] = ['ESPIRITUAL', 'PERSONAL', 'APRENDIZAJE', 'PROYECTOS', 'REGISTROS']

// ─── GET /api/notes/[id] ───────────────────────────────────────────────────────

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const token = (await cookies()).get(AUTH_COOKIE)?.value
  if (!token) {
    return NextResponse.json({ ok: false, error: { code: 'unauthenticated', message: 'No autenticado' } }, { status: 401 })
  }

  const session = await verifySession(token)
  if (!session) {
    return NextResponse.json({ ok: false, error: { code: 'unauthenticated', message: 'No autenticado' } }, { status: 401 })
  }

  const { id } = await ctx.params

  const note = await prisma.note.findFirst({
    where: { id, userId: session.userId },
    select: {
      ...NOTE_SELECT_WITH_TASK_FLAG_PROJECT,
      task: {
        select: {
          id: true, noteId: true, userId: true, status: true,
          dueDate: true, isImportant: true, focusedAt: true,
          completedAt: true, createdAt: true, updatedAt: true,
        },
      },
    },
  })
  if (!note) {
    return NextResponse.json({ ok: false, error: { code: 'not_found', message: 'Nota no encontrada' } }, { status: 404 })
  }

  return NextResponse.json({
    ok: true,
    data: formatNoteItem(note as Record<string, unknown>),
  })
}

// ─── PATCH /api/notes/[id] ─────────────────────────────────────────────────────

export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const token = (await cookies()).get(AUTH_COOKIE)?.value
  if (!token) {
    return NextResponse.json({ ok: false, error: { code: 'unauthenticated', message: 'No autenticado' } }, { status: 401 })
  }

  const session = await verifySession(token)
  if (!session) {
    return NextResponse.json({ ok: false, error: { code: 'unauthenticated', message: 'No autenticado' } }, { status: 401 })
  }

  const { id } = await ctx.params

  // Ownership check
  const existing = await prisma.note.findFirst({
    where: { id, userId: session.userId },
  })
  if (!existing) {
    return NextResponse.json({ ok: false, error: { code: 'not_found', message: 'Nota no encontrada' } }, { status: 404 })
  }

  const body = await req.json().catch(() => ({}))
  const data: Record<string, unknown> = {}

  if (body.title !== undefined) {
    data.title = String(body.title)
  }

  if (body.content !== undefined) {
    data.content = String(body.content)
  }

  if (body.tags !== undefined) {
    if (Array.isArray(body.tags)) {
      data.tags = body.tags.map(String)
    } else {
      return NextResponse.json({ ok: false, error: { code: 'invalid_tags', message: 'Tags inválidos' } }, { status: 400 })
    }
  }

  if (body.domain !== undefined) {
    const domain = body.domain as string
    if (!VALID_DOMAINS.includes(domain as Domain)) {
      return NextResponse.json({ ok: false, error: { code: 'invalid_domain', message: 'Dominio inválido' } }, { status: 400 })
    }
    data.domain = domain
  }

  // Validar projectId opcional
  if (body.projectId !== undefined) {
    if (body.projectId === null) {
      data.projectId = null
      logProjectEvent('note.project.unassigned', { userId: session.userId, noteId: id, previousProjectId: existing.projectId ?? null })
    } else {
      try {
        const project = await findOwnProjectOrThrow(String(body.projectId), session.userId)
        data.projectId = project.id
        logProjectEvent('note.project.assigned', { userId: session.userId, noteId: id, projectId: project.id })
      } catch (err) {
        const error = err as InvalidProjectIdError
        if (error.code === 'invalid_projectId_format' || error.code === 'invalid_projectId_not_found' || error.code === 'invalid_projectId_forbidden') {
          return NextResponse.json(buildInvalidProjectIdResponse(error).body, { status: 400 })
        }
        throw err
      }
    }
  }

  // Rechazar campos de Task en este endpoint
  if (body.dueDate !== undefined || body.isImportant !== undefined || body.status !== undefined) {
    return NextResponse.json(
      { ok: false, error: { code: 'invalid_fields', message: 'Usá PATCH /api/tasks/[id] para dueDate/isImportant' } },
      { status: 400 }
    )
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ ok: false, error: { code: 'no_fields', message: 'No hay campos para actualizar' } }, { status: 400 })
  }

  try {
    await prisma.note.update({ where: { id }, data })
  } catch {
    return NextResponse.json({ ok: false, error: { code: 'update_failed', message: 'Error al actualizar la nota' } }, { status: 500 })
  }

  const updated = await prisma.note.findUnique({
    where: { id },
    select: NOTE_SELECT_WITH_TASK_FLAG_PROJECT,
  })

  return NextResponse.json({
    ok: true,
    data: updated ? formatNoteItem(updated as Record<string, unknown>) : null,
  })
}

// ─── DELETE /api/notes/[id] ────────────────────────────────────────────────────

export async function DELETE(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const token = (await cookies()).get(AUTH_COOKIE)?.value
  if (!token) {
    return NextResponse.json({ ok: false, error: { code: 'unauthenticated', message: 'No autenticado' } }, { status: 401 })
  }

  const session = await verifySession(token)
  if (!session) {
    return NextResponse.json({ ok: false, error: { code: 'unauthenticated', message: 'No autenticado' } }, { status: 401 })
  }

  const { id } = await ctx.params

  const existing = await prisma.note.findFirst({
    where: { id, userId: session.userId },
  })
  if (!existing) {
    return NextResponse.json({ ok: false, error: { code: 'not_found', message: 'Nota no encontrada' } }, { status: 404 })
  }

  await prisma.note.delete({ where: { id } })
  return NextResponse.json({ ok: true, data: { deleted: true } })
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

function formatNoteItem(note: Record<string, unknown>) {
  const n = note as {
    id: string; userId: string; title: string; content: string;
    domain: string; tags: string[]; suggestedGoals: string[];
    noteStatus: string;
    createdAt: Date; updatedAt: Date;
    task?: Record<string, unknown> | null;
    project?: { id: string; name: string; status: string } | null;
  }
  return {
    id: n.id,
    userId: n.userId,
    title: n.title,
    content: n.content,
    domain: n.domain,
    tags: n.tags ?? [],
    suggestedGoals: n.suggestedGoals ?? [],
    noteStatus: n.noteStatus,
    hasTask: Boolean(n.task),
    project: n.project ? { id: n.project.id, name: n.project.name, status: n.project.status } : null,
    createdAt: n.createdAt instanceof Date ? n.createdAt.toISOString() : String(n.createdAt),
    updatedAt: n.updatedAt instanceof Date ? n.updatedAt.toISOString() : String(n.updatedAt),
    task: n.task ? {
      id: n.task.id,
      noteId: n.task.noteId,
      userId: n.task.userId,
      status: n.task.status,
      dueDate: n.task.dueDate instanceof Date ? (n.task.dueDate as Date).toISOString() : (n.task.dueDate as string | null),
      isImportant: n.task.isImportant,
      focusedAt: n.task.focusedAt instanceof Date ? (n.task.focusedAt as Date).toISOString() : (n.task.focusedAt as string | null),
      completedAt: n.task.completedAt instanceof Date ? (n.task.completedAt as Date).toISOString() : (n.task.completedAt as string | null),
      createdAt: n.task.createdAt instanceof Date ? (n.task.createdAt as Date).toISOString() : String(n.task.createdAt),
      updatedAt: n.task.updatedAt instanceof Date ? (n.task.updatedAt as Date).toISOString() : String(n.task.updatedAt),
    } : null,
  }
}
