import { NextResponse, type NextRequest } from 'next/server'
import { cookies } from 'next/headers'
import { prisma } from '@/lib/prisma'
import { AUTH_COOKIE, verifySession } from '@/lib/auth'

// ─── Types ────────────────────────────────────────────────────────────────────

type SetType = 'WARMUP_SET' | 'NORMAL_SET' | 'FAILURE_SET' | 'DROPSET_SET' | string

interface SetOutput {
  exerciseName: string
  weight: number
  reps: number
  setType: string
  estimated1RM: number | null
}

interface WorkoutOutput {
  id: string
  title: string
  date: string
  duration: string | null
  volume: number
  sets: SetOutput[]
}

interface VolumeEntry {
  date: string
  volume: number
}

interface PREntry {
  exerciseName: string
  maxWeight: number
  maxReps: number
  max1RM: number
  achievedAt: string
}

// ─── Auth ─────────────────────────────────────────────────────────────────────

async function getUserId(): Promise<string | null> {
  const token = (await cookies()).get(AUTH_COOKIE)?.value
  if (!token) return null
  const session = await verifySession(token)
  return session?.userId ?? null
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const EPLY_COEFF = 1 + 1 / 30 // Epley: weight * (1 + reps/30)

function estimated1RM(weight: number, reps: number): number {
  return weight * EPLY_COEFF ** reps
  // Epley: weight * (1 + reps/30)
  // Using compound formula: weight * (1 + reps/30)
  // But this gives 100*(1+5/30) = 116.67 for 100kg x 5 reps
  // The spec says: weight * (1 + reps / 30)
  return weight * (1 + reps / 30)
}

function is1RMEligible(setType: SetType): boolean {
  return setType === 'WARMUP_SET' || setType === 'NORMAL_SET'
}

// ─── GET ──────────────────────────────────────────────────────────────────────

export async function GET(): Promise<NextResponse> {
  const userId = await getUserId()
  if (!userId) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })
  }

  const [workouts, coachAdvice] = await Promise.all([
    prisma.workout.findMany({
      where: { userId },
      orderBy: { date: 'asc' },
      include: { sets: true },
    }),
    prisma.coachAdvice.findUnique({ where: { userId } }),
  ])

  // Build workout outputs + volume history
  const workoutOutputs: WorkoutOutput[] = []
  const volumeHistory: VolumeEntry[] = []

  for (const w of workouts) {
    let totalVolume = 0
    const setsOut: SetOutput[] = []

    for (const s of w.sets) {
      totalVolume += s.weight * s.reps

      const eligible = is1RMEligible(s.setType as SetType)
      setsOut.push({
        exerciseName: s.exerciseName,
        weight: s.weight,
        reps: s.reps,
        setType: s.setType,
        estimated1RM: eligible ? Math.round(estimated1RM(s.weight, s.reps) * 100) / 100 : null,
      })
    }

    workoutOutputs.push({
      id: w.id,
      title: w.title,
      date: w.date.toISOString(),
      duration: w.duration,
      volume: Math.round(totalVolume * 100) / 100,
      sets: setsOut,
    })

    volumeHistory.push({
      date: w.date.toISOString().substring(0, 10),
      volume: Math.round(totalVolume * 100) / 100,
    })
  }

  // Personal records per exercise
  const prMap = new Map<string, PREntry>()

  for (const w of workouts) {
    for (const s of w.sets) {
      if (!is1RMEligible(s.setType as SetType)) continue

      const e1rm = estimated1RM(s.weight, s.reps)
      const existing = prMap.get(s.exerciseName)

      if (
        !existing ||
        s.weight > existing.maxWeight ||
        s.reps > existing.maxReps ||
        e1rm > existing.max1RM
      ) {
        prMap.set(s.exerciseName, {
          exerciseName: s.exerciseName,
          maxWeight: s.weight,
          maxReps: s.reps,
          max1RM: Math.round(e1rm * 100) / 100,
          achievedAt: w.date.toISOString().substring(0, 10),
        })
      }
    }
  }

  const personalRecords = Array.from(prMap.values()).sort((a, b) => b.max1RM - a.max1RM)

  return NextResponse.json(
    {
      workouts: workoutOutputs,
      volumeHistory,
      personalRecords,
      coachAdvice: coachAdvice?.content ?? null,
    },
    { headers: { 'Cache-Control': 'no-store' } }
  )
}

// ─── DELETE ────────────────────────────────────────────────────────────────────

export async function DELETE(req: NextRequest): Promise<NextResponse> {
  const userId = await getUserId()
  if (!userId) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })
  }

  const id = req.nextUrl.searchParams.get('id')
  if (!id) {
    return NextResponse.json({ error: 'id query param is required' }, { status: 400 })
  }

  const workout = await prisma.workout.findFirst({
    where: { id, userId },
    select: { id: true },
  })

  if (!workout) {
    return NextResponse.json({ error: 'workout not found' }, { status: 404 })
  }

  await prisma.workout.delete({ where: { id } })

  return NextResponse.json(
    { ok: true },
    { headers: { 'Cache-Control': 'no-store' } }
  )
}
