// POST /api/tasks/[id]/focus — enfocar una Task (máximo 1 foco por usuario).

import { NextResponse, type NextRequest } from 'next/server'
import { cookies } from 'next/headers'
import { prisma } from '@/lib/prisma'
import { AUTH_COOKIE, verifySession } from '@/lib/auth'

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
  const userId = session.userId

  try {
    await prisma.$transaction([
      // 1. Desenfocar todas las Tasks del usuario
      prisma.task.updateMany({
        where: { userId, focusedAt: { not: null } },
        data: { focusedAt: null },
      }),
      // 2. Enfocar la nueva (CAS: solo si está OPEN)
      prisma.task.updateMany({
        where: { id, userId, status: 'OPEN' },
        data: { focusedAt: new Date() },
      }),
    ])
  } catch (err: unknown) {
    const e = err as { code?: string }
    // P2002: unique violation (partial unique index: otro foco ya existe)
    if (e.code === 'P2002') {
      return NextResponse.json(
        { ok: false, error: { code: 'focus_race', message: 'Otra tarea ya está en foco. Recargá.' } },
        { status: 409 }
      )
    }
    throw err
  }

  // Leer la Task actualizada
  const task = await prisma.task.findUnique({
    where: { id },
    select: {
      id: true, noteId: true, userId: true, status: true,
      dueDate: true, isImportant: true, focusedAt: true,
      completedAt: true, createdAt: true, updatedAt: true,
    },
  })

  if (!task || task.focusedAt === null) {
    return NextResponse.json(
      { ok: false, error: { code: 'not_open', message: 'La tarea no está abierta o no existe.' } },
      { status: 409 }
    )
  }

  return NextResponse.json({
    ok: true,
    data: {
      ...task,
      dueDate: task.dueDate?.toISOString() ?? null,
      focusedAt: task.focusedAt?.toISOString() ?? null,
      completedAt: task.completedAt?.toISOString() ?? null,
      createdAt: task.createdAt.toISOString(),
      updatedAt: task.updatedAt.toISOString(),
    },
  })
}
