-- Migration B: Constraints + drop columnas legacy de Note.
-- Pre-requisito: backfill script ejecutado y validado (counts cuadran).

-- 1. CHECK constraint en Task: completedAt obligatorio si status='DONE'
ALTER TABLE "Task"
  ADD CONSTRAINT "Task_completedAt_required_if_done"
  CHECK (status <> 'DONE' OR "completedAt" IS NOT NULL);

-- 2. Índices para queries de Task
CREATE INDEX "Task_userId_status_idx" ON "Task"("userId", "status");
CREATE INDEX "Task_userId_dueDate_idx" ON "Task"("userId", "dueDate");

-- 3. Partial unique: máximo 1 foco por usuario
CREATE UNIQUE INDEX "Task_one_focus_per_user"
  ON "Task"("userId") WHERE "focusedAt" IS NOT NULL;

-- 4. Drop columnas viejas de Note
ALTER TABLE "Note" DROP COLUMN "status";
ALTER TABLE "Note" DROP COLUMN "dueDate";
ALTER TABLE "Note" DROP COLUMN "isImportant";

-- 5. Dropear el enum viejo NoteStatus (5 valores) ANTES del rename
-- DROP COLUMN no dropea el type, hay que hacerlo explícitamente.
DROP TYPE "NoteStatus";

-- 6. Drop default temporal y poner default 'DRAFT' para nuevas Notes
ALTER TABLE "Note" ALTER COLUMN "noteStatus" DROP DEFAULT;
ALTER TABLE "Note" ALTER COLUMN "noteStatus" SET DEFAULT 'DRAFT';

-- 7. Rename del enum NoteStatusNew → NoteStatus (ahora que el viejo ya no existe)
ALTER TYPE "NoteStatusNew" RENAME TO "NoteStatus";

-- 8. Índice Note(userId, noteStatus) para hubs/search
CREATE INDEX "Note_userId_noteStatus_idx" ON "Note"("userId", "noteStatus");
