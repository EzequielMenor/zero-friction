/**
 * lib/parse-capture.ts
 *
 * Extracted AI parsing, embedding, and note-creation logic from POST /api/capture.
 * Pure refactor — no behavior change. Consumed by the capture route.
 *
 * @module parse-capture
 */

import { prisma } from '@/lib/prisma'
import { getLlmForUser } from '@/lib/llm'

// ─── Types ────────────────────────────────────────────────────────────────────

type RecordType = 'gimnasio' | 'finanzas' | 'habito' | null

/**
 * Result of AI parsing a raw capture text.
 */
export interface ParsedCapture {
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

// ─── AI Prompt Constants ───────────────────────────────────────────────────────

/** JSON schema for Chat Completion response — mirrors ParsedCapture shape. */
export const RESPONSE_SCHEMA = {
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
} as const

/**
 * System prompt for the capture-parsing Chat Completion.
 */
export const SYSTEM_PROMPT =
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

/** User-prompt factory — wraps raw capture text. */
export const USER_PROMPT = (rawText: string): string =>
  `Process this note:\n\n${rawText}`

// ─── Chat Completion ───────────────────────────────────────────────────────────

/**
 * Parse raw capture text via Chat Completion.
 * Returns a fully-typed ParsedCapture object.
 *
 * @param rawText - The raw text (or transcribed audio) to parse
 * @param userId  - Authenticated user ID, used to resolve per-user LLM config
 * @param signal  - Optional AbortSignal for timeout/cancellation (e.g. 15s limit)
 */
export async function runCaptureChatCompletion(
  rawText: string,
  userId: string,
  signal?: AbortSignal
): Promise<ParsedCapture> {
  const { client, model } = await getLlmForUser(userId)
  const completion = await client.chat.completions.create(
    {
      model,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: USER_PROMPT(rawText) },
      ],
      response_format: { type: 'json_object' },
      temperature: 0.1,
    },
    { signal }
  )

  const content = completion.choices[0]?.message?.content
  if (!content) {
    throw new Error('No response from Chat Completion')
  }

  return JSON.parse(content) as ParsedCapture
}

// ─── Embeddings ────────────────────────────────────────────────────────────────

/**
 * Generate an embedding vector for the given text.
 *
 * @param text   - Text to embed
 * @param userId - Authenticated user ID, used to resolve per-user embedding model
 */
export async function createEmbedding(text: string, userId: string): Promise<number[]> {
  const { client, embeddingModel } = await getLlmForUser(userId)
  const response = await client.embeddings.create({
    model: embeddingModel,
    input: text,
  })
  return response.data[0].embedding
}

// ─── Note Persistence ──────────────────────────────────────────────────────────

/**
 * Create a Note and persist its embedding + relationships.
 * Used by the existing /api/capture route (CREATE path).
 *
 * @param userId - Authenticated user ID
 * @param parsed - AI-parsed capture result
 * @returns The created Note's id and embedding vector
 */
export async function createNoteWithRelations(
  userId: string,
  parsed: ParsedCapture
): Promise<{ id: string; embedding: number[] }> {
  const note = await prisma.note.create({
    data: {
      userId,
      title: parsed.cleanedTitle,
      content: parsed.cleanedContent,
      domain: parsed.domain,
      dueDate: parsed.metadata.dueDate ? new Date(parsed.metadata.dueDate) : null,
      isImportant: parsed.metadata.isImportant,
      tags: parsed.tags ?? [],
      suggestedGoals: parsed.suggestedGoals ?? [],
    },
  })

  const embedding = await createEmbedding(parsed.cleanedContent, userId)

  // Save embedding via raw SQL (Prisma does not support vector type)
  await prisma.$executeRaw`
    UPDATE "Note"
    SET embedding = ${embedding}::vector
    WHERE id = ${note.id}
  `

  const similarNotes = await findSimilarNotes(userId, note.id, embedding)

  if (similarNotes.length > 0) {
    await createRelationships(userId, note.id, similarNotes)
  }

  return { id: note.id, embedding }
}

// ─── Similarity Search ─────────────────────────────────────────────────────────

/**
 * Find the 3 most similar existing notes for a given note + embedding.
 * Uses pgvector's cosine distance operator (<=>).
 *
 * @param userId   - Authenticated user ID
 * @param noteId   - Source note ID (excluded from results)
 * @param embedding - Embedding vector for the source note
 */
export async function findSimilarNotes(
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

// ─── DRAFT Enrichment (UPDATE path) ───────────────────────────────────────────

/**
 * CAS-gated update of a DRAFT note to ACTIVE.
 * Used by POST /api/notes/[id]/process.
 *
 * Race: two concurrent requests. First wins CAS (DRAFT→ACTIVE), second sees
 * count=0 and returns null. Embedding write is gated by the same CAS guard
 * via the raw SQL WHERE status='ACTIVE' condition.
 *
 * @param noteId  - DRAFT note ID
 * @param userId  - Authenticated user ID
 * @param parsed  - AI-parsed capture result
 * @returns Updated Note or null when CAS fails (already processed)
 */
export async function enrichDraftNote(
  noteId: string,
  userId: string,
  parsed: ParsedCapture
): Promise<import('@prisma/client').Note | null> {
  // 1. Generate embedding first (before CAS so we only compute if we'll use it)
  const embedding = await createEmbedding(parsed.cleanedContent, userId)

  // 2. CAS-gated update: only succeeds if note is still DRAFT
  const result = await prisma.note.updateMany({
    where: {
      id: noteId,
      userId,
      status: 'DRAFT',
    },
    data: {
      status: 'ACTIVE',
      domain: parsed.domain,
      title: parsed.cleanedTitle,
      content: parsed.cleanedContent,
      tags: parsed.tags,
      suggestedGoals: parsed.suggestedGoals ?? [],
      dueDate: parsed.metadata.dueDate ? new Date(parsed.metadata.dueDate) : null,
      isImportant: parsed.metadata.isImportant,
    },
  })

  // CAS failed — note is no longer DRAFT (already processed)
  if (result.count === 0) {
    return null
  }

  // 3. Embedding write — guarded by status='ACTIVE' to survive lost races
  await prisma.$executeRaw`
    UPDATE "Note"
    SET embedding = ${embedding}::vector
    WHERE id = ${noteId} AND status = 'ACTIVE'
  `

  // 4. Similarity + relationships
  const similar = await findSimilarNotes(userId, noteId, embedding)
  if (similar.length > 0) {
    await createRelationships(userId, noteId, similar)
  }

  // 5. Return the updated note
  return prisma.note.findUnique({ where: { id: noteId } })
}

// ─── Relationships ─────────────────────────────────────────────────────────────

/**
 * Create or update NoteRelationship records linking a source note to its
 * most-similar neighbours.
 *
 * @param userId      - Authenticated user ID
 * @param sourceNoteId - Source note ID
 * @param similarNotes - Array of { id, similarity } for target notes
 */
export async function createRelationships(
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

// ─── REGISTROS helpers ──────────────────────────────────────────────────────────

/** Persist a finanzas transaction from AI-parsed capture. */
export async function createTransactionFromParsed(
  userId: string,
  parsed: ParsedCapture
): Promise<{ id: string; kind: 'finanzas' }> {
  const tx = await prisma.transaction.create({
    data: {
      userId,
      amount: parsed.metadata.recordData.value ?? 0,
      description:
        parsed.metadata.recordData.name ?? parsed.cleanedTitle,
      date: new Date(),
      category: parsed.metadata.recordData.category ?? 'VARIOS',
    },
  })
  return { id: tx.id, kind: 'finanzas' }
}

/**
 * Toggle today's habit log — create on first hit, flip `completed` thereafter.
 * Normalises the date to midnight so @@unique([habitId, date]) works as "one log per day".
 */
export async function createOrToggleHabitLogFromParsed(
  userId: string,
  parsed: ParsedCapture
): Promise<{ id: string; kind: 'habito' }> {
  const habitName = parsed.metadata.recordData.name ?? parsed.cleanedTitle

  let habit = await prisma.habit.findFirst({
    where: { userId, name: { equals: habitName } },
  })
  if (!habit) {
    habit = await prisma.habit.create({
      data: { userId, name: habitName, frequency: 'daily' },
    })
  }

  const today = new Date()
  today.setHours(0, 0, 0, 0)

  const existing = await prisma.habitLog.findUnique({
    where: { habitId_date: { habitId: habit.id, date: today } },
  })

  const log = existing
    ? await prisma.habitLog.update({
        where: { id: existing.id },
        data: { completed: !existing.completed },
      })
    : await prisma.habitLog.create({
        data: { habitId: habit.id, date: today, completed: true },
      })

  return { id: log.id, kind: 'habito' }
}

/**
 * Upsert a workout record for today and add one set for the parsed exercise.
 * Workout has @@unique([userId, date]) → one workout per user per day.
 */
export async function createWorkoutFromParsed(
  userId: string,
  parsed: ParsedCapture
): Promise<{ id: string; kind: 'gimnasio' }> {
  const exerciseName =
    parsed.metadata.recordData.name ?? parsed.cleanedTitle
  const weight = parsed.metadata.recordData.value ?? 0

  const today = new Date()
  today.setHours(0, 0, 0, 0)

  const workout = await prisma.workout.upsert({
    where: { userId_date: { userId, date: today } },
    create: { userId, title: parsed.cleanedTitle, date: today },
    update: {},
  })

  await prisma.workoutSet.create({
    data: {
      workoutId: workout.id,
      exerciseName,
      weight,
      reps: 1,
      setType: 'normal',
    },
  })

  return { id: workout.id, kind: 'gimnasio' }
}
