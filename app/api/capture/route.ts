import { NextResponse, type NextRequest } from 'next/server'
import { verifySession, AUTH_COOKIE } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { getWhisperForUser } from '@/lib/llm'
import {
  runCaptureChatCompletion,
  createNoteWithRelations,
  createTransactionFromParsed,
  createOrToggleHabitLogFromParsed,
  createWorkoutFromParsed,
  type ParsedCapture,
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

// ─── Main Handler ─────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const userId = await getUserId(req)
  if (!userId) {
    return NextResponse.json({ ok: false, error: { code: 'unauthenticated', message: 'No autorizado' } }, { status: 401 })
  }

  const transcribeOnly = req.nextUrl.searchParams.get('transcribeOnly') === 'true'

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
      if (transcribeOnly) {
        return NextResponse.json({ ok: true, data: { text: rawText } })
      }
    } else {
      return NextResponse.json(
        { ok: false, error: { code: 'no_content', message: 'Proporcioná texto o un archivo de audio' } },
        { status: 400 }
      )
    }
  } else {
    const body = await req.json().catch(() => null)
    rawText = typeof body?.text === 'string' ? body.text.trim() : ''
  }

  if (transcribeOnly) {
    return NextResponse.json({ ok: true, data: { text: rawText } })
  }

  if (!rawText) {
    return NextResponse.json(
      { ok: false, error: { code: 'no_content', message: 'No se proporcionó contenido' } },
      { status: 400 }
    )
  }

  // Parse via Chat Completion
  let parsed: ParsedCapture
  try {
    parsed = await runCaptureChatCompletion(rawText, userId)
  } catch (err) {
    console.error('Chat Completion error:', err)
    return NextResponse.json(
      { ok: false, error: { code: 'ai_failed', message: 'Error al procesar el contenido' } },
      { status: 422 }
    )
  }

  // Persist based on domain / recordType
  let entity: { id: string; kind?: string; embedding?: number[] } | null = null

  if (parsed.domain === 'REGISTROS') {
    const recordType = parsed.metadata.recordType

    if (recordType === 'finanzas' || recordType === 'habito' || recordType === 'gimnasio') {
      entity = await prisma.$transaction(async (tx) => {
        if (recordType === 'finanzas') {
          return await createTransactionFromParsed(tx, userId, parsed)
        } else if (recordType === 'habito') {
          return await createOrToggleHabitLogFromParsed(tx, userId, parsed)
        } else {
          return await createWorkoutFromParsed(tx, userId, parsed)
        }
      })
    } else {
      entity = await createNoteWithRelations(userId, parsed)
    }
  } else {
    entity = await createNoteWithRelations(userId, parsed)
  }

  return NextResponse.json({
    ok: true,
    data: {
      id: entity!.id,
      domain: parsed.domain,
      title: parsed.cleanedTitle,
      kind: entity!.kind,
      metadata: parsed.metadata,
    },
  })
}
