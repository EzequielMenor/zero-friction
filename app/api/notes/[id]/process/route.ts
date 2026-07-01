import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { prisma } from '@/lib/prisma'
import { AUTH_COOKIE, verifySession } from '@/lib/auth'
import { runCaptureChatCompletion, enrichDraftNote } from '@/lib/parse-capture'

// ─── Auth helper ───────────────────────────────────────────────────────────────

async function getSession(
  cookieStore: Awaited<ReturnType<typeof cookies>>
): Promise<{ userId: string } | null> {
  const token = cookieStore.get(AUTH_COOKIE)?.value
  if (!token) return null
  return verifySession(token)
}

// ─── POST /api/notes/[id]/process ──────────────────────────────────────────────

export async function POST(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const cookieStore = await cookies()
  const session = await getSession(cookieStore)
  if (!session) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })
  }

  const { id: noteId } = await ctx.params

  // 1. Ownership check → 404
  const note = await prisma.note.findFirst({
    where: { id: noteId, userId: session.userId },
  })
  if (!note) {
    return NextResponse.json({ error: 'not found' }, { status: 404 })
  }

  // 2. Status guard → 409
  if (note.status !== 'DRAFT') {
    return NextResponse.json({ error: 'not a draft' }, { status: 409 })
  }

  // 3. AI parsing with 15s timeout
  let parsed: Awaited<ReturnType<typeof runCaptureChatCompletion>>
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 15_000)
  try {
    parsed = await runCaptureChatCompletion(note.content, session.userId, controller.signal)
  } catch {
    clearTimeout(timeout)
    if (controller.signal.aborted) {
      return NextResponse.json(
        { error: 'AI_TIMEOUT', noteId, keptStatus: 'DRAFT' },
        { status: 504 }
      )
    }
    // OpenAI or network error
    return NextResponse.json(
      { error: 'AI_FAILED', noteId, keptStatus: 'DRAFT' },
      { status: 502 }
    )
  }
  clearTimeout(timeout)

  // 4. CAS-gated enrichment
  const updated = await enrichDraftNote(noteId, session.userId, parsed)

  if (updated === null) {
    // CAS failed — already processed by a concurrent request
    return NextResponse.json({ alreadyProcessed: true }, { status: 200 })
  }

  // 5. Return enriched note
  return NextResponse.json({
    note: {
      id: updated.id,
      title: updated.title,
      domain: updated.domain,
      status: updated.status,
    },
  })
}
