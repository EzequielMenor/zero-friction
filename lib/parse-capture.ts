/**
 * lib/parse-capture.ts
 *
 * Extracted AI parsing, embedding, and note-creation logic.
 * Actualizado para modelo Note + Task: dueDate/isImportant viven en Task.
 *
 * @module parse-capture
 */

import { prisma } from '@/lib/prisma'
import type { Prisma } from '@prisma/client'
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

export const RESPONSE_SCHEMA = {
  type: 'object',
  required: ['domain', 'cleanedTitle', 'cleanedContent', 'tags', 'metadata'],
  properties: {
    domain: { enum: ['ESPIRITUAL', 'PERSONAL', 'APRENDIZAJE', 'PROYECTOS', 'REGISTROS'] },
    cleanedTitle: { type: 'string' },
    cleanedContent: { type: 'string' },
    tags: { type: 'array', items: { type: 'string' }, minItems: 2, maxItems: 4 },
    suggestedGoals: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 2 },
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

export const SYSTEM_PROMPT =
  'You are a note processing assistant. ' +
  '1. Clean the text (correct transcription errors, strip control metadata like dates, "!", or commands). ' +
  '2. Classify it into one of 5 domains: ESPIRITUAL, PERSONAL, APRENDIZAJE, PROYECTOS, REGISTROS. ' +
  '3. Extract metadata: dueDate (ISO string YYYY-MM-DD, or null), isImportant (boolean). ' +
  '4. If domain is REGISTROS, classify as: gimnasio, finanzas, or habito. ' +
  '5. If REGISTROS+finanzas, extract: value (number), name/description, category (or GASTOS_FIJOS). ' +
  '6. If REGISTROS+habito, extract: name, category (e.g. "salud", "productividad"). ' +
  '7. If REGISTROS+gimnasio, extract: exercise name, weight, reps, sets, or mark as needs_review. ' +
  '8. Extract 2-4 thematic tags (e.g. ["Paciencia", "Gálatas"] or ["NextJS", "Prisma"]). ' +
  '9. If domain is ESPIRITUAL, also extract 1-2 concrete actionable personal-application goals. ' +
  '10. Return ONLY valid JSON matching the schema: ' +
  JSON.stringify(RESPONSE_SCHEMA) +
  '. Do not add any text before or after the JSON.'

export const USER_PROMPT = (rawText: string): string =>
  `Process this note:\n\n${rawText}`

// ─── Chat Completion ───────────────────────────────────────────────────────────

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

export async function createEmbedding(text: string, userId: string): Promise<number[]> {
  const { client, embeddingModel } = await getLlmForUser(userId)
  const response = await client.embeddings.create({
    model: embeddingModel,
    input: text,
  })
  return response.data[0].embedding
}

// ─── Note Persistence (POST /api/capture) ──────────────────────────────────────

/**
 * Create a Note DRAFT (sin Task) and persist its embedding + relationships.
 * Usado por /api/capture. Los campos de Task (dueDate, isImportant) ya no
 * viven en Note — se pasan a Task.create si corresponde.
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
      noteStatus: 'DRAFT',
      tags: parsed.tags ?? [],
      suggestedGoals: parsed.suggestedGoals ?? [],
    },
  })

  const embedding = await createEmbedding(parsed.cleanedContent, userId)

  // Save embedding via raw SQL
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

// ─── Relationships ─────────────────────────────────────────────────────────────

export async function createRelationships(
  userId: string,
  sourceNoteId: string,
  similarNotes: Array<{ id: string; similarity: number }>
): Promise<void> {
  await prisma.$transaction(
    similarNotes.map(({ id: targetNoteId, similarity }) =>
      prisma.noteRelationship.upsert({
        where: { sourceNoteId_targetNoteId: { sourceNoteId, targetNoteId } },
        update: { similarity },
        create: { userId, sourceNoteId, targetNoteId, similarity, isManual: false },
      })
    )
  )
}

// ─── REGISTROS helpers ──────────────────────────────────────────────────────────

export async function createTransactionFromParsed(
  tx: Prisma.TransactionClient,
  userId: string,
  parsed: ParsedCapture
): Promise<{ id: string; kind: 'finanzas' }> {
  const created = await tx.transaction.create({
    data: {
      userId,
      amount: parsed.metadata.recordData.value ?? 0,
      description: parsed.metadata.recordData.name ?? parsed.cleanedTitle,
      date: new Date(),
      category: parsed.metadata.recordData.category ?? 'VARIOS',
    },
  })
  return { id: created.id, kind: 'finanzas' }
}

export async function createOrToggleHabitLogFromParsed(
  tx: Prisma.TransactionClient,
  userId: string,
  parsed: ParsedCapture
): Promise<{ id: string; kind: 'habito' }> {
  const habitName = parsed.metadata.recordData.name ?? parsed.cleanedTitle

  let habit = await tx.habit.findFirst({
    where: { userId, name: { equals: habitName } },
  })
  if (!habit) {
    habit = await tx.habit.create({
      data: { userId, name: habitName, frequency: 'daily' },
    })
  }

  const today = new Date()
  today.setHours(0, 0, 0, 0)

  const existing = await tx.habitLog.findUnique({
    where: { habitId_date: { habitId: habit.id, date: today } },
  })

  const log = existing
    ? await tx.habitLog.update({
        where: { id: existing.id },
        data: { completed: !existing.completed },
      })
    : await tx.habitLog.create({
        data: { habitId: habit.id, date: today, completed: true },
      })

  return { id: log.id, kind: 'habito' }
}

export async function createWorkoutFromParsed(
  tx: Prisma.TransactionClient,
  userId: string,
  parsed: ParsedCapture
): Promise<{ id: string; kind: 'gimnasio' }> {
  const exerciseName = parsed.metadata.recordData.name ?? parsed.cleanedTitle
  const weight = parsed.metadata.recordData.value ?? 0

  const today = new Date()
  today.setHours(0, 0, 0, 0)

  const workout = await tx.workout.upsert({
    where: { userId_date: { userId, date: today } },
    create: { userId, title: parsed.cleanedTitle, date: today },
    update: {},
  })

  await tx.workoutSet.create({
    data: { workoutId: workout.id, exerciseName, weight, reps: 1, setType: 'normal' },
  })

  return { id: workout.id, kind: 'gimnasio' }
}
