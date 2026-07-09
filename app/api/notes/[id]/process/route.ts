import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { prisma } from '@/lib/prisma'
import { AUTH_COOKIE, verifySession } from '@/lib/auth'
import { emitNoteProcessed } from '@/lib/draft-events'
import {
  runCaptureChatCompletion,
  createEmbedding,
  findSimilarNotes,
  createRelationships,
  createTransactionFromParsed,
  createOrToggleHabitLogFromParsed,
  createWorkoutFromParsed,
  type ParsedCapture,
} from '@/lib/parse-capture'

// ─── Auth helper ───────────────────────────────────────────────────────────────

async function getSession(
  cookieStore: Awaited<ReturnType<typeof cookies>>
): Promise<{ userId: string } | null> {
  const token = cookieStore.get(AUTH_COOKIE)?.value
  if (!token) return null
  return verifySession(token)
}

// ─── POST /api/notes/[id]/process ──────────────────────────────────────────────

export async function POST(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const cookieStore = await cookies()
  const session = await getSession(cookieStore)
  if (!session) {
    return NextResponse.json({ ok: false, error: { code: 'unauthenticated', message: 'No autenticado' } }, { status: 401 })
  }

  const { id: noteId } = await ctx.params

  // 1. Ownership + status check
  const note = await prisma.note.findFirst({
    where: { id: noteId, userId: session.userId },
  })
  if (!note) {
    return NextResponse.json({ ok: false, error: { code: 'not_found', message: 'Nota no encontrada' } }, { status: 404 })
  }
  if (note.noteStatus !== 'DRAFT') {
    return NextResponse.json({ ok: false, error: { code: 'not_draft', message: 'La nota no está en borrador' } }, { status: 409 })
  }

  // ── FASE 1: Pre-tx — LLM call (embedding + parse) ────────────────────────
  let parsed: ParsedCapture
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 15_000)
  try {
    parsed = await runCaptureChatCompletion(note.content, session.userId, controller.signal)
  } catch (err) {
    clearTimeout(timeout)
    console.error('[process] AI classification failed for note', noteId, err)
    // Promover a NEEDS_REVIEW con CAS
    const promoted = await prisma.note.updateMany({
      where: { id: noteId, userId: session.userId, noteStatus: 'DRAFT' },
      data: { noteStatus: 'NEEDS_REVIEW' },
    })
    emitNoteProcessed({ noteId, domain: 'NEEDS_REVIEW', status: 'promoted' })
    return NextResponse.json(
      { ok: true, data: { status: 'promoted', noteId, promotedCount: promoted.count } },
      { status: 200 }
    )
  }
  clearTimeout(timeout)

  // ── FASE 2a: REGISTROS branch — entidad estructurada (transaccional) ─────
  if (parsed.domain === 'REGISTROS') {
    const recordType = parsed.metadata.recordType as string | null

    if (recordType === 'finanzas' || recordType === 'habito' || recordType === 'gimnasio') {
      try {
        let entity: { id: string; kind: string }

        // $transaction: crear entidad + borrar Note (CAS-gated)
        await prisma.$transaction(async (tx) => {
          if (recordType === 'finanzas') {
            entity = await createTransactionFromParsed(tx, session.userId, parsed)
          } else if (recordType === 'habito') {
            entity = await createOrToggleHabitLogFromParsed(tx, session.userId, parsed)
          } else {
            entity = await createWorkoutFromParsed(tx, session.userId, parsed)
          }

          const deleted = await tx.note.deleteMany({
            where: { id: noteId, userId: session.userId, noteStatus: 'DRAFT' },
          })
          if (deleted.count === 0) {
            throw new Error('CAS_FAILED')
          }
        })

        emitNoteProcessed({ noteId, domain: recordType, status: 'ok' })
        return NextResponse.json({
          ok: true,
          data: { status: 'ok', kind: entity!.kind, entityId: entity!.id, noteId },
        })
      } catch (err) {
        if (err instanceof Error && err.message === 'CAS_FAILED') {
          emitNoteProcessed({ noteId, domain: recordType, status: 'already_processed' })
          return NextResponse.json({ ok: true, data: { alreadyProcessed: true } })
        }
        console.error('[process] REGISTROS tx failed for note', noteId, err)
        return NextResponse.json(
          { ok: false, error: { code: 'create_failed', message: 'Error al crear el registro' } },
          { status: 500 }
        )
      }
    }
    // REGISTROS sin recordType reconocido → cae al path default
  }

  // ── FASE 2b: Default — enrich Note + (opcional) crear Task ───────────────
  const embedding = await createEmbedding(parsed.cleanedContent, session.userId)
  const isExecutable =
    (parsed.metadata.isImportant === true || parsed.metadata.dueDate != null) &&
    parsed.domain !== 'ESPIRITUAL'

  try {
    await prisma.$transaction(async (tx) => {
      // CAS: updateMany DRAFT → ACTIVE
      const updateResult = await tx.note.updateMany({
        where: { id: noteId, userId: session.userId, noteStatus: 'DRAFT' },
        data: {
          noteStatus: 'ACTIVE',
          title: parsed.cleanedTitle,
          content: parsed.cleanedContent,
          domain: parsed.domain,
          tags: parsed.tags,
          suggestedGoals: parsed.suggestedGoals ?? [],
        },
      })

      if (updateResult.count === 0) {
        throw new Error('ALREADY_PROCESSED')
      }

      // Si es ejecutable, crear Task en la misma tx
      if (isExecutable) {
        await tx.task.create({
          data: {
            noteId,
            userId: session.userId,
            status: 'OPEN',
            dueDate: parsed.metadata.dueDate ? new Date(parsed.metadata.dueDate) : null,
            isImportant: parsed.metadata.isImportant,
          },
        })
      }
    })
  } catch (err) {
    if (err instanceof Error && err.message === 'ALREADY_PROCESSED') {
      emitNoteProcessed({ noteId, domain: parsed.domain, status: 'already_processed' })
      return NextResponse.json({ ok: true, data: { alreadyProcessed: true } })
    }
    // P2002: Task ya existe (posible race con accept-goal)
    const e = err as { code?: string }
    if (e.code === 'P2002') {
      return NextResponse.json(
        { ok: false, error: { code: 'task_exists', message: 'La nota ya tiene una tarea asociada' } },
        { status: 409 }
      )
    }
    console.error('[process] tx failed for note', noteId, err)
    return NextResponse.json(
      { ok: false, error: { code: 'process_failed', message: 'Error al procesar la nota' } },
      { status: 500 }
    )
  }

  // ── FASE 3: Post-tx — embedding + relationships ──────────────────────────
  try {
    await prisma.$executeRaw`
      UPDATE "Note"
      SET embedding = ${embedding}::vector
      WHERE id = ${noteId} AND "noteStatus" = 'ACTIVE'
    `

    const similar = await findSimilarNotes(session.userId, noteId, embedding)
    if (similar.length > 0) {
      await createRelationships(session.userId, noteId, similar)
    }
  } catch (err) {
    console.error('[process] post-tx embedding/rels failed for note', noteId, err)
    // No bloqueante: la Note ya está ACTIVE
  }

  emitNoteProcessed({ noteId, domain: parsed.domain, status: 'ok' })

  // Leer resultado final
  const updated = await prisma.note.findUnique({
    where: { id: noteId },
    select: {
      id: true, userId: true, title: true, content: true, domain: true,
      tags: true, noteStatus: true, createdAt: true, updatedAt: true,
      task: {
        select: {
          id: true, noteId: true, userId: true, status: true,
          dueDate: true, isImportant: true, focusedAt: true,
          completedAt: true, createdAt: true, updatedAt: true,
        },
      },
    },
  })

  if (!updated) {
    return NextResponse.json({ ok: false, error: { code: 'not_found', message: 'Nota no encontrada tras proceso' } }, { status: 500 })
  }

  return NextResponse.json({
    ok: true,
    data: {
      note: {
        id: updated.id,
        userId: updated.userId,
        title: updated.title,
        content: updated.content,
        domain: updated.domain,
        tags: updated.tags,
        noteStatus: updated.noteStatus,
        hasTask: Boolean(updated.task),
        createdAt: updated.createdAt.toISOString(),
        updatedAt: updated.updatedAt.toISOString(),
      },
      task: updated.task ? {
        id: updated.task.id,
        noteId: updated.task.noteId,
        userId: updated.task.userId,
        status: updated.task.status,
        dueDate: updated.task.dueDate?.toISOString() ?? null,
        isImportant: updated.task.isImportant,
        focusedAt: updated.task.focusedAt?.toISOString() ?? null,
        completedAt: updated.task.completedAt?.toISOString() ?? null,
        createdAt: updated.task.createdAt.toISOString(),
        updatedAt: updated.task.updatedAt.toISOString(),
      } : null,
    },
  })
}
