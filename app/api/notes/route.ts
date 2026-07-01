import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { prisma } from '@/lib/prisma'
import { AUTH_COOKIE, verifySession } from '@/lib/auth'
import type { Domain, Note, NoteStatus } from '@prisma/client'

// ─── Auth helper ───────────────────────────────────────────────────────────────

async function getSession(
  cookieStore: Awaited<ReturnType<typeof cookies>>
): Promise<{ userId: string } | null> {
  const token = cookieStore.get(AUTH_COOKIE)?.value
  if (!token) return null
  return verifySession(token)
}

const VALID_DOMAINS: Domain[] = ['ESPIRITUAL', 'PERSONAL', 'APRENDIZAJE', 'PROYECTOS', 'REGISTROS']
const VALID_STATUSES: NoteStatus[] = ['DRAFT', 'NEEDS_REVIEW', 'ACTIVE', 'IN_PROGRESS', 'DONE']

// ─── POST /api/notes ───────────────────────────────────────────────────────────

export async function POST(req: NextRequest): Promise<NextResponse> {
  const cookieStore = await cookies()
  const session = await getSession(cookieStore)
  if (!session) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })
  }

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null

  // Structured manual creation — title/content/domain/status present.
  const isStructured =
    body?.title !== undefined ||
    body?.content !== undefined ||
    body?.domain !== undefined

  if (isStructured) {
    const rawTitle = typeof body?.title === 'string' ? body.title.trim() : ''
    const rawContent = typeof body?.content === 'string' ? body.content : ''
    const rawDomain = typeof body?.domain === 'string' ? body.domain : ''
    const rawStatus = typeof body?.status === 'string' ? body.status : ''

    const title = rawTitle.length > 0 ? rawTitle : 'Sin título'
    const content = rawContent

    if (!VALID_DOMAINS.includes(rawDomain as Domain)) {
      return NextResponse.json({ error: 'invalid domain' }, { status: 400 })
    }

    const domain = rawDomain as Domain

    let status: NoteStatus = 'ACTIVE'
    if (rawStatus) {
      if (!VALID_STATUSES.includes(rawStatus as NoteStatus)) {
        return NextResponse.json({ error: 'invalid status' }, { status: 400 })
      }
      status = rawStatus as NoteStatus
    }

    let dueDate: Date | null = null
    if (body?.dueDate) {
      const parsed = new Date(body.dueDate as string)
      if (!isNaN(parsed.getTime())) {
        dueDate = parsed
      }
    }

    const note = await prisma.note.create({
      data: {
        userId: session.userId,
        title,
        content,
        domain,
        status,
        dueDate,
        tags: [],
        suggestedGoals: [],
      },
    })

    return NextResponse.json(
      {
        id: note.id,
        title: note.title,
        content: note.content,
        domain: note.domain,
        status: note.status as Note['status'],
        createdAt: note.createdAt.toISOString(),
      },
      { status: 201 }
    )
  }

  // Quick GTD capture fallback — body.text is required.
  const text = typeof body?.text === 'string' ? body.text.trim() : ''
  if (!text) {
    return NextResponse.json({ error: 'text is required' }, { status: 400 })
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
