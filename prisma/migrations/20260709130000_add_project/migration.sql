-- 1. Crear enum ProjectStatus
CREATE TYPE "ProjectStatus" AS ENUM ('IDEATION', 'ACTIVE', 'MAINTENANCE', 'ARCHIVED');

-- 2. Crear tabla Project
CREATE TABLE "Project" (
  "id"          TEXT NOT NULL,
  "userId"      TEXT NOT NULL,
  "name"        TEXT NOT NULL,
  "description" TEXT,
  "status"      "ProjectStatus" NOT NULL DEFAULT 'IDEATION',
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL,

  CONSTRAINT "Project_pkey" PRIMARY KEY ("id")
);

-- 3. FK Project.userId → User.id (Cascade)
ALTER TABLE "Project"
  ADD CONSTRAINT "Project_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 4. Índices de Project
CREATE INDEX "Project_userId_status_idx"    ON "Project"("userId", "status");
CREATE INDEX "Project_userId_updatedAt_idx" ON "Project"("userId", "updatedAt");

-- 5. Añadir projectId nullable a Note
ALTER TABLE "Note" ADD COLUMN "projectId" TEXT;

-- 6. FK Note.projectId → Project.id (SetNull — Notes sobreviven huérfanas)
ALTER TABLE "Note"
  ADD CONSTRAINT "Note_projectId_fkey"
  FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 7. Índice compuesto Note(projectId, noteStatus)
CREATE INDEX "Note_projectId_noteStatus_idx" ON "Note"("projectId", "noteStatus");
