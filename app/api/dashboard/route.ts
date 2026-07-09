// GET /api/dashboard — datos completos del dashboard (6 secciones).

import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { prisma } from '@/lib/prisma'
import { AUTH_COOKIE, verifySession } from '@/lib/auth'
import { NOTE_SELECT_NEW_WITH_PROJECT, NOTE_SELECT_WITH_TASK_FLAG } from '@/lib/hubs'

export async function GET(): Promise<NextResponse> {
  const token = (await cookies()).get(AUTH_COOKIE)?.value
  if (!token) {
    return NextResponse.json({ ok: false, error: { code: 'unauthenticated', message: 'No autenticado' } }, { status: 401 })
  }

  const session = await verifySession(token)
  if (!session) {
    return NextResponse.json({ ok: false, error: { code: 'unauthenticated', message: 'No autenticado' } }, { status: 401 })
  }

  const userId = session.userId
  const now = new Date()
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const startOfTomorrow = new Date(startOfToday)
  startOfTomorrow.setDate(startOfTomorrow.getDate() + 1)

  const [
    focusTaskRaw,
    todayTasksRaw,
    maintenanceTasksRaw,
    habits,
    dueSubscription,
    resurgenceNoteRaw,
  ] = await Promise.all([
    // 1. focusTask: única Task con focusedAt != null
    prisma.task.findFirst({
      where: { userId, focusedAt: { not: null } },
      select: {
        id: true, noteId: true, userId: true, status: true,
        dueDate: true, isImportant: true, focusedAt: true,
        completedAt: true, createdAt: true, updatedAt: true,
        note: { select: NOTE_SELECT_NEW_WITH_PROJECT },
      },
    }),

    // 2. todayTasks: Tasks OPEN con dueDate = today
    prisma.task.findMany({
      where: {
        userId,
        status: 'OPEN',
        dueDate: { gte: startOfToday, lt: startOfTomorrow },
      },
      orderBy: [{ isImportant: 'desc' }, { createdAt: 'asc' }],
      select: {
        id: true, noteId: true, userId: true, status: true,
        dueDate: true, isImportant: true, focusedAt: true,
        completedAt: true, createdAt: true, updatedAt: true,
        note: { select: NOTE_SELECT_NEW_WITH_PROJECT },
      },
    }),

    // 3. maintenanceTasks: Tasks OPEN sin dueDate
    prisma.task.findMany({
      where: {
        userId,
        status: 'OPEN',
        dueDate: null,
      },
      orderBy: [{ createdAt: 'desc' }],
      select: {
        id: true, noteId: true, userId: true, status: true,
        dueDate: true, isImportant: true, focusedAt: true,
        completedAt: true, createdAt: true, updatedAt: true,
        note: { select: NOTE_SELECT_NEW_WITH_PROJECT },
      },
    }),

    // 4. Habits (query original)
    prisma.habit.findMany({
      where: { userId },
      orderBy: { createdAt: 'asc' },
    }),

    // 5. Subscription info (query original) — batch-fetch para evitar N+1
    (async () => {
      const dayOfMonth = now.getDate()
      const qualifying = await prisma.subscription.findMany({
        where: { userId, dayOfMonth },
        orderBy: { createdAt: 'asc' },
      })
      if (qualifying.length === 0) return null

      const qualifyingSubIds = qualifying.map((s) => s.id)
      const todayTransactions = await prisma.transaction.findMany({
        where: {
          subscriptionId: { in: qualifyingSubIds },
          date: { gte: startOfToday, lt: startOfTomorrow },
        },
      })
      const txBySubId = new Map(todayTransactions.map((t) => [t.subscriptionId, t]))

      const pending = qualifying.find((sub) => !txBySubId.has(sub.id))
      return pending ? { id: pending.id, name: pending.name, amount: pending.amount } : null
    })(),

    // 6. resurgenceNote: Note ACTIVE con antigüedad > 180 días
    (async () => {
      const cutoff = new Date(now)
      cutoff.setDate(cutoff.getDate() - 180)
      const count = await prisma.note.count({
        where: {
          userId,
          domain: { in: ['ESPIRITUAL', 'PERSONAL'] },
          noteStatus: 'ACTIVE',
          createdAt: { lte: cutoff },
        },
      })
      if (count === 0) return null
      const offset = Math.floor(Math.random() * count)
      const [note] = await prisma.note.findMany({
        where: {
          userId,
          domain: { in: ['ESPIRITUAL', 'PERSONAL'] },
          noteStatus: 'ACTIVE',
          createdAt: { lte: cutoff },
        },
        skip: offset,
        take: 1,
        select: NOTE_SELECT_WITH_TASK_FLAG,
      })
      return note ?? null
    })(),
  ])

  // ── Enrich habits with completedToday (optimización N+1) ──────────────────
  const habitIds = habits.map((h) => h.id)
  const todayLogs = habitIds.length > 0
    ? await prisma.habitLog.findMany({
        where: {
          habitId: { in: habitIds },
          date: { gte: startOfToday, lt: startOfTomorrow },
        },
      })
    : []
  const completedTodaySet = new Set(todayLogs.map((l) => l.habitId))

  const enrichedHabits = habits.map((h) => ({
    id: h.id,
    name: h.name,
    frequency: h.frequency,
    completedToday: completedTodaySet.has(h.id),
  }))

  // ── Formatear respuestas ──────────────────────────────────────────────────
  const formatTaskItem = (t: Record<string, unknown>) => {
    const task = t as {
      id: string; noteId: string; userId: string; status: string;
      dueDate: Date | null; isImportant: boolean; focusedAt: Date | null;
      completedAt: Date | null; createdAt: Date; updatedAt: Date;
    }
    return {
      id: task.id, noteId: task.noteId, userId: task.userId,
      status: task.status,
      dueDate: task.dueDate?.toISOString() ?? null,
      isImportant: task.isImportant,
      focusedAt: task.focusedAt?.toISOString() ?? null,
      completedAt: task.completedAt?.toISOString() ?? null,
      createdAt: task.createdAt.toISOString(),
      updatedAt: task.updatedAt.toISOString(),
    }
  }

  const formatNoteBrief = (n: Record<string, unknown>) => {
    const note = n as {
      id: string; userId: string; title: string; content: string;
      domain: string; tags: string[]; noteStatus: string;
      createdAt: Date; updatedAt: Date;
      project: { id: string; name: string; status: string } | null;
    }
    return {
      id: note.id, userId: note.userId, title: note.title,
      content: note.content, domain: note.domain,
      tags: note.tags ?? [], noteStatus: note.noteStatus,
      hasTask: true, // por definición, un TodayItem tiene Task
      project: note.project ? { id: note.project.id, name: note.project.name, status: note.project.status } : null,
      createdAt: note.createdAt.toISOString(),
      updatedAt: note.updatedAt.toISOString(),
    }
  }

  const formatTodayItem = (raw: Record<string, unknown>) => {
    const item = raw as { note: Record<string, unknown> }
    return {
      task: formatTaskItem(raw),
      note: formatNoteBrief(item.note),
    }
  }

  return NextResponse.json(
    {
      ok: true,
      data: {
        focusTask: focusTaskRaw ? formatTodayItem(focusTaskRaw as unknown as Record<string, unknown>) : null,
        todayTasks: todayTasksRaw.map((t) => formatTodayItem(t as unknown as Record<string, unknown>)),
        maintenanceTasks: maintenanceTasksRaw.map((t) => formatTodayItem(t as unknown as Record<string, unknown>)),
        habits: enrichedHabits,
        dueSubscription,
        resurgenceNote: resurgenceNoteRaw ? {
          id: resurgenceNoteRaw.id,
          title: resurgenceNoteRaw.title,
          content: resurgenceNoteRaw.content,
          domain: resurgenceNoteRaw.domain,
          noteStatus: resurgenceNoteRaw.noteStatus,
          tags: resurgenceNoteRaw.tags ?? [],
          hasTask: Boolean(resurgenceNoteRaw.task),
          createdAt: resurgenceNoteRaw.createdAt.toISOString(),
          updatedAt: resurgenceNoteRaw.updatedAt.toISOString(),
        } : null,
      },
    },
    { headers: { 'Cache-Control': 'no-store' } }
  )
}
