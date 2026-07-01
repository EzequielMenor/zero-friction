import { NextResponse, type NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { verifySession, AUTH_COOKIE } from '@/lib/auth'
import { getWhisperForUser } from '@/lib/llm'
import type { ParsedCapture } from '@/lib/parse-capture'
import {
  runCaptureChatCompletion,
  createNoteWithRelations,
} from '@/lib/parse-capture'

// ─── Auth ─────────────────────────────────────────────────────────────────────

async function getUserId(req: NextRequest): Promise<string | null> {
  const token = req.cookies.get(AUTH_COOKIE)?.value
  if (!token) return null
  const session = await verifySession(token)
  return session?.userId ?? null
}

// ─── Whisper ─────────────────────────────────────────────────────────────────

async function transcribeAudio(file: File, userId: string): Promise<string> {
  const arrayBuffer = await file.arrayBuffer()
  const buffer = Buffer.from(arrayBuffer)

  const { client, model } = await getWhisperForUser(userId)
  const transcription = await client.audio.transcriptions.create({
    file: new File([buffer], file.name, { type: file.type }),
    model,
  })

  return transcription.text.trim()
}

// ─── REGISTROS Branch Helpers ─────────────────────────────────────────────────
// These handle REGISTROS-specific record types and stay inline per the design
// (RecordType branching deferred to a follow-up; design decision D8).

async function saveTransaction(
  userId: string,
  parsed: ParsedCapture
): Promise<{ id: string }> {
  const transaction = await prisma.transaction.create({
    data: {
      userId,
      amount: parsed.metadata.recordData.value ?? 0,
      description:
        parsed.metadata.recordData.name ?? parsed.cleanedTitle,
      date: new Date(),
      category: parsed.metadata.recordData.category ?? 'VARIOS',
    },
  })
  return { id: transaction.id }
}

async function saveHabitLog(
  userId: string,
  parsed: ParsedCapture
): Promise<{ id: string }> {
  const habitName = parsed.metadata.recordData.name ?? parsed.cleanedTitle

  let habit = await prisma.habit.findFirst({
    where: { userId, name: { equals: habitName } },
  })

  if (!habit) {
    habit = await prisma.habit.create({
      data: {
        userId,
        name: habitName,
        frequency: 'daily',
      },
    })
  }

  const log = await prisma.habitLog.create({
    data: {
      habitId: habit.id,
      date: new Date(),
      completed: true,
    },
  })

  return { id: log.id }
}

async function saveWorkoutDraft(
  userId: string,
  parsed: ParsedCapture
): Promise<{ id: string }> {
  const note = await prisma.note.create({
    data: {
      userId,
      title: `[GIMNASIO] ${parsed.cleanedTitle}`,
      content: parsed.cleanedContent,
      domain: 'REGISTROS',
      status: 'DRAFT',
      isImportant: parsed.metadata.isImportant,
    },
  })
  return { id: note.id }
}

// ─── Main Handler ─────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  // 1. Auth
  const userId = await getUserId(req)
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const transcribeOnly = req.nextUrl.searchParams.get('transcribeOnly') === 'true'

  // 2. Parse multipart form
  let rawText: string

  const contentType = req.headers.get('content-type') ?? ''
  if (contentType.includes('multipart/form-data')) {
    const formData = await req.formData()

    const textField = formData.get('text')
    const audioField = formData.get('audio')

    if (textField && typeof textField === 'string') {
      rawText = textField.trim()
    } else if (audioField instanceof File && audioField.size > 0) {
      rawText = await transcribeAudio(audioField, userId)
      // transcribeOnly: return the raw transcript immediately — no LLM parse, no DB writes.
      if (transcribeOnly) {
        return NextResponse.json({ text: rawText })
      }
    } else {
      return NextResponse.json(
        { error: 'Provide either a text field or an audio file' },
        { status: 400 }
      )
    }
  } else {
    // Plain text JSON body fallback
    const body = await req.json().catch(() => null)
    rawText = typeof body?.text === 'string' ? body.text.trim() : ''
  }

  // transcribeOnly requested but no audio: echo back whatever text we have.
  if (transcribeOnly) {
    return NextResponse.json({ text: rawText })
  }

  if (!rawText) {
    return NextResponse.json(
      { error: 'No content provided' },
      { status: 400 }
    )
  }

  // 3. Parse via Chat Completion
  let parsed: ParsedCapture
  try {
    parsed = await runCaptureChatCompletion(rawText, userId)
  } catch (err) {
    console.error('Chat Completion error:', err)
    return NextResponse.json(
      { error: 'Failed to process content' },
      { status: 422 }
    )
  }

  // 4. Persist based on domain / recordType
  let entity: { id: string; embedding?: number[] } | null = null

  if (parsed.domain === 'REGISTROS') {
    const recordType = parsed.metadata.recordType

    if (recordType === 'finanzas') {
      entity = await saveTransaction(userId, parsed)
    } else if (recordType === 'habito') {
      entity = await saveHabitLog(userId, parsed)
    } else if (recordType === 'gimnasio') {
      entity = await saveWorkoutDraft(userId, parsed)
    } else {
      // recordType is null or unrecognized — store as Note
      entity = await createNoteWithRelations(userId, parsed)
    }
  } else {
    // ESPIRITUAL, PERSONAL, APRENDIZAJE, PROYECTOS → Note
    entity = await createNoteWithRelations(userId, parsed)
  }

  // 5. Return response
  return NextResponse.json({
    id: entity.id,
    domain: parsed.domain,
    title: parsed.cleanedTitle,
    metadata: parsed.metadata,
  })
}
