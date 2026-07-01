import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { prisma } from '@/lib/prisma'
import { AUTH_COOKIE, verifySession } from '@/lib/auth'
import type { Note } from '@prisma/client'

// ─── Auth helper ───────────────────────────────────────────────────────────────

async function getSession(
  cookieStore: Awaited<ReturnType<typeof cookies>>
): Promise<{ userId: string } | null> {
  const token = cookieStore.get(AUTH_COOKIE)?.value
  if (!token) return null
  return verifySession(token)
}

// ─── POST /api/notes ───────────────────────────────────────────────────────────

export async function POST(req: NextRequest): Promise<NextResponse> {
  const cookieStore = await cookies()
  const session = await getSession(cookieStore)
  if (!session) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })
  }

  const body = await req.json().catch(() => null)
  const text = typeof body?.text === 'string' ? body.text.trim() : ''

  if (!text) {
    return NextResponse.json(
      { error: 'text is required' },
      { status: 400 }
    )
  }

  const note = await prisma.note.create({
    data: {
      userId: session.userId,
      title: text.slice(0, 80),
      content: text,
      domain: 'REGISTROS',
      status: 'DRAFT',
      tags: [],
      suggestedGoals: [],
    },
  })

  return NextResponse.json(
    {
      id: note.id,
      title: note.title,
      status: note.status as Note['status'],
      createdAt: note.createdAt.toISOString(),
    },
    { status: 201 }
  )
}

// ─── GET /api/notes ────────────────────────────────────────────────────────────

export async function GET(
  req: NextRequest
): Promise<NextResponse> {
  const cookieStore = await cookies()
  const session = await getSession(cookieStore)
  if (!session) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })
  }

  const { searchParams } = req.nextUrl
  const status = (searchParams.get('status') ?? 'DRAFT') as Note['status']

  const notes = await prisma.note.findMany({
    where: {
      userId: session.userId,
      status,
    },
    orderBy: { createdAt: 'desc' },
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
      suggestedGoals: true,
    },
  })

  return NextResponse.json(notes)
}
