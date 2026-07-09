import { NextResponse, type NextRequest } from 'next/server'
import { cookies } from 'next/headers'
import { prisma } from '@/lib/prisma'
import { AUTH_COOKIE, verifySession } from '@/lib/auth'

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const token = (await cookies()).get(AUTH_COOKIE)?.value
  if (!token) {
    return NextResponse.json({ ok: false, error: { code: 'unauthenticated', message: 'No autenticado' } }, { status: 401 })
  }

  const session = await verifySession(token)
  if (!session) {
    return NextResponse.json({ ok: false, error: { code: 'unauthenticated', message: 'No autenticado' } }, { status: 401 })
  }

  const { id } = await params

  // Ownership check
  const note = await prisma.note.findFirst({
    where: { id, userId: session.userId },
  })
  if (!note) {
    return NextResponse.json({ ok: false, error: { code: 'not_found', message: 'Nota no encontrada' } }, { status: 404 })
  }

  const body = await req.json().catch(() => null)
  if (typeof body?.goalText !== 'string' || body.goalText.trim() === '') {
    return NextResponse.json({ ok: false, error: { code: 'goalText_required', message: 'El texto del goal es obligatorio' } }, { status: 400 })
  }

  const goalText = body.goalText.trim()

  try {
    const [task] = await prisma.$transaction([
      // Crear Task 1:1 vinculada a la Note origen
      prisma.task.create({
        data: {
          noteId: id,
          userId: session.userId,
          status: 'OPEN',
          isImportant: false,
        },
      }),
      // Remover el goal aceptado de suggestedGoals
      prisma.note.update({
        where: { id },
        data: {
          suggestedGoals: note.suggestedGoals.filter((g) => g !== goalText),
        },
      }),
    ])

    return NextResponse.json({
      ok: true,
      data: {
        id: task.id,
        noteId: task.noteId,
        status: task.status,
        dueDate: task.dueDate?.toISOString() ?? null,
        isImportant: task.isImportant,
        focusedAt: task.focusedAt?.toISOString() ?? null,
        completedAt: task.completedAt?.toISOString() ?? null,
        createdAt: task.createdAt.toISOString(),
        updatedAt: task.updatedAt.toISOString(),
        userId: task.userId,
      },
    }, { status: 201 })
  } catch (err: unknown) {
    const e = err as { code?: string }
    // P2002: UNIQUE violation — la Note ya tiene Task
    if (e.code === 'P2002') {
      const existing = await prisma.task.findUnique({
        where: { noteId: id },
        select: { id: true },
      })
      return NextResponse.json(
        {
          ok: false,
          error: {
            code: 'taskExists',
            message: 'Esta nota ya tiene tarea asociada',
            details: { taskId: existing?.id },
          },
        },
        { status: 409 }
      )
    }
    throw err
  }
}
