import { NextResponse, type NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { verifySession, AUTH_COOKIE } from '@/lib/auth'
import { getLlmForUser, getWhisperForUser } from '@/lib/llm'

// ─── Types ────────────────────────────────────────────────────────────────────

type RecordType = 'gimnasio' | 'finanzas' | 'habito' | null

interface ParsedCapture {
  domain: 'ESPIRITUAL' | 'PERSONAL' | 'APRENDIZAJE' | 'PROYECTOS' | 'REGISTROS'
  cleanedTitle: string
  cleanedContent: string
  tags: string[]
  suggestedGoals?: string[]
  metadata: {
    dueDate: string | null
    isImportant: boolean
    recordType: RecordType
    recordData: {
      value: number | null
      name: string | null
      unit: string | null
      category: string | null
    }
  }
}

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

// ─── Chat Completion Parser ───────────────────────────────────────────────────

const RESPONSE_SCHEMA = {
  type: 'object',
  required: ['domain', 'cleanedTitle', 'cleanedContent', 'tags', 'metadata'],
  properties: {
    domain: {
      enum: ['ESPIRITUAL', 'PERSONAL', 'APRENDIZAJE', 'PROYECTOS', 'REGISTROS'],
    },
    cleanedTitle: { type: 'string' },
    cleanedContent: { type: 'string' },
    tags: { type: 'array', items: { type: 'string' }, minItems: 2, maxItems: 4 },
    suggestedGoals: {
      type: 'array',
      items: { type: 'string' },
      minItems: 1,
      maxItems: 2,
    },
    metadata: {
      type: 'object',
      properties: {
        dueDate: { type: ['string', 'null'] },
        isImportant: { type: 'boolean' },
        recordType: { type: ['string', 'null'] },
        recordData: {
          type: 'object',
          properties: {
            value: { type: ['number', 'null'] },
            name: { type: ['string', 'null'] },
            unit: { type: ['string', 'null'] },
            category: { type: ['string', 'null'] },
          },
        },
      },
    },
  },
}

const SYSTEM_PROMPT =
  'You are a note processing assistant. ' +
  '1. Clean the text (correct transcription errors, strip control metadata like dates, "!", or commands). ' +
  '2. Classify it into one of 5 domains: ESPIRITUAL, PERSONAL, APRENDIZAJE, PROYECTOS, REGISTROS. ' +
  '3. Extract metadata: dueDate (ISO string YYYY-MM-DD, or null), isImportant (boolean). ' +
  '4. If domain is REGISTROS, classify as: gimnasio, finanzas, or habito. ' +
  '5. If REGISTROS+finanzas, extract: value (number), name/description, category (or GASTOS_FIJOS). ' +
  '6. If REGISTROS+habito, extract: name, category (e.g. "salud", "productividad"). ' +
  '7. If REGISTROS+gimnasio, extract: exercise name, weight, reps, sets, or mark as needs_review. ' +
  '8. Extract 2-4 thematic tags (e.g. ["Paciencia", "Gálatas"] or ["NextJS", "Prisma"]) — these are short topic/theme labels, NOT sentences. ' +
  '9. If domain is ESPIRITUAL, also extract 1-2 concrete actionable personal-application goals based on the study content (e.g. ["Aplicar Gálatas 5:22-23 en mis relaciones esta semana"]). ' +
  '10. Return ONLY valid JSON matching the schema: ' +
  JSON.stringify(RESPONSE_SCHEMA) +
  '. Do not add any text before or after the JSON.'

const USER_PROMPT = (rawText: string) =>
  `Process this note:\n\n${rawText}`

async function parseCapture(rawText: string, userId: string): Promise<ParsedCapture> {
  const { client, model } = await getLlmForUser(userId)
  const completion = await client.chat.completions.create({
    model,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: USER_PROMPT(rawText) },
    ],
    response_format: { type: 'json_object' },
    temperature: 0.1,
  })

  const content = completion.choices[0]?.message?.content
  if (!content) {
    throw new Error('No response from Chat Completion')
  }

  return JSON.parse(content) as ParsedCapture
}

// ─── Embeddings ────────────────────────────────────────────────────────────────

async function createEmbedding(text: string, userId: string): Promise<number[]> {
  const { client, embeddingModel } = await getLlmForUser(userId)
  const response = await client.embeddings.create({
    model: embeddingModel,
    input: text,
  })
  return response.data[0].embedding
}

// ─── Persistence ─────────────────────────────────────────────────────────────

async function saveNote(
  userId: string,
  parsed: ParsedCapture
): Promise<{ id: string; embedding: number[] }> {
  const note = await prisma.note.create({
    data: {
      userId,
      title: parsed.cleanedTitle,
      content: parsed.cleanedContent,
      domain: parsed.domain,
      dueDate: parsed.metadata.dueDate
        ? new Date(parsed.metadata.dueDate)
        : null,
      isImportant: parsed.metadata.isImportant,
      tags: parsed.tags ?? [],
      suggestedGoals: parsed.suggestedGoals ?? [],
    },
  })

  const embedding = await createEmbedding(parsed.cleanedContent, userId)

  // Save embedding via raw SQL (Prisma doesn't support vector type)
  await prisma.$executeRaw`
    UPDATE "Note"
    SET embedding = ${embedding}::vector
    WHERE id = ${note.id}
  `

  return { id: note.id, embedding }
}

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

  // Find or create the habit
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
  // Create a Note with DRAFT status for gym workouts that need verification
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

// ─── Similarity Search & Relationships ────────────────────────────────────────

async function findSimilarNotes(
  userId: string,
  noteId: string,
  embedding: number[]
): Promise<Array<{ id: string; similarity: number }>> {
  const similar = await prisma.$queryRaw<Array<{ id: string; similarity: number }>>`
    SELECT id, 1 - (embedding <=> ${embedding}::vector) as similarity
    FROM "Note"
    WHERE "userId" = ${userId} AND id != ${noteId}
    ORDER BY embedding <=> ${embedding}::vector
    LIMIT 3
  `
  return similar
}

async function createRelationships(
  userId: string,
  sourceNoteId: string,
  similarNotes: Array<{ id: string; similarity: number }>
): Promise<void> {
  await prisma.$transaction(
    similarNotes.map(({ id: targetNoteId, similarity }) =>
      prisma.noteRelationship.upsert({
        where: {
          sourceNoteId_targetNoteId: { sourceNoteId, targetNoteId },
        },
        update: { similarity },
        create: {
          userId,
          sourceNoteId,
          targetNoteId,
          similarity,
          isManual: false,
        },
      })
    )
  )
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
    parsed = await parseCapture(rawText, userId)
  } catch (err) {
    console.error('Chat Completion error:', err)
    return NextResponse.json(
      { error: 'Failed to process content' },
      { status: 422 }
    )
  }

  // 4. Persist based on domain
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
      entity = await saveNote(userId, parsed)
    }
  } else {
    // ESPIRITUAL, PERSONAL, APRENDIZAJE, PROYECTOS → Note
    entity = await saveNote(userId, parsed)
  }

  // 5. Embedding + Relationships (only for Notes)
  if ('embedding' in entity && entity.embedding) {
    const similarNotes = await findSimilarNotes(
      userId,
      entity.id,
      entity.embedding
    )

    if (similarNotes.length > 0) {
      await createRelationships(userId, entity.id, similarNotes)
    }
  }

  // 6. Return response
  return NextResponse.json({
    id: entity.id,
    domain: parsed.domain,
    title: parsed.cleanedTitle,
    metadata: parsed.metadata,
  })
}
