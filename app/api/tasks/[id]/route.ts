// PATCH /api/tasks/[id] — actualizar campos de Task (dueDate, isImportant).

import { NextResponse, type NextRequest } from 'next/server'
import { cookies } from 'next/headers'
import { prisma } from '@/lib/prisma'
import { AUTH_COOKIE, verifySession } from '@/lib/auth'
import { TASK_SELECT } from '@/lib/hubs'

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
  const existing = await prisma.task.findFirst({
    where: { id, userId: session.userId },
  })
  if (!existing) {
    return NextResponse.json({ ok: false, error: { code: 'not_found', message: 'Tarea no encontrada' } }, { status: 404 })
  }

  const body = await req.json().catch(() => ({}))
  const data: Record<string, unknown> = {}

  if (body.dueDate !== undefined) {
    if (body.dueDate === null) {
      data.dueDate = null
    } else {
      const parsed = new Date(body.dueDate)
      if (isNaN(parsed.getTime())) {
        return NextResponse.json({ ok: false, error: { code: 'invalid_dueDate', message: 'Fecha inválida' } }, { status: 400 })
      }
      data.dueDate = parsed
    }
  }

  if (body.isImportant !== undefined) {
    data.isImportant = Boolean(body.isImportant)
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ ok: false, error: { code: 'no_fields', message: 'No hay campos para actualizar' } }, { status: 400 })
  }

  const updated = await prisma.task.update({
    where: { id },
    data,
    select: TASK_SELECT,
  })

  return NextResponse.json({
    ok: true,
    data: {
      ...updated,
      dueDate: updated.dueDate?.toISOString() ?? null,
      focusedAt: updated.focusedAt?.toISOString() ?? null,
      completedAt: updated.completedAt?.toISOString() ?? null,
      createdAt: updated.createdAt.toISOString(),
      updatedAt: updated.updatedAt.toISOString(),
    },
  })
}
