import { NextResponse, type NextRequest } from 'next/server'
import { cookies } from 'next/headers'
import { prisma } from '@/lib/prisma'
import { AUTH_COOKIE, verifySession } from '@/lib/auth'
import { NoteStatus } from '@prisma/client'

const NOTE_SELECT = {
  id: true,
  title: true,
  content: true,
  status: true,
  isImportant: true,
  dueDate: true,
  createdAt: true,
  updatedAt: true,
} as const

const VALID_STATUSES: NoteStatus[] = ['DRAFT', 'NEEDS_REVIEW', 'ACTIVE', 'IN_PROGRESS', 'DONE']

export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const token = (await cookies()).get(AUTH_COOKIE)?.value
  if (!token) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })
  }

  const session = await verifySession(token)
  if (!session) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })
  }

  const { id } = await ctx.params

  // Ownership check
  const existing = await prisma.note.findFirst({
    where: { id, userId: session.userId },
  })
  if (!existing) {
    return NextResponse.json({ error: 'not found' }, { status: 404 })
  }

  const body = await req.json().catch(() => ({}))
  const filteredUpdate: Record<string, unknown> = {}

  if (body.status !== undefined) {
    const status = body.status as string
    if (!VALID_STATUSES.includes(status as NoteStatus)) {
      return NextResponse.json({ error: 'invalid status' }, { status: 400 })
    }
    filteredUpdate.status = status
  }

  if (body.dueDate !== undefined) {
    if (body.dueDate === null) {
      filteredUpdate.dueDate = null
    } else {
      const parsed = new Date(body.dueDate)
      if (isNaN(parsed.getTime())) {
        return NextResponse.json({ error: 'invalid dueDate' }, { status: 400 })
      }
      filteredUpdate.dueDate = parsed
    }
  }

  if (body.isImportant !== undefined) {
    filteredUpdate.isImportant = Boolean(body.isImportant)
  }

  if (body.title !== undefined) {
    filteredUpdate.title = String(body.title)
  }

  if (body.content !== undefined) {
    filteredUpdate.content = String(body.content)
  }

  // If setting to IN_PROGRESS, demote any other IN_PROGRESS note for this user first
  // ponytail: the transaction's result is discarded because we re-read with findUnique
  // to return the canonical shape. Saves duplicating the select.
  if (filteredUpdate.status === 'IN_PROGRESS') {
    try {
      await prisma.$transaction([
        prisma.note.updateMany({
          where: {
            userId: session.userId,
            status: 'IN_PROGRESS',
            id: { not: id },
          },
          data: { status: 'ACTIVE' },
        }),
        prisma.note.update({
          where: { id },
          data: filteredUpdate,
        }),
      ])
    } catch {
      return NextResponse.json({ error: 'Failed to update note' }, { status: 500 })
    }
  } else {
    try {
      await prisma.note.update({ where: { id }, data: filteredUpdate })
    } catch {
      return NextResponse.json({ error: 'Failed to update note' }, { status: 500 })
    }
  }

  const updated = await prisma.note.findUnique({
    where: { id },
    select: NOTE_SELECT,
  })

  return NextResponse.json(updated)
}
