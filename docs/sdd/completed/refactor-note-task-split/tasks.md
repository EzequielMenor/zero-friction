# Tasks: Refactor Note → Note + Task

**Proyecto**: `zero-friction`
**Sesión**: `refactor-note-task-split-2026-07-08`
**Fase**: brain-tasks (Fase 4)
**Estado**: `done`
**Persistence**: `docs/sdd/active/refactor-note-task-split/tasks.md`

---

## 1. Lista de tareas atómicas

### T-01: Actualizar Prisma schema con Task + noteStatus
- **Archivos**: `prisma/schema.prisma`
- **Descripción**: Añadir modelo `Task`, añadir columna `noteStatus` en `Note`, nuevos enums `NoteStatus` (3 valores) y `TaskStatus` (2 valores), relaciones inversas en `User`. **NO eliminar** las columnas legacy (`status`, `dueDate`, `isImportant`) todavía.
- **Cambio concreto**:
  - Nuevo enum `TaskStatus { OPEN, DONE }`
  - Nuevo enum `NoteStatus { DRAFT, NEEDS_REVIEW, ACTIVE }` (reemplaza viejo de 5 valores)
  - Nuevo modelo `Task` con campos: `id`, `noteId` (UNIQUE), `userId`, `status`, `dueDate`, `isImportant`, `focusedAt`, `completedAt`, `createdAt`, `updatedAt`
  - Nota: agregar `noteStatus NoteStatus @default(DRAFT)` a `Note`
  - Nota: agregar `task Task?` y `tasks Task[]` relaciones
- **Pre-requisitos**: ninguno
- **Validación**: `pnpm prisma format && pnpm prisma generate && pnpm tsc --noEmit`
- **DoD binario**: `pnpm prisma generate` genera el cliente sin errores; el schema incluye `model Task` y `noteStatus` en `Note`; no se ha eliminado ninguna columna legacy
- **Estimación**: M
- **Riesgo**: bajo
- **Batch**: 1

---

### T-02: Migration A — crear tabla Task + columna noteStatus
- **Archivos**: `prisma/migrations/<ts>_split_note_task/migration.sql`
- **Descripción**: Crea enum `TaskStatus`, tabla `Task` vacía, columna `noteStatus` en `Note` con default `'ACTIVE'`. No elimina nada. No crea constraints/índices (se hacen en Migration B).
- **Cambio concreto** (spec §4.1):
  - `CREATE TYPE "TaskStatus" AS ENUM ('OPEN', 'DONE')`
  - `CREATE TABLE "Task" (...)` con FK y UNIQUE `noteId`, sin índices todavía
  - `CREATE TYPE "NoteStatusNew" AS ENUM ('DRAFT', 'NEEDS_REVIEW', 'ACTIVE')`
  - `ALTER TABLE "Note" ADD COLUMN "noteStatus" "NoteStatusNew" NOT NULL DEFAULT 'ACTIVE'`
- **Pre-requisitos**: T-01
- **Validación**:
  ```bash
  pnpm prisma migrate dev --name split_note_task
  psql -c "SELECT COUNT(*) FROM \"Task\";"          # = 0 (vacía)
  psql -c "SELECT column_name FROM information_schema.columns WHERE table_name='Note' AND column_name='noteStatus';"  # devuelve noteStatus
  ```
- **DoD binario**: Migration A aplicada; Task existe y está vacía; Note tiene columna `noteStatus`; las columnas legacy (`status`, `dueDate`, `isImportant`) siguen existiendo
- **Estimación**: M
- **Riesgo**: bajo (es aditiva)
- **Batch**: 2

---

### T-03: Script de backfill — poblar Task desde Notes existentes
- **Archivos**: `prisma/backfill-notes-to-tasks.ts`
- **Descripción**: Script TS ejecutable con `pnpm tsx prisma/backfill-notes-to-tasks.ts`. Flujo: dry-run (proyección de counts) → validación pre → UPDATE noteStatus para todas las Notes → INSERT Tasks según mapping spec §1.6 → validación post. Flags: `--apply`, `--resume`.
- **Cambio concreto** (spec §4.3):
  - Paso (B.5): `UPDATE Note SET noteStatus = CASE status::text...` (todas las Notes)
  - Insert Tasks para: `IN_PROGRESS`, `DONE`, `ACTIVE` con `dueDate != null` o `isImportant == true`
  - `focusedAt = Note.updatedAt` si `status = 'IN_PROGRESS'`
  - `completedAt = Note.updatedAt` si `status = 'DONE'`
  - Igeneración de `cuid()` con `createId()` de `cuid`
  - `--resume`: salta Notes con Task ya existente
  - Recuperación: `DELETE FROM "Task"` + re-run
- **Pre-requisitos**: T-02 aplicado en staging
- **Validación**:
  ```bash
  pnpm tsx prisma/backfill-notes-to-tasks.ts                   # dry-run
  # Revisar distribución de status y proyección de Tasks
  pnpm tsx prisma/backfill-notes-to-tasks.ts --apply           # ejecutar
  # Validación post automática
  psql -c "SELECT COUNT(*) FROM \"Task\";"             # > 0
  psql -c "SELECT COUNT(*) FROM \"Note\" WHERE \"noteStatus\" IS NULL;"  # = 0
  ```
- **DoD binario**:
  - `Tasks creadas = IN_PROGRESS_count + DONE_count + ACTIVE_con_dueDate_isImportant_count` (verificado con dry-run)
  - `COUNT(Note WHERE noteStatus IS NULL) = 0`
  - `COUNT(Task WHERE noteId NOT IN (SELECT id FROM Note)) = 0` (sin huérfanas)
  - Snapshot manual: 5 Notes spot-checkeadas (1 IN_PROGRESS → Task OPEN con focusedAt, 1 DONE → Task DONE con completedAt, 1 ACTIVE con dueDate → Task OPEN, 1 ACTIVE sin nada → sin Task, 1 DRAFT → sin Task)
- **Estimación**: L
- **Riesgo**: **ALTO** (pérdida de datos si el CASE del mapping está mal)
- **Mitigación**: dry-run siempre primero; `--resume` para recuperación; validación post con counts exactos; snapshot manual de 5 casos
- **Batch**: 3

---

### T-04: Migration B — constraints + drop columnas legacy
- **Archivos**: `prisma/migrations/<ts>_drop_legacy_note_fields/migration.sql`
- **Descripción**: Aplica constraints, índices y limpieza final. Migration B **no** se aplica en producción hasta que T-03 esté validado.
- **Cambio concreto** (spec §4.2):
  - `ALTER TABLE "Task" ADD CONSTRAINT "Task_completedAt_required_if_done" CHECK (status <> 'DONE' OR "completedAt" IS NOT NULL)`
  - `CREATE INDEX "Task_userId_status_idx" ON "Task"("userId", "status")`
  - `CREATE INDEX "Task_userId_dueDate_idx" ON "Task"("userId", "dueDate")`
  - `CREATE UNIQUE INDEX "Task_one_focus_per_user" ON "Task"("userId") WHERE "focusedAt" IS NOT NULL`
  - `ALTER TABLE "Note" DROP COLUMN "status"`, `DROP COLUMN "dueDate"`, `DROP COLUMN "isImportant"`
  - `ALTER TABLE "Note" ALTER COLUMN "noteStatus" DROP DEFAULT; SET DEFAULT 'DRAFT'`
  - `ALTER TYPE "NoteStatusNew" RENAME TO "NoteStatus"`
  - `CREATE INDEX "Note_userId_noteStatus_idx" ON "Note"("userId", "noteStatus")`
- **Pre-requisitos**: T-03 validado en staging; Batches 4a y 4b mergeados a main
- **Validación**:
  ```bash
  pnpm prisma migrate deploy
  psql -c "SELECT conname FROM pg_constraint WHERE conrelid='\"Task\"'::regclass;"   # incluye Task_completedAt_required_if_done
  psql -c "SELECT indexname FROM pg_indexes WHERE tablename='Task';"                 # incluye Task_one_focus_per_user
  psql -c "\d \"Note\""                                        # NO incluye status, dueDate, isImportant
  psql -c "SELECT enumlabel FROM pg_enum WHERE enumtypid = 'NoteStatus'::regtype;"  # 3 valores: DRAFT, NEEDS_REVIEW, ACTIVE
  # Test del partial unique: intentar crear 2 Tasks con focusedAt para el mismo usuario → debe fallar
  ```
- **DoD binario**: Las 3 columnas legacy **NO existen** en la tabla Note; enum `NoteStatus` tiene exactamente 3 valores; CHECK constraint activo; partial unique index activo
- **Estimación**: M
- **Riesgo**: **ALTO** (es destructivo — DROP COLUMN — irreversible sin snapshot)
- **Mitigación**: snapshot DB pre-deploy (Supabase branch o `pg_dump`); rollback plan documentado en design §5; ventana de mantenimiento coordinada
- **Batch**: 5

---

### T-05: API code switch — endpoints core
- **Archivos**: `app/api/notes/route.ts`, `app/api/notes/[id]/route.ts`, `app/api/notes/[id]/process/route.ts`, `app/api/notes/[id]/accept-goal/route.ts`, `app/api/tasks/[id]/route.ts`, `app/api/tasks/[id]/focus/route.ts`, `app/api/tasks/[id]/unfocus/route.ts`, `app/api/tasks/[id]/complete/route.ts`
- **Descripción**: Reescritura completa de los 8 endpoints core para usar el modelo nuevo. Transacciones Prisma. REGISTROS envuelto en `$transaction`. Manejo de `P2002` → 409 `taskExists`. El `/api/dashboard` y `/api/capture` son tareas separadas (T-06, T-07).
- **Cambio concreto por endpoint**:
  - `POST /api/notes`: response usa `NoteItem` (sin `dueDate`/`isImportant`/`status`)
  - `PATCH /api/notes/[id]`: solo acepta `{title, content, tags, domain}` — elimina `status`/`dueDate`/`isImportant` del body Zod
  - `POST /api/notes/[id]/process`: flujo tripartito (pre-tx LLM, tx CAS+Task, post-tx embedding); REGISTROS en `$transaction`
  - `POST /api/notes/[id]/accept-goal`: `$transaction([task.create, note.update])`; `P2002` → 409
  - `PATCH /api/tasks/[id]`: solo acepta `{dueDate, isImportant}`
  - `POST /api/tasks/[id]/focus`: `$transaction([updateMany desenfocar, updateMany enfocar])`; CAS en paso 2
  - `POST /api/tasks/[id]/unfocus`: `updateMany` con `focusedAt: null`
  - `POST /api/tasks/[id]/complete`: `updateMany` con `status: 'DONE'`, `completedAt: now()`
- **Pre-requisitos**: T-01, T-02, T-03
- **Validación**:
  ```bash
  pnpm prisma format
  pnpm tsc --noEmit
  grep -rE "note\.status\b|note\.dueDate\b|note\.isImportant\b" app/api/ lib/ --include="*.ts"
  # Debe devolver 0 resultados
  pnpm test:unit   # tests de API (T-10)
  ```
- **DoD binario**: Los 8 endpoints compilan; `grep` de refs legacy = 0; unit tests de API verdes (T-10); REGISTROS es transaccional verificado con test de rollback
- **Estimación**: L (más de 3 archivos/100 líneas — subdividir si el PR supera 400 líneas)
- **Riesgo**: **ALTO** (`/api/dashboard` 100% reescrito y `/api/notes/[id]/process` restructure tripartita)
- **Mitigación**: grep post-refactor; unit tests de cada endpoint; typecheck obligatorio antes de PR
- **Batch**: 4a

---

### T-06: Nuevo endpoint /api/dashboard + /api/capture
- **Archivos**: `app/api/dashboard/route.ts` (**NUEVO**), `app/api/today/route.ts` (**ELIMINAR**), `app/api/capture/route.ts` (**NUEVO**), `lib/parse-capture.ts` (**modificado**)
- **Descripción**:
  - `/api/dashboard`: 6 secciones en `Promise.all` (focusTask, todayTasks, maintenanceTasks, habits, dueSubscription, resurgenceNote). Optimización N+1 de habits (un solo `habitLog.findMany` con `habitId: { in: habitIds }`).
  - `/api/capture`: crea Note con `noteStatus='DRAFT'`; si `parsed.isExecutable`, crea Task en la misma tx.
  - `lib/parse-capture.ts`: `enrichDraftNote` usa `WHERE noteStatus='ACTIVE'` (era `status='ACTIVE'`); `dueDate`/`isImportant` van a `Task.create`.
- **Cambio concreto**:
  - Crear `app/api/dashboard/route.ts` con las 6 queries en `Promise.all`
  - Eliminar `app/api/today/route.ts` (tras verificar que dashboard lo consume)
  - Crear `app/api/capture/route.ts` con creación transaccional de Note + Task
  - Modificar `lib/parse-capture.ts`: raw SQL `WHERE noteStatus='ACTIVE'`; mover campos a Task
- **Pre-requisitos**: T-01, T-02, T-03
- **Validación**:
  ```bash
  GET /api/dashboard  # devuelve las 6 secciones: focusTask, todayTasks, maintenanceTasks, habits, dueSubscription, resurgenceNote
  POST /api/capture   # crea Note noteStatus='DRAFT'; si isExecutable, crea Task en tx
  ```
- **DoD binario**: `GET /api/dashboard` devuelve `DashboardResponse` con 6 secciones correctas; `POST /api/capture` crea Note DRAFT + Task transaccionalmente
- **Estimación**: M
- **Riesgo**: medio
- **Batch**: 4a

---

### T-07: API search + calendar actualizados
- **Archivos**: `app/api/search/route.ts`, `app/api/calendar/route.ts`
- **Descripción**:
  - `/api/search`: devuelve Note con `task: { select: { id, isImportant, dueDate, status } }` anidada; `hasTask = Boolean(note.task)`
  - `/api/calendar`: queries sobre Task con `dueDate` en vez de Note
- **Pre-requisitos**: T-01, T-02, T-03
- **Validación**: `pnpm tsc --noEmit`; tests existentes de calendar/search siguen pasando
- **DoD binario**: Calendar muestra Tasks (no Notes) agrupadas por `dueDate`; Search devuelve `hasTask` correcto
- **Estimación**: S
- **Riesgo**: bajo
- **Batch**: 4a

---

### T-08: UI — Dashboard + NotePanel + InboxSection
- **Archivos**: `components/dashboard/Dashboard.tsx`, `components/notepanel/NotePanel.tsx`, `components/InboxSection.tsx`, `components/capture/CaptureOverlay.tsx`
- **Descripción**: Actualizar componentes React para consumir shapes nuevos de `/api/dashboard` y separar ediciones de Note y Task.
- **Cambio concreto**:
  - `Dashboard.tsx` (~750 líneas): ~10 refs `note.status`/`dueDate`/`isImportant` → `task.*`. Renderiza 6 secciones de `DashboardResponse`. Cada `TodayItem` es `{ task, note }`.
  - `NotePanel.tsx`: edición dividida — `PATCH /api/notes/[id]` para title/content/tags/domain; `PATCH /api/tasks/[id]` para dueDate/isImportant. Dos optimistic updates en paralelo con `Promise.allSettled` y rollback independiente.
  - `InboxSection.tsx`: `note.status` → `note.noteStatus`
  - `CaptureOverlay.tsx`: sin cambios funcionales (solo verificar que sigue apuntando a `/api/notes`)
- **Pre-requisitos**: T-05, T-06 (endpoint `/api/dashboard` estable)
- **Validación**:
  ```bash
  pnpm tsc --noEmit
  grep -rE "note\.status\b|note\.dueDate\b|note\.isImportant\b" components/ --include="*.tsx"
  # Debe devolver 0 resultados
  pnpm build   # Next.js build sin errores
  ```
- **DoD binario**: Dashboard muestra las 6 secciones con datos correctos; NotePanel edita Note y Task por separado; Inbox muestra solo DRAFTs; `pnpm build` = 0 errores
- **Estimación**: L (Dashboard ~750 líneas, ~10 refs)
- **Riesgo**: **ALTO** (regression visual/funcional en el componente más grande del proyecto)
- **Mitigación**: tipos en `lib/types/` para que TS atrape refs rotas en compile time; E2E con factorías (T-09); snapshot tests (T-11)
- **Batch**: 4b

---

### T-09: Test factories
- **Archivos**: `tests/helpers/factories.ts` (**NUEVO**)
- **Descripción**: Factorías para crear datos de test en transacciones. Signatures exactas (spec §3, design §6.1):
  - `createNote(userId, input?)` → `Note`
  - `createNoteWithTask(userId, noteInput?, taskInput?)` → `{ note, task }`
  - `createFocusedTask(userId, input?)` → `{ note, task }` con `focusedAt = now()`
  - `createCompletedTask(userId, input?)` → `{ note, task }` con `status = 'DONE'`, `completedAt = now()`
  - `cleanupTestData(userId)` → borra todas las Tasks y Notes del usuario
- **Cambio concreto**: Usa `createId()` de `cuid` para IDs; `title` default `''` (no null); `noteStatus` default `'ACTIVE'` en `createNoteWithTask` (para que la Note sea procesable)
- **Pre-requisitos**: T-01 (schema actualizado con Task)
- **Validación**:
  ```bash
  # Smoke: crear 1 note + 1 task y leer de vuelta
  pnpm tsx tests/helpers/factories.ts  # o test manual
  ```
- **DoD binario**: Las 4 factorías compilan y crean datos consistentes en DB; cleanup no deja huérfanas
- **Estimación**: M
- **Riesgo**: medio (factoría con mal default rompe varios tests a la vez)
- **Mitigación**: smoke test de crear 1 note + 1 task y verificar que se lee correctamente de DB
- **Batch**: 6

---

### T-10: E2E tests reescritos
- **Archivos**: `tests/e2e.spec.ts` (líneas 67–313)
- **Descripción**: Reescribir seeds de E2E usando factorías. Actualizar asserts:
  - `note.status === 'IN_PROGRESS'` → `task.focusedAt !== null`
  - `note.dueDate` → `task.dueDate`
  - `note.isImportant` → `task.isImportant`
  - Nuevos scenarios: focus toggle, focus-on-DONE-409, complete, edit task, accept-goal happy, accept-goal 409, cascade delete, focus race, inbox DRAFT-only, dashboard sin foco
- **Pre-requisitos**: T-08 (UI actualizada), T-09 (factorías disponibles)
- **Validación**: `pnpm test:e2e` — verde, sin errores, sin skips
- **DoD binario**: Todos los tests E2E pasan; `grep -rE "note\.status\b|note\.dueDate\b|note\.isImportant\b" tests/` = 0 resultados
- **Estimación**: M
- **Riesgo**: medio
- **Batch**: 6

---

### T-11: Unit tests nuevos
- **Archivos** (nuevos o ampliados):
  - `lib/parse-capture.test.ts`
  - `app/api/tasks/[id]/focus/route.test.ts`
  - `app/api/tasks/[id]/unfocus/route.test.ts`
  - `app/api/tasks/[id]/complete/route.test.ts`
  - `app/api/notes/[id]/accept-goal/route.test.ts`
  - `app/api/dashboard/route.test.ts`
  - `prisma/backfill.test.ts`
- **Descripción**: Tests unitarios para funciones puras del refactor. Cobertura exacta de scenarios en spec §6 y design §6.3.
- **Scenarios covered**:
  - Backfill: IN_PROGRESS → Task OPEN, focusedAt=updatedAt; DONE → Task DONE, completedAt=updatedAt; ACTIVE con dueDate → Task OPEN; ACTIVE sin nada → no Task; DRAFT/NEEDS_REVIEW → no Task; ACTIVE con isImportant=true → Task OPEN
  - Process: ejecutable → tx (updateMany + task.create); no ejecutable → solo updateMany; AI fail → NEEDS_REVIEW sin Task; REGISTROS → tx atómica
  - Focus: 2 tasks → solo 1 con focusedAt; Task DONE → 409
  - Unfocus: id existente con focusedAt → null
  - Complete: OPEN → DONE con completedAt; DONE → 409
  - Accept-goal: sin Task → crea; con Task → 409 taskExists
  - Dashboard: 0 tasks → null/vacías; con focus → focusTask correcto
- **Pre-requisitos**: T-05, T-06
- **Validación**: `pnpm test:unit` — todos pasan
- **DoD binario**: Todos los scenarios de spec §6 + design §6.3 cubiertos y pasando
- **Estimación**: M
- **Riesgo**: bajo
- **Batch**: 7

---

### T-12: Snapshot tests
- **Archivos**: `tests/snapshots/api-dashboard.test.ts`, `tests/snapshots/api-notes-id.test.ts`
- **Descripción**: Captura del response shape de `GET /api/dashboard` y `GET /api/notes/[id]`. Con factorías para crear datos predecibles.
- **Pre-requisitos**: T-05, T-06, T-08
- **Validación**:
  ```bash
  pnpm test:snapshots
  # Si shapes cambian intencionalmente: pnpm test:snapshots -u y revisar diff
  ```
- **DoD binario**: Snapshots existen, matchean implementación actual, y se actualizan solo cuando el cambio es intencional
- **Estimación**: S
- **Riesgo**: bajo
- **Batch**: 8

---

### T-13: Documentación actualizada
- **Archivos**: `openwiki/auth-and-data.md`, `openwiki/architecture.md`, `openwiki/quickstart.md`, `README.md`, `docs/sdd/active/refactor-note-task-split/ADR.md` (**NUEVO**)
- **Descripción**: Actualizar docs con nuevo modelo Note ↔ Task. ADR con las decisiones cerradas (1:1, cascade delete, partial unique index, CHECK constraint, split NotePanel en 2 PATCHes, rename /api/today → /api/dashboard, accept-goal 409 no upsert).
- **Cambio concreto**: search/replace de referencias a `NoteStatus_old`, `note.status`, `dueDate` en Note, `isImportant` en Note por el nuevo modelo
- **Pre-requisitos**: T-05, T-06, T-08
- **Validación**:
  ```bash
  grep -rE "NoteStatus_old|note\.status\b|note\.dueDate\b|note\.isImportant\b" docs/ openwiki/ README.md
  # 0 resultados relevantes (comentarios históricos se ignoran)
  ```
- **DoD binario**: Docs actualizadas con modelo nuevo; ADR.md existe con las 10+ decisiones documentadas
- **Estimación**: S
- **Riesgo**: ninguno
- **Batch**: 9

---

### T-14: Verificación end-to-end final + typecheck global
- **Descripción**: Smoke manual del flujo completo + verificación de que no quedan refs legacy en ningún archivo.
- **Checklist funcional (humano en staging)**:
  - [ ] Login con cuenta de staging
  - [ ] Capture texto → Note DRAFT aparece en Inbox
  - [ ] Process → Task aparece en Dashboard (si ejecutable)
  - [ ] Click "Focus" → Task enfocada (badge/estilo)
  - [ ] Click "Complete" → Task pasa a DONE con `completedAt`
  - [ ] Calendar → Tasks en su `dueDate`
  - [ ] Editar Note (title/content/tags/domain) → persiste
  - [ ] Editar Task (dueDate/isImportant) desde NotePanel → persiste en Task
  - [ ] Borrar Note → Task también desaparece (cascade)
  - [ ] Dos clicks rápidos en Focus de Tasks distintas → solo 1 queda con `focusedAt` (partial unique index protege)
- **Validación automática**:
  ```bash
  pnpm tsc --noEmit && pnpm test:unit && pnpm test:e2e && pnpm test:snapshots
  ! grep -rE "note\.status\b|note\.dueDate\b|note\.isImportant\b" app/ components/ lib/ tests/ --include="*.ts" --include="*.tsx"
  ! grep -rE "status:\s*true|dueDate:\s*true|isImportant:\s*true" lib/hubs.ts
  ```
- **Pre-requisitos**: T-05, T-06, T-07, T-08, T-09, T-10, T-11, T-12
- **DoD binario**: Checklist 10/10 + comandos automáticos 0 errores
- **Estimación**: S
- **Riesgo**: bajo
- **Batch**: 10

---

## 2. Orden de ejecución (grafo de dependencias)

```
[T-01 Schema] ──▶ [T-02 Migration A] ──▶ [T-03 Backfill] ──▶ [T-04 Migration B]
                      │                      │
                      │                      ▼
                      │               (validado en staging)
                      │
                      ▼
[T-05 API routes] ◀──┤
[T-06 /api/dashboard+capture] ◀┤
[T-07 search+calendar] ◀────────┤
      │
      ▼
[T-09 Factories] ──▶ [T-10 E2E rewrite]
      │
      ▼
[T-11 Unit tests]
      │
[T-12 Snapshots] ──▶ [T-14 Final verification]
      │
[T-13 Docs] ───────▶ [T-14 Final verification]
      │
[T-08 UI] ◀───────────────────────────────┘
      │
      ▼
[T-14 Final verification]
```

**Paralelización dentro de Batch 4a y 4b**:
- T-05, T-06, T-07 pueden desarrollarse en paralelo (son endpoints independientes que comparten el schema de T-01)
- T-08 (UI) es secuencial después de T-05 y T-06
- T-09 (factories) puede empezar tras T-01, antes de que las routes estén terminadas
- T-10 (E2E) necesita T-09 y T-08

---

## 3. Refinamiento de batches

> Los 10+ batches de `design.md` se consolidan en **6 batches lógicos** (4 deployables + 1 de testing + 1 final).

### Batch 1 — Fundacionales (paralelo)
**Objetivo**: Base sobre la que todo lo demás se construye.
- T-01: Prisma schema (Task + noteStatus aditivos)
- T-13: Docs (puede escribirse en paralelo — no toca código)
- T-14 grep parcial (verificación post-T-01: `grep legacy refs` = 0)

**Entregable**: PR #1 — Schema estable + types en `lib/types/` + docs skeleton.

### Batch 2 — Migration A en staging
**Objetivo**: Crear tabla Task vacía + columna noteStatus en Note.
- T-02: Migration A (`prisma migrate dev --name split_note_task`)

**Entregable**: PR #2 — Migration A aplicada a staging. Validada manualmente.

### Batch 3 — Backfill en staging
**Objetivo**: Poblar Task con datos existentes y validar counts.
- T-03: Backfill script + ejecución

**Entregable**: PR #3 — Script de backfill + validación de counts en staging. **🔒 GATE**: si los counts del dry-run no cuadran, no avanzar.

### Batch 4a — Code switch backend (paralelo con 4b)
**Objetivo**: Reescribir API routes y lib para usar el modelo nuevo.
- T-05: API routes core (8 endpoints)
- T-06: `/api/dashboard` + `/api/capture` + `lib/parse-capture.ts`
- T-07: `/api/search` + `/api/calendar`
- T-11: Unit tests (parcial — pueden empezar tras T-05/T-06)

**Entregable**: PR #4a — Backend refactorizado. Typecheck verde. Grep legacy refs = 0.

### Batch 4b — Code switch UI
**Objetivo**: Actualizar componentes React para consumir endpoints nuevos.
- T-08: UI components (Dashboard, NotePanel, InboxSection)

**Pre-requisito**: T-05 y T-06 mergeados (endpoint `/api/dashboard` estable).
**Entregable**: PR #4b — UI actualizada. Build verde. Consume shapes nuevos.

**Nota**: 4a y 4b se desarrollan en paralelo pero 4b consume los endpoints de 4a. Si 4a necesita hotfix, 4b puede continuar con los cambios ya mergeados.

### Batch 5 — Migration B en producción
**Objetivo**: Constraints + drop columnas legacy.
- T-04: Migration B

**🔒 GATE**: Requiere Batches 4a + 4b mergeados a main + T-03 validado + snapshot DB pre-deploy.

**Entregable**: PR #5 — Migration B. Snapshot DB conservado.

### Batch 6 — Tests exhaustivos
**Objetivo**: Cobertura completa de la lógica nueva.
- T-09: Test factories
- T-10: E2E reescritos
- T-11: Unit tests (completar)
- T-12: Snapshot tests

**Entregable**: PR #6 — Todos los tests verdes.

### Batch 7 — Verificación final
**Objetivo**: Smoke manual + typecheck global definitivo.
- T-14: Verificación completa

**Entregable**: Checklist 10/10 + `pnpm tsc --noEmit && pnpm test:unit && pnpm test:e2e && pnpm test:snapshots` = verde.

---

## 4. Tareas críticas (🔒 GATE)

| ID | Título | Por qué es GATE | Criterio de apertura |
|---|---|---|---|
| **T-03** | Backfill script | Si el mapeo `status` → `noteStatus` + Task está mal, se pierden tareas del usuario (IN_PROGRESS pierde foco, DONE pierde completadas). No reversible sin snapshot. | Dry-run muestra counts que cuadran con la distribución real de Notes en staging; spot-check manual de 5 Notes passing |
| **T-04** | Migration B | DROP COLUMN irreversible. Si el código de T-05/T-06 todavía referencia `note.status`/`dueDate`/`isImportant`, la app crashea en producción. | `grep legacy refs = 0` en todo el código; T-05 y T-06 mergeados; snapshot DB disponible; ventana de mantenimiento coordinada |
| **T-05** | API routes core | Si `/api/notes/[id]/process` no es transaccional, o si REGISTROS no está en tx, los datos se corrompen. | Unit tests de process y REGISTROS pasando; grep legacy refs = 0 en API |
| **T-08** | UI Dashboard | ~750 líneas, ~10 refs legacy. Si no se actualizan todas, el Dashboard muestra datos incorrectos o crashea. | `pnpm tsc --noEmit` = 0 errores; `pnpm build` = 0 errores; grep legacy refs = 0 en components |

---

## 5. Tareas de testing

### Tests E2E
- **T-10**: `tests/e2e.spec.ts` reescrito con factorías. Todos los scenarios del design §6.2.
- **Validación**: `pnpm test:e2e` — 100% passing, 0 skipped.

### Tests unitarios
- **T-11**: Unit tests de cada endpoint y función pura.
- **Validación**: `pnpm test:unit` — todos passing.
- **Coverage mínimo**:
  - `process`: ejecutable/no-ejecutable/AI-fail/REGISTROS-transaccional
  - `focus`: toggle/solo-1-foco/focus-on-DONE
  - `complete`: OPEN→DONE/DONE→409
  - `accept-goal`: happy/409-taskExists
  - `backfill`: todos los 6 casos del mapping §1.6
  - `dashboard`: vacío/con-datos/con-focus

### Snapshot tests
- **T-12**: `tests/snapshots/api-dashboard.test.ts`, `tests/snapshots/api-notes-id.test.ts`
- **Validación**: `pnpm test:snapshots` — 100% match.

### Smoke post-migración (T-14)
- Checklist funcional 10/10 en staging con cuenta real del usuario.
- `psql` queries de validación post-backfill (T-03).

---

## 6. Tareas de documentación

### T-13: Documentación actualizada
- **Archivos**: `openwiki/auth-and-data.md`, `openwiki/architecture.md`, `openwiki/quickstart.md`, `README.md`, `docs/sdd/active/refactor-note-task-split/ADR.md`
- **ADR contents** (decisiones cerradas):
  1. Split Note → Note + Task con relación 1:1 opcional
  2. `Task.noteId` UNIQUE con `onDelete: Cascade`
  3. `focusedAt` nullable, partial unique index `Task(userId) WHERE focusedAt IS NOT NULL`
  4. `completedAt` almacenado con CHECK constraint
  5. `status`/`dueDate`/`isImportant` viven en Task
  6. `/api/today` renombrado a `/api/dashboard`
  7. NotePanel: 2 PATCH paralelos (Note + Task) en vez de uno compuesto
  8. `accept-goal`: 409 si Task existe (no upsert)
  9. REGISTROS envuelto en `$transaction`
  10. Big-bang sin feature flag
  11. Embedding se queda en Note
  12. `hasTask` calculado con `task: { select: { id: true } }` en selects pertinentes
- **Validación**: `grep legacy refs = 0` en docs

---

## 7. Riesgos por tarea

### T-03: Backfill — ALTO
- **Riesgo**: El CASE del mapping en SQL pierde datos (e.g., `IN_PROGRESS` → `DRAFT` en vez de `ACTIVE`). El usuario pierde la Task en foco o las completadas.
- **Mitigación concreta**:
  1. Dry-run siempre primero (`--apply` solo tras verificar counts del dry-run)
  2. Spot-check manual de 5 Notes (1 IN_PROGRESS, 1 DONE, 1 ACTIVE con dueDate, 1 ACTIVE sin nada, 1 DRAFT)
  3. Validación post: `COUNT(Task) = projected_count`
  4. Si counts no cuadran → abortar, no aplicar Migration B, investigar
  5. Recovery: `DELETE FROM "Task"` + re-run con `--resume`
- **Riesgo residual**: Si el CASE está mal, la única recuperación es restore del snapshot DB.

### T-04: Migration B — ALTO
- **Riesgo**: DROP COLUMN irreversible. Si el código de T-05/T-06/T-08 tiene una sola ref a columna legacy, producción crashea.
- **Mitigación concreta**:
  1. Grep global obligatorio antes de aplicar: `grep -rE "note\.status\b|note\.dueDate\b|note\.isImportant\b" app/ components/ lib/` = 0
  2. Snapshot DB (Supabase branch) disponible para rollback
  3. Ventana de mantenimiento coordinada
  4. Apply en staging primero y esperar 24h antes de producción
- **Riesgo residual**: Si el código llama a una columna que no existe, es runtime crash inmediato. TS compile-time ayuda pero no cubre queries dinámicos o raw SQL.

### T-05: API routes core — ALTO
- **Riesgo**: `/api/notes/[id]/process` si no es transaccional, o REGISTROS si no está en tx, datos se corrompen. Cualquier query residual sobre `Note.status` rompe.
- **Mitigación concreta**:
  1. Unit tests específicos: process-transaccional, REGISTROS-rollback
  2. Grep post-refactor obligatorio (0 resultados)
  3. `pnpm tsc --noEmit` como puerta del PR
- **Riesgo residual**: Race condition en focus — mitigado por partial unique index (T-04) y manejo de `P2002` → 409.

### T-08: UI Dashboard — ALTO
- **Riesgo**: Dashboard ~750 líneas con ~10 refs legacy. Si se escapa una, el Dashboard muestra `undefined` o crashea silenciosamente.
- **Mitigación concreta**:
  1. Tipos en `lib/types/` para que TS lance error en compile time si se accede a campo inexistente
  2. Grep post-refactor: `grep legacy refs = 0` en components
  3. `pnpm build` como puerta del PR
  4. Snapshot tests del endpoint capturan el shape exacto
  5. E2E tests con factorías cubren el happy path del Dashboard
- **Riesgo residual**: Campo nuevo adicionado en T-04 (e.g., índice) podría no estar en los selects — cubrible con tests.

### T-09: Factories — MEDIO
- **Riesgo**: Un default incorrecto en una factoría rompe todos los tests que la usan simultáneamente.
- **Mitigación concreta**: Smoke test de crear 1 note + 1 task y verificar que se lee de DB correctamente antes de mergear el PR de factories.

---

## 8. Definition of Done del refactor

Checklist binario consolidado (técnico + funcional):

```bash
# === COMPILACIÓN ===
pnpm tsc --noEmit && echo "[OK] TypeScript compila"
pnpm prisma generate && echo "[OK] Prisma client generado"
pnpm build && echo "[OK] Next.js build sin errores"
pnpm prisma format && echo "[OK] Schema formateado"

# === MIGRACIONES ===
psql -c "SELECT COUNT(*) FROM \"Task\";" > 0 && echo "[OK] Task poblada"
psql -c "SELECT COUNT(*) FROM \"Note\" WHERE \"noteStatus\" IS NULL;"  # = 0
psql -c "SELECT column_name FROM information_schema.columns WHERE table_name='Note' AND column_name IN ('status','dueDate','isImportant');"  # = empty
psql -c "SELECT enumlabel FROM pg_enum WHERE enumtypid = 'NoteStatus'::regtype;"  # 3 valores

# === SIN REF LEGACY ===
! grep -rE "note\.status\b|note\.dueDate\b|note\.isImportant\b" app/ components/ lib/ tests/ --include="*.ts" --include="*.tsx" && echo "[OK] Sin refs legacy"
! grep -rE "status:\s*true|dueDate:\s*true|isImportant:\s*true" lib/hubs.ts && echo "[OK] Selects limpios"

# === TESTS ===
pnpm test:unit && echo "[OK] Unit tests"
pnpm test:e2e && echo "[OK] E2E tests"
pnpm test:snapshots && echo "[OK] Snapshots"

# === CONTRATOS API ===
# GET /api/dashboard → 6 secciones con shapes correctos
# POST /api/notes/[id]/process → transaccional (test de rollback manual)
# POST /api/tasks/[id]/focus → solo 1 con focusedAt (test concurrente)
# PATCH /api/notes/[id] → sin dueDate/isImportant en body
# PATCH /api/tasks/[id] → solo dueDate/isImportant en body
# POST /api/notes/[id]/accept-goal → 409 si ya existe Task

# === SMOKE MANUAL (staging) ===
# Capture → Process → Focus → Complete → Calendar → Edit Note → Edit Task → Delete (cascade) → Focus race
```

**DoD funcional (humano)**:
- [ ] Dashboard carga con datos reales de staging
- [ ] Las 6 secciones de `/api/dashboard` muestran datos coherentes
- [ ] Inbox muestra solo Notes `noteStatus='DRAFT'`
- [ ] Process crea Task transaccionalmente (probar rollback simulando fallo de Task.create)
- [ ] Focus toggle respeta "máximo 1 foco" (probar con 2 requests concurrentes)
- [ ] Complete marca Task DONE con `completedAt` set
- [ ] Editar Note y Task por separado persiste correctamente
- [ ] Borrar Note elimina Task en cascada
- [ ] Backfill counts cuadran con la distribución real de Notes
- [ ] Snapshot DB pre-migration conservado durante 7 días post-merge

---

## 9. Tiempo estimado total

| Fase | Tareas | Estimación | Notas |
|---|---|---|---|
| Fundacionales | T-01, T-13 | 2–3h | Schema + docs skeleton |
| Migration A | T-02 | 1–2h | Generar + aplicar en staging |
| Backfill | T-03 | 2–3h | Script + dry-run + validación manual |
| API backend | T-05, T-06, T-07 | 8–12h | 8 endpoints + dashboard + capture |
| UI | T-08 | 6–8h | Dashboard ~750l + NotePanel + Inbox |
| Migration B | T-04 | 1–2h | Aplicar tras verify global |
| Testing | T-09, T-10, T-11, T-12 | 6–10h | Factories + E2E + units + snapshots |
| Docs | T-13 | 1–2h | ADR + actualizar |
| Verificación final | T-14 | 2–3h | Smoke + grep + typecheck |
| **Total** | **14 tareas** | **~30–45h** | **~4–6 días/persona** |

**Estimación por persona**: 4–6 días de trabajo efectivo (con review de PRs, ajustes, y debugging incluido).

---

## Result Contract

- **Fase**: brain-tasks (Fase 4)
- **Status**: `done`
- **Artifact**: `/Users/ezequielmenor/Proyectos/zero-friction/docs/sdd/active/refactor-note-task-split/tasks.md`
- **Insumos consumidos**: `deep-think.md`, `spec.md`, `design.md`, `fixes-applied.md`
- **Próxima fase**: `brain-apply` (Fase 5) — el orchestrator debe pedir aprobación al usuario antes de invocar apply

---

**Riesgos top**:
1. **T-03 (Backfill)**: Pérdida de datos si el CASE mapping está mal → mitigar con dry-run + spot-check + validación post.
2. **T-04 (Migration B)**: DROP COLUMN irreversible → mitigar con grep global + snapshot DB + ventana de mantenimiento.
3. **T-08 (Dashboard UI)**: ~10 refs legacy en ~750 líneas → mitigar con tipos TS + grep + build gate + snapshots.
