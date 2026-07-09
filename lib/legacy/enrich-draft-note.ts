/**
 * lib/legacy/enrich-draft-note.ts
 *
 * @deprecated Usar el flujo tripartito en /api/notes/[id]/process directamente.
 * Movido aquí desde lib/parse-capture.ts (FIX-J14).
 * NO importar desde lib/parse-capture.ts.
 */

import { prisma } from '@/lib/prisma'
import { createEmbedding, findSimilarNotes, createRelationships } from '@/lib/parse-capture'
import type { ParsedCapture } from '@/lib/parse-capture'

export async function enrichDraftNote(
  noteId: string,
  userId: string,
  parsed: ParsedCapture
): Promise<import('@prisma/client').Note | null> {
  const embedding = await createEmbedding(parsed.cleanedContent, userId)

  const result = await prisma.note.updateMany({
    where: { id: noteId, userId, noteStatus: 'DRAFT' },
    data: {
      noteStatus: 'ACTIVE',
      domain: parsed.domain,
      title: parsed.cleanedTitle,
      content: parsed.cleanedContent,
      tags: parsed.tags,
      suggestedGoals: parsed.suggestedGoals ?? [],
    },
  })

  if (result.count === 0) return null

  await prisma.$executeRaw`
    UPDATE "Note"
    SET embedding = ${embedding}::vector
    WHERE id = ${noteId} AND "noteStatus" = 'ACTIVE'
  `

  const similar = await findSimilarNotes(userId, noteId, embedding)
  if (similar.length > 0) {
    await createRelationships(
      userId,
      noteId,
      similar.map((n) => ({
        targetNoteId: n.id,
        similarity: n.similarity,
      }))
    )
  }

  return prisma.note.findUnique({ where: { id: noteId } })
}
