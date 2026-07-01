import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { prisma } from '@/lib/prisma'
import { AUTH_COOKIE, verifySession } from '@/lib/auth'
import { emitNoteProcessed } from '@/lib/draft-events'
import {
  runCaptureChatCompletion,
  enrichDraftNote,
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
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })
  }

  const { id: noteId } = await ctx.params

  // 1. Ownership check → 404
  const note = await prisma.note.findFirst({
    where: { id: noteId, userId: session.userId },
  })
  if (!note) {
    return NextResponse.json({ error: 'not found' }, { status: 404 })
  }

  // 2. Status guard → 409
  if (note.status !== 'DRAFT') {
    return NextResponse.json({ error: 'not a draft' }, { status: 409 })
  }

  // 3. AI parsing with 15s timeout. On failure: promote DRAFT → NEEDS_REVIEW
  // (Task 5.6) so the note shows up in the user's Review Inbox instead of
  // getting stuck in DRAFT limbo where nobody ever re-tries it.
  let parsed: ParsedCapture
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 15_000)
  try {
    parsed = await runCaptureChatCompletion(
      note.content,
      session.userId,
      controller.signal
    )
  } catch (err) {
    clearTimeout(timeout)
    console.error('[process] AI classification failed for note', noteId, err)
    // ponytail: updateMany with status='DRAFT' is a CAS — survives a concurrent
    // process racing us to delete the note. count=0 just means someone else
    // already promoted / cleaned it; either way the user is taken care of.
    const promoted = await prisma.note.updateMany({
      where: { id: noteId, userId: session.userId, status: 'DRAFT' },
      data: { status: 'NEEDS_REVIEW' },
    })
    emitNoteProcessed({
      noteId,
      domain: 'NEEDS_REVIEW',
      status: 'promoted',
    })
    return NextResponse.json(
      { status: 'promoted', noteId, promotedToReview: true, promotedCount: promoted.count },
      { status: 200 }
    )
  }
  clearTimeout(timeout)

  // 4. REGISTROS branch (Task 5.6): route to the matching structured table,
  // then delete the original Note (CAS-gated to survive concurrent processing).
  if (parsed.domain === 'REGISTROS') {
    const recordType = parsed.metadata.recordType

    if (
      recordType === 'finanzas' ||
      recordType === 'habito' ||
      recordType === 'gimnasio'
    ) {
      let entity: { id: string; kind: string }
      try {
        if (recordType === 'finanzas') {
          entity = await createTransactionFromParsed(session.userId, parsed)
        } else if (recordType === 'habito') {
          entity = await createOrToggleHabitLogFromParsed(session.userId, parsed)
        } else {
          entity = await createWorkoutFromParsed(session.userId, parsed)
        }
      } catch (err) {
        console.error('[process] REGISTROS create failed for note', noteId, err)
        return NextResponse.json(
          { error: 'CREATE_FAILED', noteId, keptStatus: 'DRAFT' },
          { status: 500 }
        )
      }

      const deleted = await prisma.note.deleteMany({
        where: { id: noteId, userId: session.userId, status: 'DRAFT' },
      })

      if (deleted.count === 0) {
        emitNoteProcessed({ noteId, domain: recordType, status: 'already_processed' })
        return NextResponse.json({ alreadyProcessed: true }, { status: 200 })
      }

      emitNoteProcessed({ noteId, domain: recordType, status: 'ok' })

      return NextResponse.json({
        status: 'ok',
        kind: entity.kind,
        entityId: entity.id,
        noteId,
      })
    }
    // REGISTROS without a recognized recordType → fall through to the default
    // Note enrichment path below.
  }

  // 5. Default: ESPIRITUAL / PERSONAL / APRENDIZAJE / PROYECTOS (and REGISTROS
  // fallback) → enrich the Note to ACTIVE via the CAS-gated helper.
  const updated = await enrichDraftNote(noteId, session.userId, parsed)

  if (updated === null) {
    emitNoteProcessed({ noteId, domain: parsed.domain, status: 'already_processed' })
    return NextResponse.json({ alreadyProcessed: true }, { status: 200 })
  }

  emitNoteProcessed({ noteId, domain: updated.domain, status: 'ok' })

  return NextResponse.json({
    note: {
      id: updated.id,
      title: updated.title,
      domain: updated.domain,
      status: updated.status,
    },
  })
}
