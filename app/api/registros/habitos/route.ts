import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { prisma } from '@/lib/prisma'
import { AUTH_COOKIE, verifySession } from '@/lib/auth'

// ─── Auth ─────────────────────────────────────────────────────────────────────

async function getUserId(): Promise<string | null> {
  const token = (await cookies()).get(AUTH_COOKIE)?.value
  if (!token) return null
  const session = await verifySession(token)
  return session?.userId ?? null
}

// ─── Types ───────────────────────────────────────────────────────────────────

interface HabitOutput {
  id: string
  name: string
  frequency: string
  streak: number
  logs: string[]
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function toDateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function calculateStreak(completedDates: Set<string>): number {
  const today = new Date()
  today.setHours(0, 0, 0, 0)

  const yesterday = new Date(today)
  yesterday.setDate(yesterday.getDate() - 1)

  // Anchor: start from today if logged today, else yesterday if logged yesterday,
  // else the streak is already broken (more than 1-day gap).
  let cursor: Date
  if (completedDates.has(toDateKey(today))) {
    cursor = today
  } else if (completedDates.has(toDateKey(yesterday))) {
    cursor = yesterday
  } else {
    return 0
  }

  let streak = 0
  while (completedDates.has(toDateKey(cursor))) {
    streak++
    cursor.setDate(cursor.getDate() - 1)
  }
  return streak
}

// ─── GET ──────────────────────────────────────────────────────────────────────

export async function GET(): Promise<NextResponse> {
  const userId = await getUserId()
  if (!userId) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })
  }

  const habits = await prisma.habit.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    include: {
      logs: {
        orderBy: { date: 'desc' },
        select: { date: true },
      },
    },
  })

  const output: HabitOutput[] = habits.map((h) => {
    const completedSet = new Set<string>()
    for (const log of h.logs) {
      completedSet.add(toDateKey(new Date(log.date)))
    }
    return {
      id: h.id,
      name: h.name,
      frequency: h.frequency,
      streak: calculateStreak(completedSet),
      logs: h.logs.map((l) => toDateKey(new Date(l.date))),
    }
  })

  return NextResponse.json(
    { habits: output },
    { headers: { 'Cache-Control': 'no-store' } }
  )
}

// ─── POST ─────────────────────────────────────────────────────────────────────

export async function POST(req: Request): Promise<NextResponse> {
  const userId = await getUserId()
  if (!userId) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })
  }

  let body: { name?: unknown; frequency?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 })
  }

  const { name, frequency } = body

  if (typeof name !== 'string' || !name.trim()) {
    return NextResponse.json({ error: 'name (string) is required' }, { status: 400 })
  }

  // Default to DAILY if missing or invalid — single-habit MVP, no enum needed.
  const safeFrequency =
    typeof frequency === 'string' && frequency.trim() ? frequency.trim().toUpperCase() : 'DAILY'

  const habit = await prisma.habit.create({
    data: {
      userId,
      name: name.trim(),
      frequency: safeFrequency,
    },
  })

  return NextResponse.json(
    {
      id: habit.id,
      name: habit.name,
      frequency: habit.frequency,
      streak: 0,
      logs: [],
    },
    { status: 201, headers: { 'Cache-Control': 'no-store' } }
  )
}