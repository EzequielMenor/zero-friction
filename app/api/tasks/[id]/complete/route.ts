// POST /api/tasks/[id]/complete — marcar una Task como DONE.

import { NextResponse, type NextRequest } from 'next/server'
import { cookies } from 'next/headers'
import { prisma } from '@/lib/prisma'
import { AUTH_COOKIE, verifySession } from '@/lib/auth'
import { TASK_SELECT } from '@/lib/hubs'

export async function POST(
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

  const result = await prisma.task.updateMany({
    where: { id, userId: session.userId, status: 'OPEN' },
    data: { status: 'DONE', completedAt: new Date() },
  })

  if (result.count === 0) {
    return NextResponse.json(
      { ok: false, error: { code: 'already_done', message: 'La tarea ya está completada o no existe.' } },
      { status: 409 }
    )
  }

  const task = await prisma.task.findUnique({
    where: { id },
    select: TASK_SELECT,
  })

  return NextResponse.json({
    ok: true,
    data: task ? {
      ...task,
      dueDate: task.dueDate?.toISOString() ?? null,
      focusedAt: task.focusedAt?.toISOString() ?? null,
      completedAt: task.completedAt?.toISOString() ?? null,
      createdAt: task.createdAt.toISOString(),
      updatedAt: task.updatedAt.toISOString(),
    } : null,
  })
}
