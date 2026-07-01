import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { prisma } from '@/lib/prisma'
import { AUTH_COOKIE, verifySession } from '@/lib/auth'

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const token = (await cookies()).get(AUTH_COOKIE)?.value
  if (!token) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })
  }

  const session = await verifySession(token)
  if (!session) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })
  }

  const { id } = await params

  const habit = await prisma.habit.findFirst({ where: { id, userId: session.userId } })
  if (!habit) {
    return NextResponse.json({ error: 'not found' }, { status: 404 })
  }

  const now = new Date()
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const startOfTomorrow = new Date(startOfToday)
  startOfTomorrow.setDate(startOfTomorrow.getDate() + 1)

  const existingLog = await prisma.habitLog.findFirst({
    where: {
      habitId: habit.id,
      date: { gte: startOfToday, lt: startOfTomorrow },
    },
  })

  if (existingLog) {
    await prisma.habitLog.delete({ where: { id: existingLog.id } })
    return NextResponse.json({ completedToday: false })
  }

  await prisma.habitLog.create({
    data: { habitId: habit.id, date: startOfToday, completed: true },
  })
  return NextResponse.json({ completedToday: true })
}
