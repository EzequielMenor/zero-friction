-- Migration A: Crear tabla Task + columna noteStatus en Note.
-- Aditiva: no elimina nada. Las columnas legacy (status, dueDate, isImportant)
-- se mantienen hasta Migration B.

-- 1. Crear enum TaskStatus
CREATE TYPE "TaskStatus" AS ENUM ('OPEN', 'DONE');

-- 2. Tabla Task (vacía, se poblará con backfill script)
CREATE TABLE "Task" (
  "id"          TEXT NOT NULL,
  "noteId"      TEXT NOT NULL,
  "userId"      TEXT NOT NULL,
  "status"      "TaskStatus" NOT NULL DEFAULT 'OPEN',
  "dueDate"     TIMESTAMP(3),
  "isImportant" BOOLEAN NOT NULL DEFAULT false,
  "focusedAt"   TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Task_pkey" PRIMARY KEY ("id")
);

-- 3. FK + UNIQUE constraint 1:1
ALTER TABLE "Task"
  ADD CONSTRAINT "Task_noteId_fkey" FOREIGN KEY ("noteId") REFERENCES "Note"("id") ON DELETE CASCADE;
CREATE UNIQUE INDEX "Task_noteId_key" ON "Task"("noteId");
ALTER TABLE "Task"
  ADD CONSTRAINT "Task_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE;

-- 4. Crear nuevo enum NoteStatusNew (3 valores)
CREATE TYPE "NoteStatusNew" AS ENUM ('DRAFT', 'NEEDS_REVIEW', 'ACTIVE');

-- 5. Añadir columna noteStatus con default temporal 'ACTIVE'
--    El backfill script reasignará los valores correctos después.
ALTER TABLE "Note"
  ADD COLUMN "noteStatus" "NoteStatusNew" NOT NULL DEFAULT 'ACTIVE';

-- NO se dropean columnas viejas, NO se crean índices todavía.
-- El CHECK y el partial unique se añaden en Migration B.
