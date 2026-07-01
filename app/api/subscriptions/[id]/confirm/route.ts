import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { prisma } from '@/lib/prisma'
import { AUTH_COOKIE, verifySession } from '@/lib/auth'

export async function POST(
  req: Request,
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

  const subscription = await prisma.subscription.findFirst({
    where: { id, userId: session.userId },
  })
  if (!subscription) {
    return NextResponse.json({ error: 'not found' }, { status: 404 })
  }

  const body = await req.json()
  if (typeof body.confirmed !== 'boolean') {
    return NextResponse.json({ error: 'invalid body' }, { status: 400 })
  }

  if (body.confirmed === false) {
    return NextResponse.json({ ok: true, confirmed: false })
  }

  const now = new Date()
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate())

  const transaction = await prisma.transaction.create({
    data: {
      userId: session.userId,
      amount: -Math.abs(subscription.amount),
      description: subscription.name,
      category: 'GASTOS_FIJOS',
      date: startOfToday,
      subscriptionId: subscription.id,
    },
  })

  return NextResponse.json({ ok: true, confirmed: true, transactionId: transaction.id })
}
