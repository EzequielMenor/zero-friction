import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { prisma } from '@/lib/prisma'
import { AUTH_COOKIE, verifySession } from '@/lib/auth'
import { NOTE_SELECT_WITH_TASK_FLAG_PROJECT, TASK_SELECT } from '@/lib/hubs'
import { findOwnProjectOrThrow, buildInvalidProjectIdResponse, logProjectEvent } from '@/lib/projects'
import { CUID_REGEX } from '@/lib/types/project'
import type { InvalidProjectIdError } from '@/lib/types/project'
import type { Domain } from '@prisma/client'

// ─── Auth helper ───────────────────────────────────────────────────────────────

async function getSession(
  cookieStore: Awaited<ReturnType<typeof cookies>>
): Promise<{ userId: string } | null> {
  const token = cookieStore.get(AUTH_COOKIE)?.value
  if (!token) return null
  return verifySession(token)
}

const VALID_DOMAINS: Domain[] = ['ESPIRITUAL', 'PERSONAL', 'APRENDIZAJE', 'PROYECTOS', 'REGISTROS']

// ─── POST /api/notes ───────────────────────────────────────────────────────────

export async function POST(req: NextRequest): Promise<NextResponse> {
  const cookieStore = await cookies()
  const session = await getSession(cookieStore)
  if (!session) {
    return NextResponse.json({ ok: false, error: { code: 'unauthenticated', message: 'No autenticado' } }, { status: 401 })
  }

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null

  // Structured manual creation
  const isStructured =
    body?.title !== undefined ||
    body?.content !== undefined ||
    body?.domain !== undefined

  if (isStructured) {
    const rawTitle = typeof body?.title === 'string' ? body.title.trim() : ''
    const rawContent = typeof body?.content === 'string' ? body.content : ''
    const rawDomain = typeof body?.domain === 'string' ? body.domain : ''

    const title = rawTitle.length > 0 ? rawTitle : 'Sin título'
    const content = rawContent

    if (!VALID_DOMAINS.includes(rawDomain as Domain)) {
      return NextResponse.json({ ok: false, error: { code: 'invalid_domain', message: 'Dominio inválido' } }, { status: 400 })
    }

    const domain = rawDomain as Domain
    const tags = Array.isArray(body?.tags) ? body.tags.map(String) : []
    const suggestedGoals = Array.isArray(body?.suggestedGoals) ? body.suggestedGoals.map(String) : []

    // Validar projectId opcional
    let resolvedProjectId: string | null = null
    const rawProjectId = body?.projectId
    if (rawProjectId !== undefined && rawProjectId !== null) {
      try {
        const project = await findOwnProjectOrThrow(String(rawProjectId), session.userId)
        resolvedProjectId = project.id
      } catch (err) {
        const error = err as InvalidProjectIdError
        if (error.code === 'invalid_projectId_format' || error.code === 'invalid_projectId_not_found' || error.code === 'invalid_projectId_forbidden') {
          return NextResponse.json(buildInvalidProjectIdResponse(error).body, { status: 400 })
        }
        throw err
      }
    }

    // Task fields (opcionales para creación directa desde calendario/panel)
    const hasTaskFields =
      (typeof body?.dueDate === 'string' && body.dueDate.length > 0) ||
      body?.isImportant === true
    const dueDate = typeof body?.dueDate === 'string' && body.dueDate.length > 0
      ? new Date(body.dueDate)
      : null
    const isImportant = body?.isImportant === true

    // Crear Note + (opcional) Task en una transacción
    const result = await prisma.$transaction(async (tx) => {
      const note = await tx.note.create({
        data: {
          userId: session.userId,
          title,
          content,
          domain,
          noteStatus: 'DRAFT', // FIX-J5: siempre DRAFT por defecto
          tags,
          suggestedGoals,
          ...(resolvedProjectId !== null ? { projectId: resolvedProjectId } : {}),
        },
        select: NOTE_SELECT_WITH_TASK_FLAG_PROJECT,
      })

      let task: Record<string, unknown> | null = null
      if (hasTaskFields) {
        task = await tx.task.create({
          data: {
            noteId: note.id,
            userId: session.userId,
            status: 'OPEN',
            dueDate,
            isImportant,
          },
          select: TASK_SELECT,
        }) as unknown as Record<string, unknown>
      }

      return { note, task }
    })

    const formatted = formatNoteItem({ ...result.note, task: result.task } as Record<string, unknown>)

    if (resolvedProjectId) {
      logProjectEvent('note.project.assigned', { userId: session.userId, noteId: result.note.id, projectId: resolvedProjectId })
    }

    return NextResponse.json(
      {
        ok: true,
        data: {
          ...formatted,
          task: result.task ? {
            id: result.task.id,
            noteId: result.task.noteId,
            userId: result.task.userId,
            status: result.task.status,
            dueDate: (result.task.dueDate as Date | null)?.toISOString() ?? null,
            isImportant: result.task.isImportant,
            focusedAt: (result.task.focusedAt as Date | null)?.toISOString() ?? null,
            completedAt: (result.task.completedAt as Date | null)?.toISOString() ?? null,
            createdAt: (result.task.createdAt as Date).toISOString(),
            updatedAt: (result.task.updatedAt as Date).toISOString(),
          } : null,
        },
      },
      { status: 201 }
    )
  }

  // Quick GTD capture fallback — body.text is required.
  const text = typeof body?.text === 'string' ? body.text.trim() : ''
  if (!text) {
    return NextResponse.json({ ok: false, error: { code: 'text_required', message: 'El texto es obligatorio' } }, { status: 400 })
  }

  const note = await prisma.note.create({
    data: {
      userId: session.userId,
      title: text.slice(0, 80),
      content: text,
      domain: 'REGISTROS',
      noteStatus: 'DRAFT',
      tags: [],
      suggestedGoals: [],
    },
  })

  return NextResponse.json(
    {
      ok: true,
      data: {
        id: note.id,
        title: note.title,
        noteStatus: 'DRAFT',
        hasTask: false,
        createdAt: note.createdAt.toISOString(),
        userId: note.userId,
        content: note.content,
        domain: note.domain,
        tags: note.tags,
        updatedAt: note.updatedAt.toISOString(),
      },
    },
    { status: 201 }
  )
}

// ─── GET /api/notes ────────────────────────────────────────────────────────────

export async function GET(
  req: NextRequest
): Promise<NextResponse> {
  const cookieStore = await cookies()
  const session = await getSession(cookieStore)
  if (!session) {
    return NextResponse.json({ ok: false, error: { code: 'unauthenticated', message: 'No autenticado' } }, { status: 401 })
  }

  const { searchParams } = req.nextUrl
  const statusFilter = searchParams.get('status') ?? 'DRAFT'

  // Mapear el status viejo al nuevo noteStatus
  const noteStatusMap: Record<string, string> = {
    DRAFT: 'DRAFT',
    NEEDS_REVIEW: 'NEEDS_REVIEW',
    ACTIVE: 'ACTIVE',
  }

  const noteStatus = noteStatusMap[statusFilter] ?? 'DRAFT'

  const notes = await prisma.note.findMany({
    where: {
      userId: session.userId,
      noteStatus: noteStatus as 'DRAFT' | 'NEEDS_REVIEW' | 'ACTIVE',
    },
    orderBy: { createdAt: 'desc' },
    select: NOTE_SELECT_WITH_TASK_FLAG_PROJECT,
  })

  return NextResponse.json(notes.map(formatNoteItem))
}

function formatNoteItem(note: Record<string, unknown>) {
  const n = note as {
    id: string; userId: string; title: string; content: string;
    domain: string; tags: string[]; suggestedGoals: string[];
    noteStatus: string; createdAt: Date; updatedAt: Date;
    task?: { id: string } | null;
    project?: { id: string; name: string; status: string } | null;
  }
  return {
    id: n.id,
    userId: n.userId,
    title: n.title,
    content: n.content,
    domain: n.domain,
    tags: n.tags,
    suggestedGoals: n.suggestedGoals ?? [],
    noteStatus: n.noteStatus,
    hasTask: Boolean(n.task),
    project: n.project ? { id: n.project.id, name: n.project.name, status: n.project.status } : null,
    createdAt: n.createdAt instanceof Date ? n.createdAt.toISOString() : n.createdAt,
    updatedAt: n.updatedAt instanceof Date ? n.updatedAt.toISOString() : n.updatedAt,
  }
}
