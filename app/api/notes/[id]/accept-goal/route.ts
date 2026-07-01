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
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })
  }

  const session = await verifySession(token)
  if (!session) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })
  }

  const { id } = await params

  // Ownership check
  const note = await prisma.note.findFirst({
    where: { id, userId: session.userId },
  })
  if (!note) {
    return NextResponse.json({ error: 'not found' }, { status: 404 })
  }

  const body = await req.json().catch(() => null)
  if (typeof body?.goalText !== 'string' || body.goalText.trim() === '') {
    return NextResponse.json({ error: 'goalText is required' }, { status: 400 })
  }

  const goalText = body.goalText.trim()

  // Create the goal as a Note in PROYECTOS domain
  const task = await prisma.note.create({
    data: {
      userId: session.userId,
      title: goalText,
      content: '',
      domain: 'PROYECTOS',
      status: 'ACTIVE',
      isImportant: false,
    },
  })

  // Remove the accepted goal from the original note's suggestedGoals
  if (note.suggestedGoals && note.suggestedGoals.length > 0) {
    const updated = note.suggestedGoals.filter((g) => g !== goalText)
    await prisma.note.update({
      where: { id },
      data: { suggestedGoals: updated },
    })
  }

  return NextResponse.json({ id: task.id, title: task.title, status: task.status }, { status: 201 })
}
