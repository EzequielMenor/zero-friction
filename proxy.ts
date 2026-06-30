// Next.js 16 renamed `middleware.ts` to `proxy.ts` (function name too).
// Protect everything except /login, /signup, the auth API endpoints and static assets.
// Unauthenticated requests are redirected to /login.

import { NextResponse, type NextRequest } from 'next/server'
import { AUTH_COOKIE, verifySession } from '@/lib/auth'

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl
  const token = request.cookies.get(AUTH_COOKIE)?.value

  // Public paths — never redirect.
  if (
    pathname === '/login' ||
    pathname === '/signup' ||
    pathname.startsWith('/api/auth/login') ||
    pathname.startsWith('/api/auth/signup') ||
    pathname.startsWith('/api/auth/logout')
  ) {
    return NextResponse.next()
  }

  // /api/auth/me is exempt from the redirect: it's an endpoint the frontend hits to check
  // the session. Returning HTML would break the JSON contract; let the route return 401 itself.
  if (pathname === '/api/auth/me') {
    return token ? NextResponse.next() : NextResponse.json({ error: 'unauthenticated' }, { status: 401 })
  }

  const session = token ? await verifySession(token) : null

  if (!session) {
    const loginUrl = new URL('/login', request.url)
    loginUrl.searchParams.set('redirect', pathname)
    return NextResponse.redirect(loginUrl)
  }

  return NextResponse.next()
}

export const config = {
  // Run on everything except Next.js internals and static files.
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}