import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { prisma } from '@/lib/prisma'
import { AUTH_COOKIE, verifySession } from '@/lib/auth'
import { NOTE_SELECT } from '@/lib/hubs'

export async function GET(): Promise<NextResponse> {
  const token = (await cookies()).get(AUTH_COOKIE)?.value
  if (!token) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })
  }

  const session = await verifySession(token)
  if (!session) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })
  }

  // ponytail: server-local timezone; per-user tz would need client tz reporting + storage.
  const now = new Date()
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const startOfTomorrow = new Date(startOfToday)
  startOfTomorrow.setDate(startOfTomorrow.getDate() + 1)

  const [
    focusTask,
    todayTasks,
    maintenanceTasks,
    habits,
    dueSubscription,
    resurgenceNote,
  ] = await Promise.all([
    prisma.note.findFirst({
      where: {
        userId: session.userId,
        domain: 'PROYECTOS',
        status: 'IN_PROGRESS',
      },
      select: NOTE_SELECT,
    }),
    prisma.note.findMany({
      where: {
        userId: session.userId,
        domain: 'PROYECTOS',
        status: { in: ['ACTIVE', 'IN_PROGRESS'] },
        dueDate: { gte: startOfToday, lt: startOfTomorrow },
      },
      orderBy: [{ isImportant: 'desc' }, { createdAt: 'asc' }],
      select: NOTE_SELECT,
    }),
    prisma.note.findMany({
      where: {
        userId: session.userId,
        domain: 'PROYECTOS',
        status: { in: ['ACTIVE', 'IN_PROGRESS'] },
        OR: [
          { dueDate: { lt: startOfToday } },
          { dueDate: null, isImportant: true },
        ],
      },
      // ponytail: PG ASC puts NULLs LAST, so overdue (most-overdue first) renders
      // before undated-important. Upgrade path: explicit two-level sort if it matters.
      orderBy: [{ dueDate: 'asc' }, { isImportant: 'desc' }, { createdAt: 'asc' }],
      select: NOTE_SELECT,
    }),
    prisma.habit.findMany({
      where: { userId: session.userId },
      orderBy: { createdAt: 'asc' },
    }),
    (async () => {
      const dayOfMonth = now.getDate()
      const qualifying = await prisma.subscription.findMany({
        where: {
          userId: session.userId,
          dayOfMonth,
        },
        orderBy: { createdAt: 'asc' },
      })
      for (const sub of qualifying) {
        const hasTransaction = await prisma.transaction.findFirst({
          where: {
            subscriptionId: sub.id,
            date: { gte: startOfToday, lt: startOfTomorrow },
          },
        })
        if (!hasTransaction) {
          return { id: sub.id, name: sub.name, amount: sub.amount }
        }
      }
      return null
    })(),
    (async () => {
      const cutoff = new Date(now)
      cutoff.setDate(cutoff.getDate() - 180)
      const count = await prisma.note.count({
        where: {
          userId: session.userId,
          domain: { in: ['ESPIRITUAL', 'PERSONAL'] },
          createdAt: { lte: cutoff },
        },
      })
      if (count === 0) return null
      const offset = Math.floor(Math.random() * count)
      const [note] = await prisma.note.findMany({
        where: {
          userId: session.userId,
          domain: { in: ['ESPIRITUAL', 'PERSONAL'] },
          createdAt: { lte: cutoff },
        },
        skip: offset,
        take: 1,
        select: { id: true, title: true, content: true, createdAt: true },
      })
      return note ?? null
    })(),
  ])

  // Enrich habits with completedToday flag
  const enrichedHabits = await Promise.all(
    habits.map(async (habit) => {
      const log = await prisma.habitLog.findFirst({
        where: {
          habitId: habit.id,
          date: { gte: startOfToday, lt: startOfTomorrow },
        },
      })
      return {
        id: habit.id,
        name: habit.name,
        frequency: habit.frequency,
        completedToday: !!log,
      }
    })
  )

  return NextResponse.json(
    { focusTask, todayTasks, maintenanceTasks, habits: enrichedHabits, dueSubscription, resurgenceNote },
    { headers: { 'Cache-Control': 'no-store' } }
  )
}
