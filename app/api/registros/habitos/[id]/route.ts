import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { prisma } from '@/lib/prisma'
import { AUTH_COOKIE, verifySession } from '@/lib/auth'

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse | Response> {
  const token = (await cookies()).get(AUTH_COOKIE)?.value
  if (!token) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })
  }

  const session = await verifySession(token)
  if (!session) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })
  }

  const { id } = await params

  // Validate ownership — only delete habits that belong to the calling user.
  // Cascade delete of HabitLog is enforced by the schema (onDelete: Cascade).
  const habit = await prisma.habit.findFirst({
    where: { id, userId: session.userId },
    select: { id: true },
  })

  if (!habit) {
    return NextResponse.json({ error: 'not found' }, { status: 404 })
  }

  await prisma.habit.delete({ where: { id: habit.id } })

  return new Response(null, { status: 204 })
}