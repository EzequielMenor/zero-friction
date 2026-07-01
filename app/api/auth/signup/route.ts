import { NextResponse, type NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { hashPassword, signSession, AUTH_COOKIE, cookieOptions } from '@/lib/auth'

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null)
  const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : ''
  const password = typeof body?.password === 'string' ? body.password : ''
  const secretCode = typeof body?.secretCode === 'string' ? body.secretCode : ''

  if (!email || !password || !secretCode) {
    return NextResponse.json({ error: 'email, password and secretCode are required' }, { status: 400 })
  }
  if (password.length < 8) {
    return NextResponse.json({ error: 'password must be at least 8 characters' }, { status: 400 })
  }

  if (secretCode !== process.env.REGISTRATION_SECRET) {
    return NextResponse.json({ error: 'invalid invite code' }, { status: 403 })
  }

  const existing = await prisma.user.findUnique({ where: { email } })
  if (existing) {
    return NextResponse.json({ error: 'email already registered' }, { status: 409 })
  }

  const passwordHash = await hashPassword(password)
  const user = await prisma.user.create({
    data: { email, passwordHash },
    select: { id: true, email: true },
  })

  const token = await signSession({ userId: user.id })
  const res = NextResponse.json({ user }, { status: 201 })
  res.cookies.set(AUTH_COOKIE, token, cookieOptions())
  return res
}