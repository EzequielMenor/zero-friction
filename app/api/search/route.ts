import { NextResponse, type NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { verifySession, AUTH_COOKIE } from '@/lib/auth'

// GET /api/search?q=<text> — case-insensitive title/content search for the current user.
// ponytail: Prisma `contains` + `mode: insensible` instead of a full-text or vector index;
// upgrade to pgvector similarity or Postgres tsvector when `contains` stops scaling.
export async function GET(req: NextRequest) {
  const token = req.cookies.get(AUTH_COOKIE)?.value
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const session = await verifySession(token)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const q = req.nextUrl.searchParams.get('q')?.trim() ?? ''
  if (q.length < 2) return NextResponse.json([])

  const notes = await prisma.note.findMany({
    where: {
      userId: session.userId,
      OR: [
        { title: { contains: q, mode: 'insensitive' } },
        { content: { contains: q, mode: 'insensitive' } },
      ],
    },
    select: {
      id: true,
      title: true,
      content: true,
      domain: true,
      isImportant: true,
      dueDate: true,
      createdAt: true,
    },
    orderBy: { createdAt: 'desc' },
    take: 8,
  })

  return NextResponse.json(notes)
}
