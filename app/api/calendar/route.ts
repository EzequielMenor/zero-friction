import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { prisma } from '@/lib/prisma'
import { AUTH_COOKIE, verifySession } from '@/lib/auth'

// ponytail: returns the full set of notes for the authenticated user.
// The client side buckets them per day and per status — keeping the API
// shape filter-free so adding new dimensions (week view, agenda, etc.)
// does not require a new route.

export async function GET(): Promise<NextResponse> {
  const token = (await cookies()).get(AUTH_COOKIE)?.value
  if (!token) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })
  }

  const session = await verifySession(token)
  if (!session) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })
  }

  const notes = await prisma.note.findMany({
    where: { userId: session.userId },
    select: {
      id: true,
      title: true,
      content: true,
      status: true,
      isImportant: true,
      dueDate: true,
      createdAt: true,
      updatedAt: true,
      domain: true,
      tags: true,
    },
  })

  return NextResponse.json(notes, { headers: { 'Cache-Control': 'no-store' } })
}
