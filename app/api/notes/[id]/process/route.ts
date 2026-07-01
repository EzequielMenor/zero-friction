import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { prisma } from '@/lib/prisma'
import { AUTH_COOKIE, verifySession } from '@/lib/auth'
import {
  runCaptureChatCompletion,
  enrichDraftNote,
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

// ─── REGISTROS branch helpers (Task 5.6) ──────────────────────────────────────
// ponytail: lifted from /api/capture so the async /process endpoint can route
// the same way. Each helper returns the new entity id; the caller deletes the
// original Note via CAS-gated deleteMany so a lost race is a no-op.

async function createTransactionFromParsed(
  userId: string,
  parsed: ParsedCapture
): Promise<{ id: string; kind: 'finanzas' }> {
  const tx = await prisma.transaction.create({
    data: {
      userId,
      amount: parsed.metadata.recordData.value ?? 0,
      description:
        parsed.metadata.recordData.name ?? parsed.cleanedTitle,
      date: new Date(),
      category: parsed.metadata.recordData.category ?? 'VARIOS',
    },
  })
  return { id: tx.id, kind: 'finanzas' }
}

async function createOrToggleHabitLogFromParsed(
  userId: string,
  parsed: ParsedCapture
): Promise<{ id: string; kind: 'habito' }> {
  const habitName = parsed.metadata.recordData.name ?? parsed.cleanedTitle

  // Find-then-create: Habit has no unique index on (userId, name), so a true
  // upsert would need one. Ponytail: matches /api/capture's existing pattern.
  let habit = await prisma.habit.findFirst({
    where: { userId, name: { equals: habitName } },
  })
  if (!habit) {
    habit = await prisma.habit.create({
      data: { userId, name: habitName, frequency: 'daily' },
    })
  }

  // Toggle today's log: create on first hit, flip `completed` thereafter.
  // Ponytail: normalize to midnight so @@unique([habitId, date]) actually works
  // as "one log per day" instead of collapsing to "one log per millisecond".
  const today = new Date()
  today.setHours(0, 0, 0, 0)

  const existing = await prisma.habitLog.findUnique({
    where: { habitId_date: { habitId: habit.id, date: today } },
  })

  const log = existing
    ? await prisma.habitLog.update({
        where: { id: existing.id },
        data: { completed: !existing.completed },
      })
    : await prisma.habitLog.create({
        data: { habitId: habit.id, date: today, completed: true },
      })

  return { id: log.id, kind: 'habito' }
}

async function createWorkoutFromParsed(
  userId: string,
  parsed: ParsedCapture
): Promise<{ id: string; kind: 'gimnasio' }> {
  const exerciseName =
    parsed.metadata.recordData.name ?? parsed.cleanedTitle
  const weight = parsed.metadata.recordData.value ?? 0

  // Workout has @@unique([userId, date]) → one workout per user per day.
  // Ponytail: matches the /api/registros/fuerza/import convention.
  const today = new Date()
  today.setHours(0, 0, 0, 0)

  const workout = await prisma.workout.upsert({
    where: { userId_date: { userId, date: today } },
    create: { userId, title: parsed.cleanedTitle, date: today },
    update: {},
  })

  // ponytail: parse-capture doesn't extract reps, so default to 1. Extend the
  // schema if reps become a hard requirement; right now "did the exercise once"
  // is the closest meaningful truth without hallucinating a number.
  await prisma.workoutSet.create({
    data: {
      workoutId: workout.id,
      exerciseName,
      weight,
      reps: 1,
      setType: 'normal',
    },
  })

  return { id: workout.id, kind: 'gimnasio' }
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
        return NextResponse.json({ alreadyProcessed: true }, { status: 200 })
      }

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
    return NextResponse.json({ alreadyProcessed: true }, { status: 200 })
  }

  return NextResponse.json({
    note: {
      id: updated.id,
      title: updated.title,
      domain: updated.domain,
      status: updated.status,
    },
  })
}
