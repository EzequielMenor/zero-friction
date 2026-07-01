import { NextResponse } from 'next/server'
import { AUTH_COOKIE, cookieOptions } from '@/lib/auth'

export async function POST() {
  const res = NextResponse.json({ ok: true })
  res.cookies.set(AUTH_COOKIE, '', { ...cookieOptions(), maxAge: 0 })
  return res
}