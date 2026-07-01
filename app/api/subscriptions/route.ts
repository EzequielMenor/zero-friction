import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { prisma } from '@/lib/prisma'
import { AUTH_COOKIE, verifySession } from '@/lib/auth'

// ─── Auth ─────────────────────────────────────────────────────────────────────

async function getUserId(): Promise<string | null> {
  const token = (await cookies()).get(AUTH_COOKIE)?.value
  if (!token) return null
  const session = await verifySession(token)
  return session?.userId ?? null
}

// ─── POST ─────────────────────────────────────────────────────────────────────

export async function POST(req: Request): Promise<NextResponse> {
  const userId = await getUserId()
  if (!userId) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })
  }

  let body: { name?: unknown; amount?: unknown; dayOfMonth?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 })
  }

  const { name, amount, dayOfMonth } = body

  if (typeof name !== 'string' || !name.trim()) {
    return NextResponse.json({ error: 'name (string) is required' }, { status: 400 })
  }

  if (typeof amount !== 'number' || amount <= 0) {
    return NextResponse.json({ error: 'amount (positive number) is required' }, { status: 400 })
  }

  if (typeof dayOfMonth !== 'number' || dayOfMonth < 1 || dayOfMonth > 31) {
    return NextResponse.json({ error: 'dayOfMonth (integer 1-31) is required' }, { status: 400 })
  }

  const subscription = await prisma.subscription.create({
    data: {
      userId,
      name: name.trim(),
      amount,
      dayOfMonth,
    },
  })

  return NextResponse.json(
    {
      id: subscription.id,
      name: subscription.name,
      amount: subscription.amount,
      dayOfMonth: subscription.dayOfMonth,
    },
    { status: 201, headers: { 'Cache-Control': 'no-store' } }
  )
}
