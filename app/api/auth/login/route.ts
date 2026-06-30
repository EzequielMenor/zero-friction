import { NextResponse, type NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { verifyPassword, signSession, AUTH_COOKIE, cookieOptions } from '@/lib/auth'

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null)
  const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : ''
  const password = typeof body?.password === 'string' ? body.password : ''

  if (!email || !password) {
    return NextResponse.json({ error: 'email and password are required' }, { status: 400 })
  }

  const user = await prisma.user.findUnique({ where: { email } })
  // Constant-time-ish: still hash even on miss to avoid trivial user-enumeration timing.
  if (!user) {
    await verifyPassword(password, '$2a$10$invalidsaltinvalidsaltinvalidsaltinvalidsalti')
    return NextResponse.json({ error: 'invalid credentials' }, { status: 401 })
  }

  const ok = await verifyPassword(password, user.passwordHash)
  if (!ok) {
    return NextResponse.json({ error: 'invalid credentials' }, { status: 401 })
  }

  const token = await signSession({ userId: user.id })
  const res = NextResponse.json({ user: { id: user.id, email: user.email } })
  res.cookies.set(AUTH_COOKIE, token, cookieOptions())
  return res
}