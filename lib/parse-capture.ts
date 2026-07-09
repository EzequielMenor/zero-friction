/**
 * lib/parse-capture.ts
 *
 * AI parsing, embedding, and note-creation logic.
 * intent discrimina task/knowledge/reflection para decidir
 * si crear Task o solo persistir Note.
 *
 * @module parse-capture
 */

import { prisma } from '@/lib/prisma'
import type { Prisma } from '@prisma/client'
import { getLlmForUser } from '@/lib/llm'

// ─── Types ────────────────────────────────────────────────────────────────────

type RecordType = 'gimnasio' | 'finanzas' | 'habito' | null

/**
 * Intent classification for a parsed capture.
 * - task: compromiso, recordatorio, seguimiento o acción pendiente concreta.
 * - knowledge: idea, aprendizaje, insight, dato, decisión o referencia reutilizable.
 * - reflection: diario, emoción, introspección o registro personal/espiritual.
 */
export type CaptureIntent = 'task' | 'knowledge' | 'reflection'

/**
 * Tipos de relación semántica entre notas, decidida por LLM batch.
 */
export type NoteRelationshipTypeLLM =
  | 'RELATED'
  | 'SUPPORTS'
  | 'CONTRADICTS'
  | 'EXAMPLE_OF'
  | 'CONTINUES'
  | 'RELATED_PROJECT'
  | 'REFERENCES'

/**
 * Decisión de reranking para un candidato individual.
 */
export interface RerankDecision {
  candidateId: string
  shouldLink: boolean
  relationshipType: NoteRelationshipTypeLLM | null
  reason: string | null
  confidence: number
}

/**
 * Respuesta batch del LLM reranker.
 */
export interface RerankResponse {
  decisions: RerankDecision[]
}

/**
 * Result of AI parsing a raw capture text.
 */
export interface ParsedCapture {
  domain: 'ESPIRITUAL' | 'PERSONAL' | 'APRENDIZAJE' | 'PROYECTOS' | 'REGISTROS'
  cleanedTitle: string
  cleanedContent: string
  tags: string[]
  suggestedGoals?: string[]
  intent: CaptureIntent
  action?: string
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
  required: ['domain', 'cleanedTitle', 'cleanedContent', 'tags', 'intent', 'metadata'],
  properties: {
    domain: { enum: ['ESPIRITUAL', 'PERSONAL', 'APRENDIZAJE', 'PROYECTOS', 'REGISTROS'] },
    cleanedTitle: { type: 'string' },
    cleanedContent: { type: 'string' },
    tags: { type: 'array', items: { type: 'string' }, minItems: 2, maxItems: 4 },
    suggestedGoals: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 2 },
    intent: { enum: ['task', 'knowledge', 'reflection'] },
    action: { type: 'string' },
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

// ─── Reranking Schema & Prompt ────────────────────────────────────────────────

export const RERANK_RESPONSE_SCHEMA = {
  type: 'object',
  required: ['decisions'],
  properties: {
    decisions: {
      type: 'array',
      maxItems: 15,
      items: {
        type: 'object',
        required: ['candidateId', 'shouldLink', 'relationshipType', 'reason', 'confidence'],
        properties: {
          candidateId: { type: 'string' },
          shouldLink: { type: 'boolean' },
          relationshipType: {
            enum: [
              'RELATED',
              'SUPPORTS',
              'CONTRADICTS',
              'EXAMPLE_OF',
              'CONTINUES',
              'RELATED_PROJECT',
              'REFERENCES',
            ],
          },
          reason: { type: ['string', 'null'], maxLength: 240 },
          confidence: { type: 'number', minimum: 0, maximum: 1 },
        },
      },
    },
  },
} as const

export const RERANK_SYSTEM_PROMPT =
  'You are a semantic relationship analyst for a personal knowledge graph (Zettelkasten). ' +
  'Your task is to evaluate candidate notes and decide which ones truly deserve to be linked to the source note. ' +
  'IMPORTANT RULES: ' +
  '1. pgvector similarity is a hint, NOT a guarantee of meaningful relationship. ' +
  '2. Reject weak similarity: generic keywords, loose topic match, or superficial similarity. ' +
  '3. Prefer FEW high-quality relationships over many weak ones. ' +
  '4. A link is warranted only when notes share specific conceptual content, not just shared tags or domain. ' +
  '5. Be conservative: when in doubt, set shouldLink=false. ' +
  '6. relationshipType options: ' +
  '   - RELATED: general thematic connection ' +
  '   - SUPPORTS: provides evidence or confirmation ' +
  '   - CONTRADICTS: opposes or contradicts ' +
  '   - EXAMPLE_OF: concrete instance of a general concept ' +
  '   - CONTINUES: sequel or direct continuation ' +
  '   - RELATED_PROJECT: belongs to the same project or goal ' +
  '   - REFERENCES: explicitly cites or mentions ' +
  '7. confidence: 0.0-1.0, where 0.65 is the minimum to create a link. ' +
  '8. Return ONLY valid JSON matching the schema. ' +
  JSON.stringify(RERANK_RESPONSE_SCHEMA) +
  '. Do not add any text before or after the JSON.'

export function buildRerankUserPrompt(
  sourceNote: { id: string; title: string; content: string; domain?: string; intent?: string; tags?: string[] },
  candidates: Array<{ id: string; title: string; content: string; similarity: number; domain?: string; tags?: string[] }>
): string {
  const source = `Source Note:
- ID: ${sourceNote.id}
- Title: ${sourceNote.title}
- Content (truncated): ${sourceNote.content.slice(0, 500)}
${sourceNote.domain ? `- Domain: ${sourceNote.domain}` : ''}
${sourceNote.intent ? `- Intent: ${sourceNote.intent}` : ''}
${sourceNote.tags?.length ? `- Tags: ${sourceNote.tags.join(', ')}` : ''}`

  const candidatesList = candidates
    .map(
      (c) =>
        `Candidate:
- ID: ${c.id}
- Title: ${c.title}
- Content (truncated): ${c.content.slice(0, 500)}
- Similarity score: ${c.similarity.toFixed(3)}
${c.domain ? `- Domain: ${c.domain}` : ''}
${c.tags?.length ? `- Tags: ${c.tags.join(', ')}` : ''}`
    )
    .join('\n\n')

  return `${source}

---

Candidates to evaluate (max 15):

${candidatesList}

---

Return your decisions as JSON.`
}

export const SYSTEM_PROMPT =
  'You are a note processing assistant. ' +
  '1. Clean the text (correct transcription errors, strip control metadata like dates, "!", or commands). ' +
  '2. Classify the **intent** into one of three categories: ' +
  '"task" = commitment, reminder, follow-up, or concrete pending action (something to DO). ' +
  '"knowledge" = idea, learning, insight, data point, decision, or reusable reference worth keeping (something to REMEMBER — even if brilliant or important). ' +
  '"reflection" = journal entry, emotion, introspection, or personal/spiritual log without concrete action (how you FEEL or what you are THINKING about). ' +
  'Key distinction: "I should call the dentist" → task. "Great article on clean architecture" → knowledge. "Today I felt grateful for..." → reflection. ' +
  '3. If intent is "task", extract a concise action verb/phrase (e.g. "call dentist", "submit report", "review PR") into the action field. ' +
  '4. Classify into one of 5 domains: ESPIRITUAL, PERSONAL, APRENDIZAJE, PROYECTOS, REGISTROS. ' +
  '5. Extract metadata: dueDate (ISO string YYYY-MM-DD, or null), isImportant (boolean). ' +
  '6. If domain is REGISTROS, classify as: gimnasio, finanzas, or habito. ' +
  '7. If REGISTROS+finanzas, extract: value (number), name/description, category (or GASTOS_FIJOS). ' +
  '8. If REGISTROS+habito, extract: name, category (e.g. "salud", "productividad"). ' +
  '9. If REGISTROS+gimnasio, extract: exercise name, weight, reps, sets, or mark as needs_review. ' +
  '10. Extract 2-4 thematic tags (e.g. ["Paciencia", "Gálatas"] or ["NextJS", "Prisma"]). ' +
  '11. If domain is ESPIRITUAL, also extract 1-2 concrete actionable personal-application goals. ' +
  '12. Return ONLY valid JSON matching the schema: ' +
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

  const parsed = JSON.parse(content) as ParsedCapture

  // Normalize: action solo tiene sentido para tasks
  if (parsed.intent !== 'task') {
    parsed.action = undefined
  }

  return parsed
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
    const reranked = await rerankNoteRelationships(
      { id: note.id, title: parsed.cleanedTitle, content: parsed.cleanedContent, domain: parsed.domain, intent: parsed.intent, tags: parsed.tags },
      similarNotes,
      userId
    )
    if (reranked.length > 0) {
      await createRelationships(
        userId,
        note.id,
        reranked.map((r) => ({
          targetNoteId: r.targetNoteId,
          similarity: r.similarity,
          relationshipType: r.relationshipType,
          reason: r.reason,
        }))
      )
    }
  }

  return { id: note.id, embedding }
}

// ─── Similarity Search ─────────────────────────────────────────────────────────

export async function findSimilarNotes(
  userId: string,
  noteId: string,
  embedding: number[],
  limit = 15
): Promise<Array<{ id: string; similarity: number; title: string; content: string; domain?: string; tags?: string[] }>> {
  const similar = await prisma.$queryRaw<Array<{ id: string; similarity: number; title: string; content: string; domain: string; tags: string[] }>>`
    SELECT id, 1 - (embedding <=> ${embedding}::vector) as similarity, title, content, domain, tags
    FROM "Note"
    WHERE "userId" = ${userId} AND id != ${noteId}
    ORDER BY embedding <=> ${embedding}::vector
    LIMIT ${limit}
  `
  return similar.map((n) => ({
    id: n.id,
    similarity: n.similarity,
    title: n.title,
    content: n.content,
    domain: n.domain,
    tags: n.tags,
  }))
}

// ─── Relationships ─────────────────────────────────────────────────────────────

export type RelationshipCreateInput = {
  targetNoteId: string
  similarity: number
  relationshipType?: 'RELATED' | 'SUPPORTS' | 'CONTRADICTS' | 'EXAMPLE_OF' | 'CONTINUES' | 'RELATED_PROJECT' | 'REFERENCES'
  reason?: string | null
}

export async function createRelationships(
  userId: string,
  sourceNoteId: string,
  relations: RelationshipCreateInput[]
): Promise<void> {
  if (relations.length === 0) return
  await prisma.$transaction(
    relations.map(({ targetNoteId, similarity, relationshipType, reason }) =>
      prisma.noteRelationship.upsert({
        where: { sourceNoteId_targetNoteId: { sourceNoteId, targetNoteId } },
        update: { similarity, relationshipType, reason },
        create: {
          userId,
          sourceNoteId,
          targetNoteId,
          similarity,
          relationshipType: relationshipType ?? 'RELATED',
          reason: reason ?? null,
          isManual: false,
        },
      })
    )
  )
}

// ─── Reranking ─────────────────────────────────────────────────────────────────

/**
 * rerankNoteRelationships — LLM batch judge como filtro final de candidatos.
 * pgvector Top 15 → LLM decide cuáles merecen link y con qué tipo.
 * Si falla (timeout/API/parse), retorna [] sin bloquear el flujo principal.
 */
export async function rerankNoteRelationships(
  sourceNote: { id: string; title: string; content: string; domain?: string; intent?: string; tags?: string[] },
  candidates: Array<{ id: string; title: string; content: string; similarity: number; domain?: string; tags?: string[] }>,
  userId: string,
  signal?: AbortSignal
): Promise<Array<{ targetNoteId: string; similarity: number; relationshipType: NoteRelationshipTypeLLM; reason: string | null; confidence: number }>> {
  try {
    const { client, model } = await getLlmForUser(userId)
    const userPrompt = buildRerankUserPrompt(sourceNote, candidates)

    const completion = await client.chat.completions.create(
      {
        model,
        messages: [
          { role: 'system', content: RERANK_SYSTEM_PROMPT },
          { role: 'user', content: userPrompt },
        ],
        response_format: { type: 'json_object' },
        temperature: 0.1,
      },
      { signal }
    )

    const content = completion.choices[0]?.message?.content
    if (!content) {
      console.warn('[rerankNoteRelationships] empty response from LLM')
      return []
    }

    const parsed = JSON.parse(content) as RerankResponse

    return parsed.decisions
      .filter((d) => d.shouldLink && d.relationshipType !== null && d.confidence >= 0.65)
      .map((d) => ({
        targetNoteId: d.candidateId,
        similarity: candidates.find((c) => c.id === d.candidateId)?.similarity ?? 0,
        relationshipType: d.relationshipType!,
        reason: d.reason,
        confidence: d.confidence,
      }))
  } catch (err) {
    // No bloquear: log y retorno seguro
    console.error('[rerankNoteRelationships] rerank failed, returning empty list', err)
    return []
  }
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
