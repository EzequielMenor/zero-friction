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

// ─── Types ───────────────────────────────────────────────────────────────────

interface CategoryDistribution {
  category: string
  sum: number
  percentage: number
}

interface TransactionOutput {
  id: string
  amount: number
  description: string
  date: string
  category: string
}

interface SubscriptionOutput {
  id: string
  name: string
  amount: number
  dayOfMonth: number
}

// ─── GET ──────────────────────────────────────────────────────────────────────

export async function GET(): Promise<NextResponse> {
  const userId = await getUserId()
  if (!userId) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })
  }

  // Find most recent NOMINA/SUELDO transaction to determine cycle start
  const lastPayroll = await prisma.transaction.findFirst({
    where: {
      userId,
      category: { mode: 'insensitive', in: ['NOMINA', 'SUELDO'] },
    },
    orderBy: { date: 'desc' },
    select: { date: true },
  })

  const startOfCycle = lastPayroll?.date ?? new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)

  // Fetch all transactions since cycle start
  const transactions = await prisma.transaction.findMany({
    where: {
      userId,
      date: { gte: startOfCycle },
    },
    orderBy: { date: 'desc' },
  })

  // Calculate totals
  let totalIncome = 0
  let totalExpenses = 0
  const expensesByCategory: Record<string, number> = {}

  for (const t of transactions) {
    if (t.amount > 0) {
      totalIncome += t.amount
    } else {
      const absAmount = Math.abs(t.amount)
      totalExpenses += absAmount
      expensesByCategory[t.category] = (expensesByCategory[t.category] ?? 0) + absAmount
    }
  }

  // Fetch active subscriptions
  const subscriptions = await prisma.subscription.findMany({
    where: { userId },
    orderBy: { name: 'asc' },
  })

  // Fetch accounts with all historical transactions
  const accounts = await prisma.account.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    include: { transactions: true },
  })

  const accountOutputs = accounts.map((acc) => {
    const transactionSum = acc.transactions.reduce((sum, t) => sum + t.amount, 0)
    return {
      id: acc.id,
      name: acc.name,
      initialBalance: acc.initialBalance,
      currentBalance: acc.initialBalance + transactionSum,
      currency: acc.currency,
    }
  })

  const totalInitialBalance = accountOutputs.reduce((sum, a) => sum + a.initialBalance, 0)

  const netBalance = totalInitialBalance + totalIncome - totalExpenses

  // Category distribution
  const categoryDistribution: CategoryDistribution[] = Object.entries(expensesByCategory).map(
    ([category, sum]) => ({
      category,
      sum,
      percentage: totalExpenses > 0 ? Math.round((sum / totalExpenses) * 10000) / 100 : 0,
    })
  )

  const transactionOutputs: TransactionOutput[] = transactions.map((t) => ({
    id: t.id,
    amount: t.amount,
    description: t.description,
    date: t.date.toISOString(),
    category: t.category,
  }))

  const subscriptionOutputs: SubscriptionOutput[] = subscriptions.map((s) => ({
    id: s.id,
    name: s.name,
    amount: s.amount,
    dayOfMonth: s.dayOfMonth,
  }))

  return NextResponse.json(
    {
      transactions: transactionOutputs,
      totalIncome: Math.round(totalIncome * 100) / 100,
      totalExpenses: Math.round(totalExpenses * 100) / 100,
      netBalance: Math.round(netBalance * 100) / 100,
      categoryDistribution,
      subscriptions: subscriptionOutputs,
      startOfCycle: startOfCycle.toISOString(),
      totalInitialBalance: Math.round(totalInitialBalance * 100) / 100,
      accounts: accountOutputs,
    },
    { headers: { 'Cache-Control': 'no-store' } }
  )
}

// ─── POST ─────────────────────────────────────────────────────────────────────

export async function POST(req: Request): Promise<NextResponse> {
  const userId = await getUserId()
  if (!userId) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })
  }

  let body: { amount?: unknown; description?: unknown; date?: unknown; category?: unknown; accountId?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 })
  }

  const { amount, description, date, category, accountId } = body

  if (typeof amount !== 'number' || typeof description !== 'string' || !description.trim()) {
    return NextResponse.json({ error: 'amount (number) and description (string) are required' }, { status: 400 })
  }

  if (!date || typeof date !== 'string') {
    return NextResponse.json({ error: 'date (string) is required' }, { status: 400 })
  }

  if (typeof category !== 'string' || !category.trim()) {
    return NextResponse.json({ error: 'category (string) is required' }, { status: 400 })
  }

  const validatedAccountId = typeof accountId === 'string' ? accountId : undefined

  if (accountId !== undefined && !validatedAccountId) {
    return NextResponse.json({ error: 'accountId must be a string' }, { status: 400 })
  }

  const parsedDate = new Date(date)
  if (isNaN(parsedDate.getTime())) {
    return NextResponse.json({ error: 'date must be a valid ISO date string' }, { status: 400 })
  }

  const transaction = await prisma.transaction.create({
    data: {
      userId,
      amount,
      description: description.trim(),
      date: parsedDate,
      category: category.trim(),
      accountId: validatedAccountId,
    },
  })

  return NextResponse.json(
    {
      id: transaction.id,
      amount: transaction.amount,
      description: transaction.description,
      date: transaction.date.toISOString(),
      category: transaction.category,
    },
    { status: 201, headers: { 'Cache-Control': 'no-store' } }
  )
}
