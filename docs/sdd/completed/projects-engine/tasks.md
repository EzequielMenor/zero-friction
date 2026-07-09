# Tasks: Project Engine (Phase 3)

**Proyecto**: `zero-friction`
**Sesión**: `projects-engine-2026-07-09`
**Fase**: brain-tasks (Fase 4)
**Estado**: `done`

> Path canónico del dashboard: `/api/dashboard` (no `/api/today`).
> D4 cerrada por el usuario: Task NO lleva `projectId`. Se deriva vía JOIN.

---

## 1. Resumen del plan

- **Total de tareas atómicas**: 21 (T1.1 – T7.1)
- **Total de batches**: 7
- **Estrategia de deploy**: big-bang atómico. 7 PRs secuenciales, deploy conjunto tras merge del PR #7.
- **Estimación de complejidad por batch**:
  - Batch 1 (Schema + tipos): M
  - Batch 2 (Migration): S
  - Batch 3 (Endpoints + lib): L
  - Batch 4 (Queries existentes): M
  - Batch 5 (Frontend): M
  - Batch 6 (Tests): L
  - Batch 7 (Smoke manual): S

---

## 2. Definición de tareas atómicas

---

### T1.1 — Añadir enum ProjectStatus + model Project al schema

**Batch**: 1
**Archivos**:
- `prisma/schema.prisma` (modificar)

**Cambio esperado**:
- Añadir `enum ProjectStatus { IDEATION, ACTIVE, MAINTENANCE, ARCHIVED }`
- Añadir `model Project { id, userId, name, description?, status, createdAt, updatedAt }` con `@id @default(cuid())`
- Añadir `@@index([userId, status])` y `@@index([userId, updatedAt])` en Project
- Relación `Project.user User @relation(fields: [userId], references: [id], onDelete: Cascade)`
- Relación `Project.notes Note[]` (inversa, sin tocar Task)

**Pre-requisitos**: ninguno

**Validación**:
```bash
pnpm prisma format && pnpm prisma generate && pnpm tsc --noEmit && echo "ok"
```

**Riesgo de regresión**: bajo — cambio estrictamente aditivo

**Notas operativas**:
- NO añadir `Task.projectId` (D4: Task no lleva projectId)
- `userId` en Project es decorativo en single-user pero obligatorio por consistencia (D5)

---

### T1.2 — Añadir projectId + relación + índice a model Note

**Batch**: 1
**Archivos**:
- `prisma/schema.prisma` (modificar)

**Cambio esperado**:
- En `model Note`: añadir `projectId String?` y `project Project? @relation(fields: [projectId], references: [id], onDelete: SetNull)`
- Añadir `@@index([projectId, noteStatus])` en Note

**Pre-requisitos**: T1.1

**Validación**:
```bash
pnpm prisma format && pnpm prisma generate && pnpm tsc --noEmit && echo "ok"
```

**Riesgo de regresión**: bajo — columna nullable sin default, filas existentes quedan null

**Notas operativas**:
- `onDelete: SetNull` — cuando se borre un Project, las Notes quedan huérfanas con `projectId = null`
- Sin default: datos existentes quedan `NULL` automáticamente (cero backfill)

---

### T1.3 — Añadir relación inversa projects Project[] a model User

**Batch**: 1
**Archivos**:
- `prisma/schema.prisma` (modificar)

**Cambio esperado**:
- En `model User`: añadir `projects Project[]`

**Pre-requisitos**: T1.1

**Validación**:
```bash
pnpm prisma format && pnpm prisma generate && pnpm tsc --noEmit && echo "ok"
```

**Riesgo de regresión**: bajo — relación inversa, no añade columnas

---

### T1.4 — Crear lib/types/project.ts con todos los tipos

**Batch**: 1
**Archivos**:
- `lib/types/project.ts` (crear)

**Cambio esperado**:
- Re-export: `export type { ProjectStatus } from '@prisma/client'`
- `ProjectBrief = { id: string; name: string; status: ProjectStatus }`
- `ProjectItem = { id: string; userId: string; name: string; description: string | null; status: ProjectStatus; createdAt: string; updatedAt: string }`
- `ProjectDetail = ProjectItem & { notesCount: number; openTasksCount: number }`
- `CreateProjectInput = { name: string; description?: string; status?: ProjectStatus }`
- `UpdateProjectInput = { name?: string; description?: string | null; status?: ProjectStatus }`
- `ProjectTransitionError = { code: 'invalidTransition'; message: string; details: { from: ProjectStatus; attempted: ProjectStatus; allowedFromCurrent: ProjectStatus[] } }`
- `InvalidProjectIdFormatError`, `InvalidProjectIdNotFoundError`, `InvalidProjectIdForbiddenError`, `InvalidProjectIdError`
- `CUID_REGEX = /^c[a-z0-9]{20,30}$/i`

**Pre-requisitos**: ninguno

**Validación**:
```bash
pnpm tsc --noEmit && echo "ok"
```

**Riesgo de regresión**: bajo — archivo nuevo

---

### T1.5 — Extender lib/types/note.ts y lib/types/task.ts

**Batch**: 1
**Archivos**:
- `lib/types/note.ts` (modificar)
- `lib/types/task.ts` (modificar)

**Cambio esperado**:
- En `note.ts`: añadir `projectId?: string` a `NoteItem`; añadir `project?: ProjectBrief | null` a `NoteWithTask` (o al tipo que se use en responses con project anidado)
- En `task.ts`: añadir `project?: ProjectBrief | null` a `TaskWithNote`
- Añadir comentario: `// project puede ser null por: (1) nunca tuvo proyecto, (2) perdió proyecto por cascade de un Project borrado`

**Pre-requisitos**: T1.4

**Validación**:
```bash
pnpm tsc --noEmit && echo "ok"
```

**Riesgo de regresión**: bajo — campos opcionales añadidos a tipos existentes

---

### T1.6 — Extender lib/hubs.ts con selectores de project

**Batch**: 1
**Archivos**:
- `lib/hubs.ts` (modificar)

**Cambio esperado**:
- Añadir `PROJECT_BRIEF_SELECT = { id: true, name: true, status: true } as const`
- Añadir `NOTE_SELECT_WITH_PROJECT = { ...NOTE_SELECT_NEW, project: { select: PROJECT_BRIEF_SELECT } } as const`
- Añadir `NOTE_SELECT_NEW_WITH_PROJECT = NOTE_SELECT_WITH_PROJECT` (alias para spec)
- Añadir `NOTE_SELECT_WITH_TASK_FLAG_PROJECT = { ...NOTE_SELECT_WITH_PROJECT, task: { select: { id: true } } } as const`
- Añadir `PROJECT_SELECT = { id: true, userId: true, name: true, description: true, status: true, createdAt: true, updatedAt: true } as const`

**Pre-requisitos**: T1.4, T1.5

**Validación**:
```bash
pnpm tsc --noEmit && pnpm prisma format && echo "ok"
```

**Riesgo de regresión**: bajo — solo se añaden constantes nuevas

---

### T2.1 — Generar migration add_project

**Batch**: 2
**Archivos**:
- `prisma/migrations/<ts>_add_project/migration.sql` (crear, auto-generado)

**Cambio esperado**:
- Ejecutar `pnpm prisma migrate dev --name add_project`
- Verificar que el SQL generado contiene (en orden):
  1. `CREATE TYPE "ProjectStatus" AS ENUM ('IDEATION', 'ACTIVE', 'MAINTENANCE', 'ARCHIVED')`
  2. `CREATE TABLE "Project" (...)` con PK, userId FK (Cascade), status default 'IDEATION'
  3. `CREATE INDEX "Project_userId_status_idx"`
  4. `CREATE INDEX "Project_userId_updatedAt_idx"`
  5. `ALTER TABLE "Note" ADD COLUMN "projectId" TEXT`
  6. FK `Note.projectId → Project.id` con `ON DELETE SET NULL`
  7. `CREATE INDEX "Note_projectId_noteStatus_idx"`
  8. User.projects se infiere de la relación (sin SQL adicional)

**Pre-requisitos**: T1.1, T1.2, T1.3

**Validación**:
```bash
pnpm prisma migrate dev --name add_project && echo "ok"
# Verificar SQL manualmente línea por línea contra spec §5
```

**Riesgo de regresión**: bajo — migration aditiva, sin DROP ni backfill

**Notas operativas**:
- Si `prisma migrate dev` genera SQL inesperado (DROP COLUMN, etc.), abortar antes de mergear y reportar

---

### T2.2 — Verificar migration aplicada en staging

**Batch**: 2
**Archivos**: ninguno (solo verificación en staging)

**Cambio esperado**:
- `pnpm prisma migrate deploy` en staging
- Verificar con psql:
  - `SELECT column_name, is_nullable FROM information_schema.columns WHERE table_name='Note' AND column_name='projectId';` → `projectId | YES`
  - `SELECT conname, confdeltype FROM pg_constraint WHERE conname LIKE 'Note_projectId%';` → `SetNull`
  - `SELECT COUNT(*) FROM "Project";` → 0 (tabla vacía inicialmente)
  - `SELECT indexname FROM pg_indexes WHERE tablename='Project';` → incluye `_userId_status_idx` y `_userId_updatedAt_idx`

**Pre-requisitos**: T2.1

**Validación**:
```bash
pnpm prisma migrate deploy && echo "ok"
psql -c "SELECT column_name, is_nullable FROM information_schema.columns WHERE table_name='Note' AND column_name='projectId';"
psql -c "SELECT COUNT(*) FROM \"Project\";"  # esperado: 0
```

**Riesgo de regresión**: bajo — staging, sin datos de producción

---

### T3.1 — Crear lib/projects.ts

**Batch**: 3
**Archivos**:
- `lib/projects.ts` (crear)

**Cambio esperado**:
- `PROJECT_TRANSITIONS: Record<ProjectStatus, ProjectStatus[]>` con el DAG completo (IDEATION→[ACTIVE,ARCHIVED], ACTIVE→[MAINTENANCE,ARCHIVED,IDEATION], MAINTENANCE→[ACTIVE,ARCHIVED], ARCHIVED→[ACTIVE,IDEATION])
- `validateTransition(from, to): TransitionValidation` — idempotente (self=ok), lanza TypeError si estado desconocido
- `formatProjectItem(p: Project): ProjectItem` — convierte fechas a ISO string
- `formatProjectBrief(p: { id, name, status } | null): ProjectBrief | null` — null si entra null
- `findOwnProjectOrThrow(projectId, userId): Promise<Project>` — regex cuid + Prisma lookup; lanza `InvalidProjectIdError` con code format/not_found/forbidden
- `mapPrismaError(e, route): void` — opcional, mapea P2003→400, P2025→404
- `logProjectEvent(event, ctx, level?)` — helper de logging JSON-line

**Pre-requisitos**: T1.4, T2.1

**Validación**:
```bash
pnpm tsc --noEmit && echo "ok"
```

**Riesgo de regresión**: bajo — archivo nuevo, lógica pura testeable

---

### T3.2 — Crear lib/rate-limit.ts

**Batch**: 3
**Archivos**:
- `lib/rate-limit.ts` (crear)

**Cambio esperado**:
- Implementar `rateLimit(key: string, limit: number, windowMs: number): boolean` con Map en memoria (pattern de Phase 2)
- Retorna `true` si dentro del límite, `false` si se excedió
- No requiere persistencia (single-user, Vercel serverless)

**Pre-requisitos**: T1.4

**Validación**:
```bash
pnpm tsc --noEmit && echo "ok"
```

**Riesgo de regresión**: bajo — archivo nuevo; aceptado que el rate-limit es por instancia en serverless

---

### T3.3 — Crear app/api/projects/route.ts (POST + GET)

**Batch**: 3
**Archivos**:
- `app/api/projects/route.ts` (crear)

**Cambio esperado**:
- `POST`: acepta `{ name, description?, status? }`, valida name no-vacío, default status=IDEATION, usa `formatProjectItem`, rate-limit 30/min, log `project.created`, response 201
- `GET`: sin query params → lista todos los proyectos del usuario order by updatedAt desc; con `?status=` filtra; usa `formatProjectItem`; rate-limit 120/min; response 200

**Pre-requisitos**: T3.1, T3.2, T2.1

**Validación**:
```bash
pnpm tsc --noEmit && pnpm prisma format && echo "ok"
# Smoke manual:
# POST /api/projects {"name":"Test"} → 201
# GET /api/projects → 200 array
```

**Riesgo de regresión**: medio — endpoint nuevo

---

### T3.4 — Crear app/api/projects/[id]/route.ts (GET + PATCH + DELETE)

**Batch**: 3
**Archivos**:
- `app/api/projects/[id]/route.ts` (crear)

**Cambio esperado**:
- `GET`: `ProjectDetail` con `notesCount` (prisma.note.count) + `openTasksCount` (prisma.task.count con join Note→Project); 404 si no existe o no es del user; rate-limit 120/min
- `PATCH`: `UpdateProjectInput`, valida `body.status` contra `VALID_STATUSES` antes de `validateTransition`, usa CAS (WHERE id+userId+status=from) con `updateMany`, 409 si count=0 (race), 400 si name vacío, rate-limit 60/min, log `project.status.changed`, response 200
- `DELETE`: hard-delete con `prisma.project.delete`, Prisma gestiona SetNull cascade, log `project.deleted` con orphanNotesCount, response 204; rate-limit 30/min

**Pre-requisitos**: T3.1, T3.2, T3.3, T2.1

**Validación**:
```bash
pnpm tsc --noEmit && pnpm prisma format && echo "ok"
# Smoke manual:
# PATCH /api/projects/[id] {"status":"MAINTENANCE"} desde IDEATION → 409
# PATCH /api/projects/[id] {"status":"ACTIVE"} desde IDEATION → 200
# DELETE /api/projects/[id] → 204
```

**Riesgo de regresión**: medio — endpoint nuevo con lógica de transición compleja

---

### T3.5 — Validar projectId en POST /api/notes y PATCH /api/notes/[id]

**Batch**: 3
**Archivos**:
- `app/api/notes/route.ts` (modificar — sección POST)
- `app/api/notes/[id]/route.ts` (modificar — sección PATCH)

**Cambio esperado**:
- En POST: aceptar `projectId?: string` del body; si presente, validar con `findOwnProjectOrThrow` antes de `prisma.note.create`; log `note.project.assigned` / `note.project.unassigned`; 400 con código específico si cuid inválido / no existe / no es del user
- En PATCH: aceptar `projectId?: string | null`; si `null` explícito → pasa null (desasigna); si string → ownership check; log events
- Pattern: mismo en ambos archivos (validación inline manual, sin Zod — consistencia con repo)

**Pre-requisitos**: T3.1, T2.1

**Validación**:
```bash
pnpm tsc --noEmit && pnpm prisma format && echo "ok"
# Smoke manual:
# POST /api/notes {"title":"X","content":"Y","domain":"PERSONAL","projectId":"invalid"} → 400 invalid_projectId_format
# POST /api/notes con projectId de otro user → 400 invalid_projectId_forbidden
```

**Riesgo de regresión**: medio — modifica endpoints existentes

---

### T4.1 — Modificar app/api/dashboard/route.ts con NOTE_SELECT_NEW_WITH_PROJECT

**Batch**: 4
**Archivos**:
- `app/api/dashboard/route.ts` (modificar)

**Cambio esperado**:
- Las 3 queries Task (focusTask, todayTasks, maintenanceTasks): cambiar `note: { select: NOTE_SELECT_NEW }` por `note: { select: NOTE_SELECT_NEW_WITH_PROJECT }`
- Extender `formatNoteBrief`: añadir `project: note.project ? { id, name, status } : null`
- Sección 6 (resurgenceNote): NO tocar — mantener `NOTE_SELECT_WITH_TASK_FLAG` sin project (D3)

**Pre-requisitos**: T1.6, T3.1

**Validación**:
```bash
pnpm tsc --noEmit && pnpm build && echo "ok"
# curl /api/dashboard | jq '.data.focusTask.note.project'  # null o {id,name,status}
```

**Riesgo de regresión**: medio — cambio en query principal

---

### T4.2 — Modificar otros endpoints con project en select

**Batch**: 4
**Archivos**:
- `app/api/hubs/[domain]/route.ts` (modificar)
- `app/api/notes/route.ts` (modificar — solo GET, POST ya en T3.5)
- `app/api/calendar/route.ts` (modificar)
- `app/api/search/route.ts` (modificar)

**Cambio esperado**:
- `hubs/[domain]`: GET usa `NOTE_SELECT_WITH_TASK_FLAG_PROJECT` en select
- `notes/route.ts` GET: usa `NOTE_SELECT_WITH_TASK_FLAG_PROJECT`
- `calendar/route.ts`: task.note usa `NOTE_SELECT_NEW_WITH_PROJECT` (cambiar `NOTE_SELECT_NEW`)
- `search/route.ts`: inline select → añadir `project: { select: PROJECT_BRIEF_SELECT }`
- `/api/graph`: NO tocar (D3 — grafo de Second Brain, sin project)

**Pre-requisitos**: T1.6, T3.1, T3.5

**Validación**:
```bash
pnpm tsc --noEmit && pnpm build && echo "ok"
# curl /api/hubs/proyectos | jq '.[].project'  # null o {id,name,status}
# curl /api/search?q=foo | jq '.results[].note.project'  # null o {id,name,status}
```

**Riesgo de regresión**: medio — modifica 4 endpoints existentes

---

### T4.3 — Verificar que GET /api/graph no se toca

**Batch**: 4
**Archivos**: ninguno (solo verificación)

**Cambio esperado**:
- Verificar que `app/api/graph/route.ts` no ha sido modificado (ni select ni lógica)
- El grafo es Note↔Note, project es metadata del contenedor — fuera de scope

**Pre-requisitos**: T4.2

**Validación**:
```bash
! grep -rE "projectId|project.*select" app/api/graph/route.ts && echo "ok"
```

**Riesgo de regresión**: bajo — solo verificación

---

### T5.1 — Crear components/ProjectBadge.tsx

**Batch**: 5
**Archivos**:
- `components/ProjectBadge.tsx` (crear)

**Cambio esperado**:
- Props: `project: ProjectBrief | null`
- Si `project === null` → no renderiza nada (null check interno)
- Color por status: IDEATION→`bg-gray-200 text-gray-700`, ACTIVE→`bg-green-100 text-green-800`, MAINTENANCE→`bg-blue-100 text-blue-800`, ARCHIVED→`bg-gray-300 text-gray-600` (dark: usar dark:)
- Texto: `project.name` truncado a 20 chars con ellipsis
- Tooltip: `title={project.name + ' · ' + project.status}`
- Tamaño: `text-xs px-1.5 py-0.5 rounded`
- A11y: `role="status"`, `aria-label="Proyecto: {name}, estado {status}"`
- Usar clsx o template literals seguros (no clases dinámicas puras — riesgo Tailwind purge)

**Pre-requisitos**: T4.1

**Validación**:
```bash
pnpm tsc --noEmit && pnpm build && echo "ok"
```

**Riesgo de regresión**: bajo — componente nuevo

---

### T5.2 — Extender app/(app)/page.tsx con badge de proyecto

**Batch**: 5
**Archivos**:
- `app/(app)/page.tsx` (modificar)

**Cambio esperado**:
- Añadir `project?: { id: string; name: string; status: string } | null` a la interfaz `TaskItem` inline
- En render de `focusTask`: añadir `<ProjectBadge project={item.note.project} />` en el encabezado del card
- En render de `todayTasks` y `maintenanceTasks`: añadir `<ProjectBadge project={item.note.project} />` en la línea de cada task
- Badge alineado a la derecha, antes de la fecha de dueDate

**Pre-requisitos**: T5.1, T4.1

**Validación**:
```bash
pnpm tsc --noEmit && pnpm build && echo "ok"
```

**Riesgo de regresión**: bajo — cambio aditivo, campo opcional; si no hay project el badge no renderiza

---

### T6.1 — Extender tests/helpers/factories.ts con createProject

**Batch**: 6
**Archivos**:
- `tests/helpers/factories.ts` (modificar)

**Cambio esperado**:
- Añadir `projectId?: string | null` a `NoteInput`
- En `createNote`: pasar `input.projectId` a `prisma.note.create`
- En `createNoteWithTask`: pasar `input.projectId` a la Note (dentro de la transacción)
- Nueva función `createProject(userId, input?)` → `Promise<Project>` con `id: id()`, `name: input?.name ?? 'Test project'`, `description: input?.description ?? null`, `status: input?.status ?? 'IDEATION'`

**Pre-requisitos**: T2.1, T3.1

**Validación**:
```bash
pnpm tsc --noEmit && echo "ok"
# Smoke: crear 1 project + 1 note con projectId y verificar en DB
```

**Riesgo de regresión**: medio — factoría compartida por todos los tests

---

### T6.2 — Crear tests/unit/projects.test.ts

**Batch**: 6
**Archivos**:
- `tests/unit/projects.test.ts` (crear)

**Cambio esperado**:
- `describe('validateTransition')`: 20 test cases cubriendo todas las combinaciones del DAG (4×4 + self transitions)
  - Casos inválidos: IDEATION→MAINTENANCE, MAINTENANCE→IDEATION, ARCHIVED→MAINTENANCE
  - Casos válidos: el resto del DAG + revive
  - Idempotencia: ACTIVE→ACTIVE = ok
  - Error en status desconocido: lanza TypeError
- `describe('formatProjectItem')`: Project → ProjectItem con fechas ISO
- `describe('formatProjectBrief')`: null→null; Project → solo {id,name,status}
- `describe('findOwnProjectOrThrow')`: 4 casos — format inválido, not_found, forbidden, happy path

**Pre-requisitos**: T3.1, T6.1

**Validación**:
```bash
pnpm test:unit && echo "ok"
```

**Riesgo de regresión**: bajo — tests nuevos

---

### T6.3 — Añadir 5 tests E2E a tests/e2e.spec.ts

**Batch**: 6
**Archivos**:
- `tests/e2e.spec.ts` (modificar)

**Cambio esperado** (5 tests nuevos):
- **E2E-1**: crear proyecto + asignar Note vía PATCH + crear Task → GET /api/dashboard verifica `todayTasks[0].note.project` = {id, name, IDEATION}
- **E2E-2**: PATCH /api/projects/[id] con transición inválida (ARCHIVED→MAINTENANCE) → 409 + `error.details.allowedFromCurrent = ['ACTIVE','IDEATION']`
- **E2E-3**: cadena completa `IDEATION→ACTIVE→MAINTENANCE→ARCHIVED→ACTIVE` (revive) → cada paso 200, status final ACTIVE
- **E2E-4**: DELETE /api/projects/[id] → `prisma.note.findUnique` con projectId=null (huérfana), `prisma.task.findUnique` con task sobrevive y nota apuntando a su note
- **E2E-5**: DELETE con embedding y NoteRelationship → verificar embedding tiene 1536 dims, NoteRelationship persiste

**Pre-requisitos**: T6.1, T6.2, T4.1, T5.2

**Validación**:
```bash
pnpm test:e2e && echo "ok"
```

**Riesgo de regresión**: medio — extiende archivo de tests compartido

---

### T7.1 — Ejecutar checklist humano de staging (9 puntos)

**Batch**: 7
**Archivos**: ninguno (smoke manual)

**Cambio esperado**: Ejecutar los 9 puntos del spec §6 en staging con cuenta real:
1. Crear proyecto "Test" vía POST /api/projects → 201 con ProjectItem
2. Asignar Note existente al proyecto vía PATCH /api/notes/[id] con projectId → 200
3. Verificar badge en dashboard: GET /api/dashboard devuelve `note.project: {id,name,status}`
4. Transiciones válidas: IDEATION→ACTIVE→MAINTENANCE→ARCHIVED → cada una 200
5. Transición inválida: ARCHIVED→MAINTENANCE → 409 con `invalidTransition` + `allowedFromCurrent`
6. Revivir: ARCHIVED→ACTIVE → 200, status=ACTIVE
7. Borrar proyecto → 204; verificar DB: `Note.projectId = null`, `Task.noteId` intacto
8. Buscar Note huérfana en /api/search → aparece
9. Verificar embedding pgvector: `SELECT embedding FROM "Note" WHERE id = ?` → 1536 dims

**Pre-requisitos**: T6.3

**Validación**:
```bash
# No comando automático — verificación humana
# Tras ejecutar los 9 puntos: marcar T7.1 como done
```

**Riesgo de regresión**: bajo — smoke manual en staging

---

## 3. Grafo de dependencias

```
T1.1 ─┬─> T1.2 ─> T1.3 ─> T2.1 ─> T2.2 ─────────────────────────────────────────────────────────┐
       ├─> T1.4 ─> T1.5 ─> T1.6 ─┤                                                            │
       └───────────────────────────┘                                                            │
                                    ├─> T3.1 ─┬─> T3.3 ─> T3.4 ─> T3.5 ─┐                      │
                                    ├─> T3.2 ─┤                          │                      │
                                    │         │                          │                      │
                                    │         └──────────────────────────┘                      │
                                    │                                                            │
                                    ├─> T4.1 ─> T4.2 ─> T4.3 ──────────────────────────────────┤
                                    │                                                            │
                                    │                                                            ├─> T5.1 ─> T5.2 ─┐
                                    │                                                            │                  ├─> T6.1 ─> T6.2 ─> T6.3 ─> T7.1
                                    │                                                            │                  │
                                    └────────────────────────────────────────────────────────────┘
```

**Paralelización dentro de Batch 3**:
- T3.1 y T3.2 pueden desarrollarse en paralelo (mismo pre-requisito T1.4)
- T3.3, T3.4, T3.5 dependen de T3.1 y T3.2

**Paralelización dentro de Batch 4**:
- T4.2 puede empezar tras T1.6 y T3.1 (tiene selectores disponibles)
- T4.1 depende de T1.6

---

## 4. Orden de PRs (7 batches)

| PR # | Batch | contenido | Pre-requisito para merge |
|------|-------|-----------|--------------------------|
| #1 | Batch 1 | T1.1–T1.6: Schema + tipos + selectores | Ninguno |
| #2 | Batch 2 | T2.1–T2.2: Migration | #1 mergeado |
| #3 | Batch 3 | T3.1–T3.5: Endpoints Projects + lib | #2 aplicado en staging |
| #4 | Batch 4 | T4.1–T4.3: Dashboard + queries existentes | #3 mergeado |
| #5 | Batch 5 | T5.1–T5.2: Frontend badge | #4 mergeado |
| #6 | Batch 6 | T6.1–T6.3: Tests | #5 mergeado |
| #7 | Batch 7 | T7.1: Smoke manual | #6 tests verdes |

**Deploy**: atómico tras PR #7 mergeado. Los 7 PRs se mergean en secuencia, el deploy se ejecuta una sola vez al final.

---

## 5. Definition of Done global

Ejecutable tras T6.3 (última tarea automática antes del smoke):

```bash
pnpm tsc --noEmit && echo "[OK] tsc"
pnpm prisma format && echo "[OK] prisma format"
pnpm prisma migrate deploy && echo "[OK] migrate deploy"
pnpm test:unit && echo "[OK] test:unit"
pnpm test:e2e && echo "[OK] test:e2e"
pnpm build && echo "[OK] build"
! grep -rE "task\.projectId|Task\.projectId" app/ lib/ --include="*.ts" --include="*.tsx" && echo "[OK] D4: Task sin projectId"
! grep -rE "/api/today\b" app/ components/ lib/ --include="*.ts" --include="*.tsx" && echo "[OK] path canónico"
grep -rE "PROJECT_TRANSITIONS\[" app/ lib/ --include="*.ts" && echo "[OK] transitions usadas"
```

**Smoke humano** (T7.1): 9/9 puntos del checklist staging ✅

---

## 6. Riesgos top del design §13.1

- **P1 — Validación de transición en app layer**: un bug futuro podría saltarse `validateTransition` si se añade un nuevo path de update. Mitigación: E2E-2 (T6.3) + unit 20/20 (T6.2).
- **P1 — Refactor de selectores rompe E2E con shape exacto**: tests con `toEqual`/`toMatchObject` sobre items del dashboard. Mitigación: grep previo en `tests/e2e.spec.ts` por asserts de shape antes del merge de #4.
- **P2 — prisma migrate dev genera SQL inesperado**: podría añadir/dropear columnas por sorpresa. Mitigación: revisar migration.sql línea por línea contra spec §5 antes de mergear #2.
- **P2 — Ownership check añade 1 query por write**: POST/PATCH de Note con projectId hace 2 queries en vez de 1. Mitigación: aceptable en single-user; documentado.
- **P2 — Note huérfana pierde visibilidad de "antes era de X"**: no hay badge tras borrar proyecto. Mitigación: documentado, no bloquea MVP.

---

## 7. Out of scope (consolidado del design §14)

1. UI dedicada de Projects (lista, detalle, gestión) — YAGNI, D7.
2. Endpoint `/api/projects/[id]/dashboard` — YAGNI, D7.
3. Filtro `?projectId=` en `/api/dashboard` — YAGNI, D3.
4. Vista "proyectos recientes" en sidebar — YAGNI.
5. Stats/contadores UI de proyectos — YAGNI.
6. Recurrencia de Projects (templates, clones) — no aplica.
7. Soft-delete de Project — D6, `status=ARCHIVED` cubre.
8. Multi-tenant / RLS — single-user, D5.
9. Trigger de Postgres para validar transiciones — sobre-ingeniería single-user.
10. Snapshot tests de contratos API — bajo valor, responses simples.
11. i18n / traducciones del badge — MVP en español.
12. Editor de Project CRUD UI — badge solo lectura en MVP.
13. Drag-and-drop Note → Project en UI — asignación vía PATCH /api/notes/[id].
14. Permisos por proyecto (compartir) — multi-tenant out of scope.
15. Endpoint `/api/projects/[id]/transition` separado — PATCH con `status` cubre.
16. Historial de transiciones (`ProjectHistory` table) — `updatedAt` suficiente.
17. Soft-delete con `deletedAt` — D6.

---

## 8. Result Contract

```
## Result Contract
- Fase: brain-tasks (Fase 4)
- Status: done
- Artefacto: docs/sdd/active/projects-engine/tasks.md
- Insumos consumidos: deep-think.md + explore.md + spec.md + design.md (con fixes C1-C4 aplicados)
- Insumos producidos para el APPROVAL GATE (usuario):
  1. 21 tareas atómicas numeradas T1.1 – T7.1
  2. Grafo de dependencias entre tareas
  3. Orden de PRs (7 batches secuenciales, deploy atómico)
  4. DoD binario ejecutable (10 checks bash)
  5. Mapeo de 5 riesgos top → tareas mitigadoras
- Próxima fase: STOP en APPROVAL GATE — el usuario revisa tasks.md y da GO antes de brain-apply
- Si usuario aprueba: brain-apply ejecuta las tareas en orden de dependencias
- Riesgos top para orchestrator:
  - P1: app-layer transition validation (E2E-2 + unit 20/20 la mitigan)
  - P1: selector refactor puede romper E2E con shape exacto (grep previo mitiga)
  - P2: prisma migrate dev SQL inesperado (revisión manual mitiga)
  - P2: ownership check +1 query por write (aceptable single-user)
  - P2: Note huérfana pierde badge (documentado, no bloquea)
```

---

## Tabla resumen (APPROVAL GATE)

| ID | Batch | Título | Archivos | Riesgo |
|----|-------|--------|----------|--------|
| T1.1 | 1 | Añadir enum ProjectStatus + model Project | `prisma/schema.prisma` | bajo |
| T1.2 | 1 | Añadir projectId + relación + índice a Note | `prisma/schema.prisma` | bajo |
| T1.3 | 1 | Añadir relación inversa projects a User | `prisma/schema.prisma` | bajo |
| T1.4 | 1 | Crear lib/types/project.ts | `lib/types/project.ts` | bajo |
| T1.5 | 1 | Extender note.ts y task.ts | `lib/types/note.ts`, `lib/types/task.ts` | bajo |
| T1.6 | 1 | Extender hubs.ts con selectores | `lib/hubs.ts` | bajo |
| T2.1 | 2 | Generar migration add_project | `prisma/migrations/<ts>_add_project/` | bajo |
| T2.2 | 2 | Verificar migration en staging | (psql staging) | bajo |
| T3.1 | 3 | Crear lib/projects.ts | `lib/projects.ts` | bajo |
| T3.2 | 3 | Crear lib/rate-limit.ts | `lib/rate-limit.ts` | bajo |
| T3.3 | 3 | Crear POST+GET /api/projects | `app/api/projects/route.ts` | medio |
| T3.4 | 3 | Crear GET+PATCH+DELETE /api/projects/[id] | `app/api/projects/[id]/route.ts` | medio |
| T3.5 | 3 | Validar projectId en notes POST+PATCH | `app/api/notes/route.ts`, `app/api/notes/[id]/route.ts` | medio |
| T4.1 | 4 | Dashboard con NOTE_SELECT_NEW_WITH_PROJECT | `app/api/dashboard/route.ts` | medio |
| T4.2 | 4 | Extender hubs/calendar/search/notes GET | 4 archivos | medio |
| T4.3 | 4 | Verificar /api/graph no se toca | (grep) | bajo |
| T5.1 | 5 | Crear ProjectBadge.tsx | `components/ProjectBadge.tsx` | bajo |
| T5.2 | 5 | Badge en dashboard page.tsx | `app/(app)/page.tsx` | bajo |
| T6.1 | 6 | Extender factories con createProject | `tests/helpers/factories.ts` | medio |
| T6.2 | 6 | Crear unit projects.test.ts | `tests/unit/projects.test.ts` | bajo |
| T6.3 | 6 | 5 E2E tests nuevos | `tests/e2e.spec.ts` | medio |
| T7.1 | 7 | Smoke manual staging (9 puntos) | (humano) | bajo |

**Total: 21 tareas — 7 batches — 1 deploy atómico**
