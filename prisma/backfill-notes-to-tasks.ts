/**
 * Backfill script: migra Notes existentes al nuevo modelo Note + Task.
 *
 * Ejecución:
 *   pnpm tsx prisma/backfill-notes-to-tasks.ts                   # dry-run (default)
 *   pnpm tsx prisma/backfill-notes-to-tasks.ts --apply           # ejecutar
 *   pnpm tsx prisma/backfill-notes-to-tasks.ts --apply --resume  # recuperación
 *
 * Mapping spec §1.6:
 *   DRAFT           → noteStatus=DRAFT,           no Task
 *   NEEDS_REVIEW    → noteStatus=NEEDS_REVIEW,    no Task
 *   ACTIVE sin datos → noteStatus=ACTIVE,          no Task
 *   ACTIVE con datos → noteStatus=ACTIVE,          Task OPEN
 *   IN_PROGRESS      → noteStatus=ACTIVE,          Task OPEN, focusedAt=updatedAt
 *   DONE            → noteStatus=ACTIVE,           Task DONE, completedAt=updatedAt
 */

import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

interface RawRow {
  noteId: string
  userId: string
  status: string
  dueDate: Date | null
  isImportant: boolean
  updatedAt: Date
  createdAt: Date
}

async function main() {
  const apply = process.argv.includes('--apply')
  const resume = process.argv.includes('--resume')
  const batchSizeArg = process.argv.find((a) => a.startsWith('--batch-size='))
  const batchSize = batchSizeArg ? parseInt(batchSizeArg.split('=')[1], 10) : 500

  // ── (A) Dry-run: distribución de status actual ──────────────────────────
  console.log('[dry-run] consultando distribución de status...')
  const candidates = await prisma.$queryRaw<{ status: string; n: bigint }[]>`
    SELECT status::text AS status, COUNT(*)::bigint AS n
    FROM "Note"
    GROUP BY status
  `
  const projected: Record<string, number> = {}
  for (const r of candidates) {
    projected[r.status] = Number(r.n)
  }
  console.log('[dry-run] distribución de status:', projected)

  // Calcular ACTIVE_qualified: ACTIVE con dueDate o isImportant
  const activeQualified = await prisma.note.count({
    where: {
      status: 'ACTIVE',
      OR: [{ dueDate: { not: null } }, { isImportant: true }],
    },
  })
  projected['ACTIVE_qualified'] = activeQualified
  console.log('[dry-run] ACTIVE qualified para Tasks:', activeQualified)

  const projectedTasks =
    (projected['IN_PROGRESS'] ?? 0) +
    (projected['DONE'] ?? 0) +
    (projected['ACTIVE_qualified'] ?? 0)
  console.log('[dry-run] projected tasks:', projectedTasks)

  if (!apply && !resume) {
    console.log('[dry-run] finalizado. Usá --apply para ejecutar.')
    return
  }

  // ── (B) Validación pre-ejecución ────────────────────────────────────────
  const existingTasks = await prisma.task.count()
  if (existingTasks !== 0 && !resume) {
    throw new Error(
      `Task ya tiene ${existingTasks} filas — abortar.\n` +
      `Para recuperación: ejecutá con --resume (salta Notes con Task existente).\n` +
      `Para empezar de cero: DELETE FROM "Task" + re-run sin --resume.`
    )
  }
  if (existingTasks !== 0 && resume) {
    console.log(`[resume] ${existingTasks} Tasks existentes — se saltarán las Notes que ya tienen Task`)
  }

  // ── (B.1) Detectar inconsistencias pre-ejecución ────────────────────────
  // Si durante la ventana dry-run → apply se crearon Notes nuevas con status inconsistente.
  const inconsistent = await prisma.note.count({
    where: {
      noteStatus: 'ACTIVE',
      status: { in: ['DRAFT', 'NEEDS_REVIEW'] },
    },
  })
  if (inconsistent > 0) {
    throw new Error(
      `Encontradas ${inconsistent} Notes con noteStatus inconsistente (ACTIVE pero status DRAFT/NEEDS_REVIEW). ` +
      `Ventana de mantenimiento violada: NO crear Notes durante el backfill.`
    )
  }
  console.log('[check] sin inconsistencias noteStatus ↔ status.')

  // ── (B.5) Mapear noteStatus para TODAS las Notes ────────────────────────
  console.log('[apply] mapeando noteStatus: status viejo → noteStatus nuevo...')
  await prisma.$executeRawUnsafe(`
    UPDATE "Note" SET "noteStatus" =
      CASE "status"::text
        WHEN 'DRAFT' THEN 'DRAFT'::"NoteStatusNew"
        WHEN 'NEEDS_REVIEW' THEN 'NEEDS_REVIEW'::"NoteStatusNew"
        ELSE 'ACTIVE'::"NoteStatusNew"
      END
  `)

  const noteStatusDist = await prisma.$queryRaw<{ noteStatus: string; n: bigint }[]>`
    SELECT "noteStatus"::text AS "noteStatus", COUNT(*)::bigint AS n
    FROM "Note" GROUP BY "noteStatus"
  `
  console.log('[apply] noteStatus post-mapping:', noteStatusDist)

  // ── (C) Crear Tasks según mapping §1.6 ──────────────────────────────────
  const notesToTaskify = resume
    ? await prisma.$queryRaw<RawRow[]>`
        SELECT id AS "noteId", "userId", status::text AS status, "dueDate",
               "isImportant", "updatedAt", "createdAt"
        FROM "Note"
        WHERE (status = 'IN_PROGRESS'
            OR status = 'DONE'
            OR (status = 'ACTIVE' AND ("dueDate" IS NOT NULL OR "isImportant" = true)))
          AND id NOT IN (SELECT "noteId" FROM "Task")
      `
    : await prisma.$queryRaw<RawRow[]>`
        SELECT id AS "noteId", "userId", status::text AS status, "dueDate",
               "isImportant", "updatedAt", "createdAt"
        FROM "Note"
        WHERE (status = 'IN_PROGRESS'
            OR status = 'DONE'
            OR (status = 'ACTIVE' AND ("dueDate" IS NOT NULL OR "isImportant" = true)))
      `

  console.log(`[apply] ${notesToTaskify.length} Notes candidatas para crear Task`)

  if (notesToTaskify.length === 0) {
    console.log('[apply] no hay Notes que requieran Task.')
  } else {
    const data = notesToTaskify.map((n) => ({
      noteId: n.noteId,
      userId: n.userId,
      status: n.status === 'DONE' ? ('DONE' as const) : ('OPEN' as const),
      dueDate: n.dueDate,
      isImportant: n.isImportant,
      focusedAt: n.status === 'IN_PROGRESS' ? n.updatedAt : null,
      completedAt: n.status === 'DONE' ? n.updatedAt : null,
      createdAt: n.createdAt,
      updatedAt: n.updatedAt,
    }))

    // Batch processing para evitar timeout con datasets grandes
    for (let i = 0; i < data.length; i += batchSize) {
      const chunk = data.slice(i, i + batchSize)
      const result = await prisma.task.createMany({ data: chunk, skipDuplicates: true })
      console.log(`[apply] lote ${Math.floor(i / batchSize) + 1}: creadas ${result.count} Tasks (${Math.min(i + batchSize, data.length)}/${data.length})`)
    }
  }

  // ── (D) Validación post ─────────────────────────────────────────────────
  const taskCount = await prisma.task.count()
  const noteCount = await prisma.note.count()
  const noteStatusNullResult = await prisma.$queryRaw<{ count: bigint }[]>`
    SELECT COUNT(*)::bigint AS count FROM "Note" WHERE "noteStatus" IS NULL
  `
  const noteStatusNullCount = Number(noteStatusNullResult[0]?.count ?? 0)
  const orphanTasks = await prisma.$queryRaw<{ count: bigint }[]>`
    SELECT COUNT(*)::bigint AS count FROM "Task" t
    LEFT JOIN "Note" n ON t."noteId" = n.id
    WHERE n.id IS NULL
  `

  console.log('[validate-post] Tasks totales:', taskCount)
  console.log('[validate-post] Notes totales:', noteCount)
  console.log('[validate-post] Notes con noteStatus NULL:', noteStatusNullCount)

  if (orphanTasks[0] && Number(orphanTasks[0].count) !== 0) {
    throw new Error(`${orphanTasks[0].count} Tasks huérfanas detectadas`)
  }
  if (noteStatusNullCount !== 0) {
    throw new Error(`${noteStatusNullCount} Notes con noteStatus NULL`)
  }

  // Verificar que los counts cuadran aproximadamente
  const expectedTaskCount = projectedTasks
  if (taskCount !== expectedTaskCount) {
    console.warn(
      `[validate-post] ⚠️ discrepanicia: ${taskCount} Tasks creadas vs ${expectedTaskCount} proyectadas. ` +
      `Revisar manualmente si es esperado (p.ej. Notes borradas entre dry-run y apply).`
    )
  } else {
    console.log('[validate-post] ✅ counts cuadran.')
  }

  console.log('[ok] backfill completado.')
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
