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

// ─── GET ──────────────────────────────────────────────────────────────────────

export async function GET(): Promise<NextResponse> {
  const userId = await getUserId()
  if (!userId) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })
  }

  const accounts = await prisma.account.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    include: { transactions: true },
  })

  const accountOutputs = accounts.map((acc) => {
    const transactionSum = acc.transactions.reduce((sum: number, t: { amount: number }) => sum + t.amount, 0)
    return {
      id: acc.id,
      name: acc.name,
      initialBalance: acc.initialBalance,
      currentBalance: acc.initialBalance + transactionSum,
      currency: acc.currency,
      createdAt: acc.createdAt.toISOString(),
    }
  })

  return NextResponse.json(
    { accounts: accountOutputs },
    { headers: { 'Cache-Control': 'no-store' } }
  )
}

// ─── POST ─────────────────────────────────────────────────────────────────────

export async function POST(req: Request): Promise<NextResponse> {
  const userId = await getUserId()
  if (!userId) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })
  }

  let body: { name?: unknown; initialBalance?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 })
  }

  const { name, initialBalance } = body

  if (typeof name !== 'string' || !name.trim()) {
    return NextResponse.json({ error: 'name (non-empty string) is required' }, { status: 400 })
  }

  const balanceNum = typeof initialBalance === 'number' ? initialBalance : 0

  const account = await prisma.account.create({
    data: {
      userId,
      name: name.trim(),
      initialBalance: balanceNum,
    },
  })

  return NextResponse.json(
    {
      id: account.id,
      name: account.name,
      initialBalance: account.initialBalance,
      currentBalance: account.initialBalance,
      currency: account.currency,
      createdAt: account.createdAt.toISOString(),
    },
    { status: 201, headers: { 'Cache-Control': 'no-store' } }
  )
}
