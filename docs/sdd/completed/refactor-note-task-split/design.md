# Design: Split Note → Note + Task

**Proyecto**: `zero-friction`
**Sesión**: `refactor-note-task-split-2026-07-08`
**Fase**: brain-design (Fase 3)
**Estado**: `done`

---

## 1. Arquitectura general del cambio

### 1.1 Modelo de datos: antes vs después

```
┌──────────────────────────────────────────────────────────────────┐
│                          ANTES (monolítico)                      │
│                                                                  │
│   Note                                                           │
│   ├── id, userId, title, content, domain                         │
│   ├── tags, suggestedGoals, embedding                           │
│   ├── status: NoteStatus_old (DRAFT|NEEDS_REVIEW|                │
│   │            ACTIVE|IN_PROGRESS|DONE)                          │
│   ├── dueDate: DateTime?        ┐                                │
│   ├── isImportant: Boolean      │ semántica "tarea" mezclada     │
│   └── (Task no existe)          ┘ con semántica "nota"           │
│                                                                  │
│   Fuentes de verdad: Note.status (polimórfico)                   │
│   /api/today → 3 queries sobre Note (status, domain, dueDate)    │
│   Foco = status='IN_PROGRESS'                                    │
└──────────────────────────────────────────────────────────────────┘

                                ↓ split

┌──────────────────────────────────────────────────────────────────┐
│                       DESPUÉS (separado)                         │
│                                                                  │
│   Note                          Task                             │
│   ├── id, userId                 ├── id                          │
│   ├── title, content             ├── noteId (UNIQUE, 1:1)        │
│   ├── domain                     ├── userId (denormalizado)      │
│   ├── tags                       ├── status: OPEN|DONE           │
│   ├── suggestedGoals             ├── dueDate, isImportant        │
│   ├── embedding                  ├── focusedAt (nullable)        │
│   ├── noteStatus:                ├── completedAt                 │
│   │   DRAFT|NEEDS_REVIEW|ACTIVE  └── createdAt, updatedAt        │
│   └── createdAt, updatedAt                                       │
│                                                                  │
│   Relación 1:1 opcional, onDelete: Cascade                      │
│   Note ─< task >── Task                                          │
│                                                                  │
│   Fuentes de verdad:                                             │
│     "es conocimiento" → Note (noteStatus=ACTIVE)                 │
│     "es ejecutable"  → Task (status=OPEN, dueDate, isImportant)  │
│     "está en foco"   → Task.focusedAt != null                    │
│     "está completa"  → Task.status=DONE + completedAt            │
└──────────────────────────────────────────────────────────────────┘
```

### 1.2 Capas de la aplicación

```
┌─────────────────────────────────────────────────────────────────────┐
│                         UI (React 19)                              │
│  app/(app)/page.tsx   app/(app)/calendar/page.tsx                  │
│  components/NotePanel.tsx                                         │
│  components/InboxSection.tsx  components/CaptureOverlay.tsx        │
│                                                                     │
│  Responsabilidad: fetch + render + UX optimista. Sin lógica       │
│  de modelo. Consume shapes desde lib/types/ (no Prisma).          │
└────────────────────────────┬────────────────────────────────────────┘
                             │ fetch (GET/POST/PATCH/DELETE)
                             │ consume: ApiResponse<T> con NoteItem/TaskItem
┌────────────────────────────▼────────────────────────────────────────┐
│                  API Routes (Next.js App Router)                   │
│  app/api/notes/route.ts                                            │
│  app/api/notes/[id]/route.ts                                       │
│  app/api/notes/[id]/process/route.ts                               │
│  app/api/notes/[id]/accept-goal/route.ts                           │
│  app/api/tasks/[id]/route.ts            ← NUEVO                     │
│  app/api/tasks/[id]/focus/route.ts      ← NUEVO                     │
│  app/api/tasks/[id]/unfocus/route.ts    ← NUEVO                     │
│  app/api/tasks/[id]/complete/route.ts   ← NUEVO                     │
│  app/api/today/route.ts  (→ renombrado a /api/dashboard, §3.3)     │
│                                                                     │
│  Responsabilidad:                                                  │
│   • Validar input (Zod)                                            │
│   • Verificar sesión (userId de la cookie)                         │
│   • Orquestar transacciones Prisma                                 │
│   • Mapear errores Prisma → ApiError                               │
│   • Logging estructurado                                           │
└────────────────────────────┬────────────────────────────────────────┘
                             │ Prisma client (tipado)
┌────────────────────────────▼────────────────────────────────────────┐
│                      Services (lib/)                               │
│  lib/parse-capture.ts   ← AI process (reusado por /process)        │
│  lib/hubs.ts            ← NOTE_SELECT + TASK_SELECT                │
│  lib/draft-events.ts    ← SSE bus (sin cambios)                    │
│  lib/prisma.ts          ← cliente Prisma singleton                 │
│                                                                     │
│  Responsabilidad: lógica de modelo. Selects reutilizables,        │
│  funciones puras (mapping status viejo→nuevo en backfill),         │
│  helpers transaccionales.                                          │
└────────────────────────────┬────────────────────────────────────────┘
                             │ @prisma/client
┌────────────────────────────▼────────────────────────────────────────┐
│                  Tipos compartidos (lib/types/)                    │
│  lib/types/note.ts     ← NoteItem, NoteDraft, NoteWithTask         │
│  lib/types/task.ts     ← TaskItem, TaskWithNote, TaskDraft         │
│  lib/types/capture.ts  ← CaptureInput, ParsedCapture               │
│  lib/types/api.ts      ← ApiSuccess, ApiError, ApiResponse        │
│                                                                     │
│  Responsabilidad: UNICA fuente de shapes de UI/API.                │
│  Elimina las 4 `interface Note` ad-hoc (detectado en explore).    │
└────────────────────────────┬────────────────────────────────────────┘
                             │
┌────────────────────────────▼────────────────────────────────────────┐
│                       Prisma Schema (DB)                           │
│  Note { id, userId, title, content, domain, tags,                  │
│         suggestedGoals, embedding, noteStatus, ... }               │
│  Task { id, noteId (UNIQUE), userId, status, dueDate,              │
│         isImportant, focusedAt, completedAt, ... }                 │
│  NoteRelationship { fromId, toId, type, ... }                      │
│                                                                     │
│  Constraints (SQL crudo en migration B):                          │
│   • Task.noteId UNIQUE (1:1)                                       │
│   • Task(userId) WHERE focusedAt IS NOT NULL UNIQUE                │
│   • CHECK (status <> 'DONE' OR completedAt IS NOT NULL)            │
└─────────────────────────────────────────────────────────────────────┘
```

### 1.3 Encaje de la UI tras el split

| Componente | Estado actual | Estado tras split |
|---|---|---|
| **Dashboard** (`app/(app)/page.tsx`) | 1 fetch a `/api/today` con `NOTE_SELECT`. Lee `note.status`/`dueDate`/`isImportant` de Note. | 1 fetch a `/api/dashboard` (ex-`/api/today`). Recibe `DashboardResponse` con 6 secciones (focusTask, todayTasks, maintenanceTasks, habits, dueSubscription, resurgenceNote). Cada `TodayItem` es `{ task, note }`. Renderiza título desde `note.title`, prioridad/fecha desde `task.dueDate`/`isImportant`, foco desde `task.focusedAt`. |
| **CalendarPage** (`app/(app)/calendar/page.tsx`) | Lee Notes con `dueDate` no nulo. | Lee Tasks con `dueDate` no nulo. Cada día lista Tasks (con join a Note para título). |
| **NotePanel** (`components/NotePanel.tsx`) | Edita Note in-place: title/content/tags/domain/dueDate/isImportant. | Edición dividida: campos de Note (title/content/tags/domain) → PATCH `/api/notes/[id]`. Campos de Task (dueDate/isImportant) → PATCH `/api/tasks/[id]`. Ver §3.1. |
| **InboxSection** (`components/InboxSection.tsx`) | Lista Notes con `status='DRAFT'`. | Lista Notes con `noteStatus='DRAFT'`. Sin cambios funcionales (solo el nombre del campo). |
| **CaptureOverlay** (`components/CaptureOverlay.tsx`) | POST `/api/notes` con texto crudo → crea Note DRAFT. | Sin cambios. La IA decide después en `/process` si genera Task. |
| **NotePanel — accept-goal** | Hoy modifica Note.suggestedGoals. | POST `/api/notes/[id]/accept-goal` ahora crea Task (no modifica Note directamente). Ver §3.4 para UX del 409. |
| **NotePanel — process** | POST `/api/notes/[id]/process` (ya implementado, falta tx). | Mismo path, ahora transaccional: enrich Note + crear Task. Ver §2.3 spec. |

---

## 2. Orden de implementación y dependencias

> **Estrategia de deploy**: big-bang (sin feature flag, decisión #11 spec). Una
> sola ventana de mantenimiento con los migrations + script de backfill. Las
> batches describen el **orden de PRs**, no el orden de deploy. Los PRs 1-3
> son commiteables y deployables independientemente; el PR 4 (code switch)
> y el deploy del migration B están acoplados.

### Batch 1 — Schema aditivo + tipos compartidos

**Objetivo**: sentar la base sin romper nada.
**Archivos**:
- `prisma/schema.prisma` → añadir modelo `Task`, columna `noteStatus` en `Note`, relación inversa en `User`. **NO** se eliminan `status`/`dueDate`/`isImportant` aún.
- `lib/types/note.ts`, `task.ts`, `capture.ts`, `api.ts` → nuevos archivos (spec §3).
**Pre-requisitos**: ninguno.
**Validación**:
```bash
pnpm prisma format
pnpm prisma generate
pnpm tsc --noEmit
pnpm test
```
**Riesgo de regresión**: cero. Cambios estrictamente aditivos: nuevo modelo, nueva columna, nuevos tipos. El código existente no los usa todavía, sigue funcionando con los campos viejos.

### Batch 2 — Migration A en staging

**Objetivo**: crear la tabla `Task` y la columna `noteStatus` en producción.
**Archivos**:
- `prisma/migrations/<ts>_split_note_task/migration.sql` (spec §4.1, generado por `prisma migrate dev` desde el schema del Batch 1).
**Pre-requisitos**: Batch 1 mergeado.
**Validación**:
```bash
# Local: regenerar la migration con prisma migrate dev
pnpm prisma migrate dev --name split_note_task
# Verificar que la migration coincide con §4.1 spec
# Staging: aplicar
pnpm prisma migrate deploy
# Verificar que la columna noteStatus existe y Task está vacía
psql -c "SELECT COUNT(*) FROM \"Task\"; SELECT column_name FROM information_schema.columns WHERE table_name='Note' AND column_name='noteStatus';"
```
**Riesgo de regresión**: bajo. La migration es aditiva (nueva tabla, nueva columna con default). El código de la app sigue accediendo a `status`/`dueDate`/`isImportant` que aún existen. App funcional. **Maintenance window recomendada** (~10s) por buena práctica aunque no es estrictamente necesaria.

### Batch 3 — Script de backfill + ejecución en staging

**Objetivo**: poblar `Task` desde Notes existentes.
**Archivos**:
- `prisma/backfill-notes-to-tasks.ts` (spec §4.3).
**Pre-requisitos**: Batch 2 aplicado en staging.
**Validación**:
```bash
# Dry-run (siempre primero)
pnpm tsx prisma/backfill-notes-to-tasks.ts
# Revisar el log: distribución de status, proyección de Tasks
# Apply
pnpm tsx prisma/backfill-notes-to-tasks.ts --apply
# Validación post automática
psql -c "SELECT COUNT(*) FROM \"Task\";"
# Smoke: comparar con la cuenta esperada
# Manual: spot-check 5 Notes migradas (1 IN_PROGRESS, 1 DONE, 1 ACTIVE con dueDate, 1 ACTIVE sin nada, 1 DRAFT)
```
**Riesgo de regresión**: bajo. El script no modifica el schema ni las Notes. Crea Tasks nuevas. Si falla, rollback es `DELETE FROM "Task" WHERE ...` y vuelta a empezar. Idempotente con `skipDuplicates: true` (spec §4.3).

### Batch 4a — Code switch: API routes + lib

> **Este es el PR de backend**. Cambia todas las API routes y la lib compartida.
> Se mergea primero; los componentes de UI (Batch 4b) consumen endpoints ya estables.

**Objetivo**: reescribir todas las API routes + `lib/` para usar el modelo nuevo.
**Archivos** (🔴 críticos):
- `app/api/notes/route.ts` — POST no cambia (sigue creando Note DRAFT), pero el response shape usa `NoteItem` (sin `dueDate`/`isImportant`/`status`).
- `app/api/notes/[id]/route.ts` — PATCH solo acepta `{title, content, tags, domain}`. Elimina `status`/`dueDate`/`isImportant` del body validado.
- `app/api/notes/[id]/process/route.ts` — reestructurar a flujo tripartito (§2.3 spec): pre-tx (LLM), tx (CAS+Task), post-tx (embedding+rels). Branch REGISTROS envuelve `createTransaction/HabitLog/Workout` + `deleteNote` en `$transaction`.
- `app/api/notes/[id]/accept-goal/route.ts` — `$transaction([task.create, note.update])`. Manejo de `P2002` → 409.
- `app/api/today/route.ts` → **renombrado** a `app/api/dashboard/route.ts` (ver §3.3).
- `app/api/capture/route.ts` — **NUEVO en scope**. Crear Note con `noteStatus='DRAFT'`. Si `parsed.isExecutable`, crear Task en la misma tx. Usa `lib/parse-capture.ts` actualizado.
- `app/api/tasks/[id]/route.ts` — **NUEVO** (PATCH, solo `dueDate`/`isImportant`).
- `app/api/tasks/[id]/focus/route.ts` — **NUEVO** (`$transaction([updateMany desenfocar, updateMany enfocar])`).
- `app/api/tasks/[id]/unfocus/route.ts` — **NUEVO**.
- `app/api/tasks/[id]/complete/route.ts` — **NUEVO** (`status: OPEN → DONE + completedAt`).
- `lib/hubs.ts` — dividir `NOTE_SELECT` (sin campos de Task) de `TASK_SELECT`. Actualizar todos los imports.
- `lib/parse-capture.ts` — **NUEVO en scope**. `createNoteWithRelations`: quitar `dueDate`/`isImportant`/`status` de creación de Note. `enrichDraftNote`: raw SQL `WHERE noteStatus='ACTIVE'` (era `status='ACTIVE'`). Mover `dueDate`/`isImportant` a `Task.create`.
- `prisma/seed.ts` — verificar y actualizar si usa campos viejos (`note.status`, `note.dueDate`, `note.isImportant`).

**Archivos** (🟡 medios, se quedan en Batch 4a para tener el `/api/dashboard` estable):
- `app/api/calendar/route.ts` — query sobre Task con `dueDate`.
- `app/api/search/route.ts` — devolver Note con `task: { select: { id, isImportant, dueDate, status } }` anidada para search results. Mapear `hasTask = Boolean(note.task)`.

**Pre-requisitos**: Batches 1, 2, 3 mergeados.
**Validación**:
```bash
pnpm prisma format
pnpm tsc --noEmit                  # CRÍTICO: no debe haber refs a note.status/dueDate/isImportant en API/lib
grep -r "note\.status\|note\.dueDate\|note\.isImportant" app/api/ lib/ --include="*.ts"
# Debe devolver 0 resultados
pnpm test:unit                     # tests de API (Batch 7)
```
**Riesgo de regresión**: medio. Es el backend del refactor. Mitigaciones:
- Todos los endpoints tienen contratos de response documentados en spec §2.
- Unit tests de API (Batch 7) validan happy paths + errores.
- Si algún endpoint falla, el frontend (Batch 4b) lo detecta al consumirlo.

### Batch 4b — Code switch: componentes UI

> **Este es el PR de frontend**. Consume los endpoints ya estables del Batch 4a.
> Cambia solo componentes React, sin tocar API routes ni lib.

**Objetivo**: actualizar componentes UI para consumir shapes nuevos de `/api/dashboard`.
**Archivos** (🟡 medios):
- `components/dashboard/Dashboard.tsx` (o `app/(app)/page.tsx`) — sustituir refs a `note.status`/`dueDate`/`isImportant` por `task.*` (~10 refs 🔴). Consumir `lib/types/`. Adaptar a la respuesta de 6 secciones de `/api/dashboard`.
- `components/NotePanel.tsx` — ver §3.1 (2 PATCH paralelos con optimistic updates).
- `components/InboxSection.tsx` — cambiar `note.status` por `note.noteStatus`.
- `components/CaptureOverlay.tsx` — sin cambios funcionales, pero verificar que sigue apuntando a `/api/notes`.

**Pre-requisitos**: Batch 4a mergeado (necesita los endpoints con shapes nuevos).
**Validación**:
```bash
pnpm tsc --noEmit                  # CRÍTICO: TS debe atrapar cualquier ref rota a note.status/dueDate/isImportant
grep -r "note\.status\|note\.dueDate\|note\.isImportant" components/ --include="*.tsx"
# Debe devolver 0 resultados
pnpm build                         # Next.js build sin errores
pnpm test:e2e                      # Con factorías (Batch 6)
```
**Riesgo de regresión**: medio. Cambia ~10 refs en Dashboard.tsx (~750 líneas). Mitigaciones:
- Tipos en `lib/types/` para que TS atrape refs rotas en compile time.
- E2E tests con factorías (Batch 6) deben estar en verde antes de merge.
- Snapshot test del endpoint `/api/dashboard` (Batch 8) captura el shape exacto.

### Batch 5 — Migration B en producción

**Objetivo**: aplicar el drop de columnas viejas + añadir CHECK constraint + partial unique index.
**Archivos**:
- `prisma/migrations/<ts>_drop_legacy_note_fields/migration.sql` (spec §4.2).
- Editar `prisma/schema.prisma` para que coincida: quitar `status`/`dueDate`/`isImportant` de Note, añadir `@@check` y `@@index` en Task (con comentario apuntando a SQL crudo para el partial unique).

**Pre-requisitos**: Batch 4a y 4b mergeados a main.
**Validación**:
```bash
# En staging, antes de aplicar migration B
psql -c "\d \"Task\""                                # confirmar tabla existe
psql -c "SELECT COUNT(*) FROM \"Task\";"             # confirmar backfill se ejecutó
# Aplicar migration B
pnpm prisma migrate deploy
# Verificar constraints
psql -c "SELECT conname FROM pg_constraint WHERE conrelid='\"Task\"'::regclass;"
psql -c "SELECT indexname FROM pg_indexes WHERE tablename='Task';"
# Probar invariantes
psql -c "INSERT INTO \"Task\" (id, \"noteId\", \"userId\", \"focusedAt\") VALUES ('x', 'y', 'z', now());"  # Debe fallar si ya hay un focused
psql -c "UPDATE \"Task\" SET status='DONE' WHERE \"completedAt\" IS NULL;"  # Debe fallar por CHECK
```
**Riesgo de regresión**: medio. Es un migration destructivo (DROP COLUMN). Irreversible sin snapshot. Mitigación: snapshot de DB pre-migration (Supabase branch/restore, ver §5).

### Batch 6 — Tests E2E con factorías

**Objetivo**: reescribir seeds de E2E usando factorías.
**Archivos**:
- `tests/helpers/factories.ts` — **NUEVO** con signatures:
  ```ts
  export async function createNote(opts: {
    userId: string;
    content: string;
    domain?: Domain;
    noteStatus?: NoteStatus;
    title?: string | null;
    tags?: string[];
  }): Promise<Note>;

  export async function createNoteWithTask(opts: {
    userId: string;
    note?: Partial<NoteInput>;
    task?: Partial<TaskInput>;
  }): Promise<{ note: Note; task: Task }>;

  export async function createFocusedTask(opts: {
    userId: string;
    content: string;
    dueDate?: Date | null;
  }): Promise<{ note: Note; task: Task }>;

  export async function createCompletedTask(opts: {
    userId: string;
    content: string;
  }): Promise<{ note: Note; task: Task }>;
  ```
- `tests/e2e.spec.ts` (líneas 67-313) — reescritura. Cambios:
  - `note.status === 'IN_PROGRESS'` → `task.focusedAt !== null` o `task.status === 'OPEN'`.
  - `note.dueDate` → `task.dueDate`.
  - `note.isImportant` → `task.isImportant`.
  - Tests nuevos: focus toggle, accept-goal 409, process crea Task.

**Pre-requisitos**: Batch 4a (necesita los endpoints nuevos para que los tests sean válidos).
**Validación**:
```bash
pnpm test:e2e
```
**Riesgo de regresión**: medio. Cambia la lógica de seed. Si una factoría tiene mal un default, varios tests fallarán a la vez. Mitigación: factorías puras y testeadas con un smoke (crear 1 note + 1 task + leer de DB).

### Batch 7 — Unit tests nuevos

**Objetivo**: cubrir funciones puras del refactor.
**Archivos** (todos nuevos o ampliados):
- `lib/parse-capture.ts` — tests:
  - process-crea-Task: input ejecutable → `note.updateMany` + `task.create` en tx.
  - process-no-crea-Task: input no ejecutable → solo `note.updateMany`.
  - process-falla-AI → `noteStatus='NEEDS_REVIEW'`, sin Task.
- `app/api/tasks/[id]/focus/route.ts` — tests:
  - focus-toggle: 2 tasks → 1 desenfocada, 1 enfocada.
  - focus-sobre-DONE: 409.
- `app/api/notes/[id]/accept-goal/route.ts` — tests:
  - accept-goal-happy: Note sin Task → Task creada.
  - accept-goal-409: Note con Task → 409.
- `prisma/backfill-notes-to-tasks.ts` — test del mapping (con datos sintéticos):
  - IN_PROGRESS → Task OPEN, focusedAt=updatedAt.
  - DONE → Task DONE, completedAt=updatedAt.
  - ACTIVE con dueDate → Task OPEN.
  - ACTIVE sin nada → no Task.
  - DRAFT/NEEDS_REVIEW → no Task.
**Pre-requisitos**: Batch 4a y 4b.

**Validación**:
```bash
pnpm test:unit
```
**Riesgo de regresión**: bajo. Tests nuevos, no rompen los existentes.

### Batch 8 — Snapshot tests de contratos API

**Objetivo**: capturar shapes de los 2 endpoints más críticos.
**Archivos**:
- `tests/snapshots/api-dashboard.test.ts` — captura del response de `GET /api/dashboard`.
- `tests/snapshots/api-notes-id.test.ts` — captura del response de `GET /api/notes/[id]`.
**Pre-requisitos**: Batch 4a y 4b.

**Validación**:
```bash
pnpm test:snapshots
# Si los shapes cambian intencionalmente: pnpm test:snapshots -u
```
**Riesgo de regresión**: bajo. Solo añade cobertura.

### Batch 9 — Documentación

**Objetivo**: reflejar el nuevo modelo en docs.
**Archivos**:
- `openwiki/auth-and-data.md` (o equivalente) — actualizar §modelo de datos: Note + Task.
- `openwiki/architecture.md` — mencionar el split.
- `openwiki/quickstart.md` — si tiene mención del modelo, actualizar.
- `README.md` — si tiene diagrama de modelo, actualizar.
- `docs/sdd/active/refactor-note-task-split/` — añadir ADR o changelog con las decisiones cerradas.
**Pre-requisitos**: Batch 4a y 4b.

**Validación**:
```bash
grep -r "NoteStatus_old\|note\.status" docs/ openwiki/ README.md 2>/dev/null
# Debe devolver 0 resultados relevantes
```
**Riesgo de regresión**: ninguno (docs).

### Batch 10 — Verificación end-to-end final

**Objetivo**: smoke manual contra staging.
**Checklist** (humano):
- [ ] Login con cuenta de staging.
- [ ] Capture texto → ver Note DRAFT en Inbox.
- [ ] Process → ver Task en Dashboard (si ejecutable).
- [ ] Click en "Focus" → ver Task enfocada (con badge o estilo).
- [ ] Click "Complete" → ver Task pasada a DONE.
- [ ] Calendar → ver Tasks en su `dueDate`.
- [ ] Editar Note desde NotePanel (title, content, tags, domain) → persiste.
- [ ] Editar `dueDate`/`isImportant` desde NotePanel → persiste en Task.
- [ ] Borrar Note → ver Task también borrada (cascade).
- [ ] Forzar dos clicks rápidos en Focus de dos Tasks distintas → solo 1 queda enfocada.

**Validación**:
```bash
pnpm tsc --noEmit && pnpm test:unit && pnpm test:e2e
```

---

## 3. Decisiones de diseño que el spec no cubre

### 3.1 `NotePanel` — ¿cómo edita Task fields?

**Recomendación: Opción B — dos PATCH paralelos desde el cliente.**

**Por qué no A (un solo PATCH a `/api/notes/[id]`)**:
- Acopla el contrato de `/api/notes` con Task. Si en el futuro Task crece (recurrencia, asignaciones), `/api/notes` se convierte en proxy raro.
- El backend tendría que hacer un join implícito (Note + Task) en un endpoint que no tiene por qué saber de Task. El split pierde sentido.

**Por qué no C (`/api/notes/[id]/with-task`)**:
- Endpoint compuesto. Ahora hay 2 lugares donde la UI "edita Task vía Note". Crecen en paralelo.
- Si mañana hay `Note + Bookmark` o `Note + Event`, el patrón se replica.

**Por qué B (dos PATCH paralelos)**:
- Coherente con el split: cada recurso tiene su endpoint, cada endpoint tiene su contrato.
- El frontend ya tiene que manejar optimistic updates (es React). Hacer 2 updates optimistas en paralelo con rollback independiente es trivial.
- Si en el futuro Task se abre a más campos (status manual, prioridad libre), la UI solo cambia en un sitio.
- Trade-off: el usuario ve dos spinners en lugar de uno. Aceptable — son PATCH a la misma red, en la práctica un solo render.

**Implementación**:
```tsx
// NotePanel.tsx (pseudocódigo)
async function onSave(edit: { note: NotePatch; task?: TaskPatch }) {
  const ops: Promise<unknown>[] = [api.patch(`/api/notes/${id}`, edit.note)];
  if (hasTask && edit.task) {
    ops.push(api.patch(`/api/tasks/${taskId}`, edit.task));
  }
  const results = await Promise.allSettled(ops);
  // Optimistic update revert si alguna falla
  if (results.some(r => r.status === 'rejected')) {
    showToast('Algunos cambios no se guardaron');
    refetch();
  }
}
```

### 3.2 Dashboard — ¿cómo obtiene los datos?

**Recomendación: Opción B modificada — endpoint único `/api/dashboard`** (con rename, ver §3.3).

**Por qué no A (2 fetches)**:
- Dos round-trips para una pantalla que el usuario ve al abrir la app. Latencia perceptible.
- Si los datos son inconsistentes entre los 2 fetches (Task creada entre fetch 1 y fetch 2), el dashboard parpadea. Hay que coordinarlos con `Promise.all` y eso es justo el problema que B resuelve.

**Por qué no C (expandir `/api/today` y conservar el path)**:
- El path miente. El endpoint ya no es "today" (que era Tasks de hoy por `dueDate`); es "dashboard data" (today + inbox + focus + resurgence).
- La incongruencia nombre/contenido es deuda técnica gratis. Mejor renombrar ahora (no hay clientes externos, decisión #11 spec) que dentro de 6 meses.

**Por qué B (nuevo `/api/dashboard`)**:
- Path refleja contenido. La UI sabe qué pedir.
- Single source of dashboard. Un solo lugar donde añadir/quitar campos.
- Response cacheable (futuro): clave = `userId + "dashboard"`.
- Un solo round-trip → latencia mínima.

**Shape de la response** (6 secciones, ampliado del spec §2.4):
```ts
type DashboardResponse = {
  ok: true;
  data: {
    focusTask: TodayItem | null;            // 1 Task con focusedAt != null
    todayTasks: TodayItem[];                // Tasks OPEN con dueDate = today, orden: focus first → dueDate asc
    maintenanceTasks: TodayItem[];          // Tasks OPEN sin dueDate (antes: Note.status='ACTIVE' sin tareas)
    habits: HabitItem[];                    // Habit + completedToday (query de Habit/HabitLog, sin cambios)
    dueSubscription: SubscriptionInfo | null;  // Info de suscripción (query de Subscription, sin cambios)
    resurgenceNote: NoteItem | null;        // Note con noteStatus='ACTIVE' y createdAt < now - 180d
  };
};

type TodayItem = { task: TaskItem; note: NoteItem };
```

**Queries Prisma (backend) — 5 queries en paralelo (`Promise.all`)**:

```ts
// 1. focusTask: única Task con focusedAt != null
const focused = await prisma.task.findFirst({
  where: { userId, focusedAt: { not: null } },
  include: { note: true },
});

// 2. todayTasks: Tasks OPEN con dueDate = today
const todayStart = startOfDay(new Date());
const todayEnd = endOfDay(new Date());
const todayTasks = await prisma.task.findMany({
  where: {
    userId,
    status: 'OPEN',
    dueDate: { gte: todayStart, lte: todayEnd },
  },
  include: { note: true },
  orderBy: [{ dueDate: 'asc' }],
});

// 3. maintenanceTasks: Tasks OPEN sin dueDate (antes: Note.status='ACTIVE')
const maintenance = await prisma.task.findMany({
  where: {
    userId,
    status: 'OPEN',
    dueDate: null,
  },
  include: { note: true },
  orderBy: [{ createdAt: 'desc' }],
});

// 4. resurgenceNote: Note ACTIVE con antigüedad > 180 días
const sixMonthsAgo = subMonths(new Date(), 6);
const resurgenceNote = await prisma.note.findFirst({
  where: {
    userId,
    noteStatus: 'ACTIVE',
    createdAt: { lt: sixMonthsAgo },
  },
  // NOTA: sin include de task porque resurgenceNote es puramente de conocimiento (no ejecutable)
  orderBy: { createdAt: 'asc' },
});

// 5. Habits + completedToday (query original de Habit/HabitLog, sin cambios)
// Optimización N+1: una sola query a habitLog en vez de una por habit
const habits = await prisma.habit.findMany({
  where: { userId },
  orderBy: { createdAt: 'asc' },
});
const habitIds = habits.map(h => h.id);
const todayLogs = await prisma.habitLog.findMany({
  where: { habitId: { in: habitIds }, date: { gte: startOfDay(new Date()) } },
});
const completedTodaySet = new Set(todayLogs.map(l => l.habitId));
// Mapear: habits.map(h => ({ ...h, completedToday: completedTodaySet.has(h.id) }))

// 6. Subscription info (query original de Subscription, sin cambios)
```

**Nota sobre la optimización de habits**: en lugar de hacer una query `habitLog.findFirst` por cada Habit (N+1), se hace un solo `habitLog.findMany` con `habitId: { in: habitIds }` y se agrupa en memoria con un `Set`. Esto evita N consultas adicionales para un usuario típico con 3-10 hábitos.

### 3.3 ¿Se renombra `/api/today` o se conserva?

**Recomendación: SÍ, renombrar a `/api/dashboard`.**

**Razones**:
1. No hay clientes externos (decisión #11 spec + quickstart). El coste del rename es interno.
2. El endpoint pasa de "Tasks de hoy" a "datos del dashboard completo" (§3.2). El nombre deja de ser preciso.
3. Refactor en marcha, mejor hacer el rename ahora que en 3 meses cuando el dashboard ya tenga lógica específica.
4. Consistencia con otros endpoints de UI: `/api/calendar` para calendar, `/api/dashboard` para dashboard.

**Migración**:
- Crear `app/api/dashboard/route.ts` con la nueva implementación.
- Borrar `app/api/today/route.ts` después de verificar que el Dashboard lo consume.
- No mantener compat (no hay `app/api/today` viejo). La ventana de "existen ambos" es 0.

**Si en el futuro aparece un cliente externo** que consume `/api/today`: añadir un alias que devuelva `dashboardData.todayTasks` envuelto en el shape viejo. No es problema ahora.

### 3.4 Accept-goal — UX tras 409

**Recomendación: Opción A — toast "Esta nota ya tiene tarea asociada" + link a la Task.**

**Por qué no B (modal "Editar tarea existente")**:
- El usuario no llegó al modal por querer editar la tarea existente. Llegó por aceptar un goal que ya está procesado. Forzar un modal es disruptivo.
- "¿Editar tarea existente?" implica que el modal debe tener los controles de la Task. Más código, más superficie de bugs.

**Por qué no C (refresh silencioso)**:
- El usuario no entiende qué pasó. La Note sigue ahí, "no pasó nada" desde su punto de vista. Mañana vuelve a aceptar y obtiene el mismo "no pasó nada".
- Magic = mala UX. El usuario debe saber que su acción tuvo un efecto (aunque fuera el efecto "ya estaba hecho").

**Por qué A (toast + link)**:
- Mensaje claro: "Esta nota ya tiene tarea asociada".
- Link a la Task: el usuario puede ir a verla/editarla si quiere.
- No disruptivo: el toast se cierra solo, el usuario sigue su flujo.
- Implementación trivial: el 409 puede llevar en `details` el `taskId` existente.

**Implementación**:
```ts
// accept-goal/route.ts
if (e.code === 'P2002') {
  const existing = await prisma.task.findUnique({ where: { noteId }, select: { id: true } });
  return NextResponse.json(
    { ok: false, error: { code: 'taskExists', message: 'Esta nota ya tiene tarea asociada', details: { taskId: existing?.id } } },
    { status: 409 }
  );
}
```

```tsx
// NotePanel.tsx
if (error.code === 'taskExists') {
  showToast({
    message: error.message,
    action: { label: 'Ver tarea', href: `/tasks/${error.details.taskId}` },
  });
}
```

### 3.5 Embedding — ¿afecta al split?

**Decisión**: `embedding: Unsupported("vector(1536)")?` se queda en `Note` (decisión #12 spec).

**Cambio en `NOTE_SELECT`**: **se quita `embedding` de los selects de `/api/dashboard` y `/api/notes` (response shape)**, pero la columna se sigue leyendo si se necesita (e.g., `/api/search` con pgvector).

**Razón**: `/api/dashboard` no necesita embeddings. El coste de transferir 1536 floats por Note (≈6KB) en cada carga del dashboard es significativo y gratuito de eliminar. La columna sigue existiendo para `/api/search` y el grafo Mente.

**Implementación**:
```ts
// lib/hubs.ts
export const NOTE_SELECT_DASHBOARD = {   // para /api/dashboard y /api/notes
  id: true, userId: true, title: true, content: true,
  domain: true, tags: true, noteStatus: true,
  // NO embedding, NO hasTask (se calcula fuera)
  createdAt: true, updatedAt: true,
} satisfies Prisma.NoteSelect;

export const NOTE_SELECT_SEARCH = {      // para /api/search (con embedding)
  ...NOTE_SELECT_DASHBOARD,
  embedding: true,
} satisfies Prisma.NoteSelect;
```

`hasTask` no se incluye en el select (es un `boolean` derivado, no una columna). Se calcula con un LEFT JOIN o un `prisma.note.findUnique({ include: { task: { select: { id: true } } } })` y luego `Boolean(task)`.

---

## 4. Manejo de errores y observabilidad

### 4.1 Logging mínimo

```ts
// lib/logger.ts (ya existe o se crea)
import pino from 'pino';
export const log = pino({ name: 'zero-friction' });
```

**Eventos a loggear**:

| Evento | Nivel | Campos | Por qué |
|---|---|---|---|
| `api.error.5xx` | error | `{ route, method, userId, error, stack }` | Base de debugging. |
| `api.error.409.alreadyProcessed` | warn | `{ userId, noteId }` | Detectar bugs de UI (doble click en process). |
| `api.error.409.taskExists` | warn | `{ userId, noteId }` | Detectar race conditions accept-goal vs process. |
| `api.error.422.aiFailed` | warn | `{ userId, noteId, parsedPartial, llmError }` | Alerta si la IA falla mucho. |
| `api.error.p2002` | error | `{ userId, table, fields, route }` | UNIQUE violation inesperada (no debería pasar fuera de los 409 conocidos). |
| `process.task.created` | info | `{ userId, noteId, taskId, domain, isExecutable }` | Métrica de conversión Note→Task. |
| `process.task.skipped` | info | `{ userId, noteId, domain, reason }` | Métrica opuesta. |
| `focus.changed` | info | `{ userId, fromTaskId, toTaskId }` | Trazabilidad del foco. |
| `task.completed` | info | `{ userId, taskId, ageMs }` | Métrica de throughput. |
| `migration.backfill` | info | `{ count, byStatus }` | Audit del backfill. |

**No loggear**:
- Body crudo (puede tener texto de notas personales).
- Embeddings (volumen + privacidad).
- API keys (jamás, ya garantizado por la capa LLM).

### 4.2 Métricas (si se usan)

Si hay Prometheus / Vercel Analytics / similar configurado:

| Métrica | Tipo | Etiquetas | Uso |
|---|---|---|---|
| `task_created_total` | counter | `domain` | Cuántas Tasks/día. |
| `note_to_task_ratio` | derived | — | Calidad de la IA. |
| `focus_concurrent` | gauge | `userId` | (No aplica en single-user, pero preparado.) |
| `task_completion_time_seconds` | histogram | `domain` | Tiempo medio desde creación hasta DONE. |
| `api_latency_ms` | histogram | `route`, `method` | Performance. |

Si no hay infra de métricas, los contadores se mantienen en logs y se agregan manualmente con `grep | wc -l` o en un dashboard Grafana improvisado. **No se añade infra nueva en este refactor.**

### 4.3 Rate limiting

| Endpoint | Rate limit | Estado |
|---|---|---|
| `POST /api/notes` (Capture) | 30 req/min/user | Ya debe estar. Verificar en `app/api/notes/route.ts`. Si no está, añadir con un middleware simple (cookie + contador en memoria o DB). |
| `POST /api/notes/[id]/process` | 10 req/min/user | Nuevo. Riesgo de abuse (cada process cuesta tokens LLM). |
| `POST /api/tasks/[id]/focus` | 60 req/min/user | Nuevo. UI hace 1 click → 1 request. 60/min es generoso, evita tormenta de clicks. |
| `POST /api/tasks/[id]/complete` | 60 req/min/user | Nuevo. Idem. |
| `PATCH /api/notes/[id]` y `/api/tasks/[id]` | 120 req/min/user | Ya debe estar. Edición intensiva en NotePanel. |

**Implementación sugerida** (single-user, simple):
```ts
// lib/rate-limit.ts (nuevo, minimal)
const buckets = new Map<string, { count: number; resetAt: number }>();
export function rateLimit(key: string, limit: number, windowMs: number) {
  const now = Date.now();
  const b = buckets.get(key);
  if (!b || b.resetAt < now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  if (b.count >= limit) return false;
  b.count++;
  return true;
}
```
No usar Redis (overkill para 1 usuario). El map se resetea con el proceso (suficiente en serverless de Vercel: cada lambda es stateless, el rate limit se aplica por instancia, no global — aceptable para 1 usuario).

---

## 5. Plan de rollback

### 5.1 Pre-deploy

1. **Snapshot de DB** (Supabase branch o `pg_dump`):
   ```bash
   # Crear branch de Supabase pre-migration
   supabase branches create pre-note-task-split-$(date +%Y%m%d)
   # O backup SQL
   pg_dump $DATABASE_URL > pre-split-$(date +%Y%m%d).sql
   ```
2. **Export de Tasks creadas en staging** (después del backfill, antes de producción):
   ```bash
   psql -c "COPY (SELECT * FROM \"Task\") TO '/tmp/tasks-export.csv' CSV HEADER;"
   ```
   Esto es defensivo: si rollback de DB, podemos investigar qué se perdió.

### 5.2 Rollback de DB (si la migration B falla en producción)

```bash
# Opción A: Supabase branch restore
supabase branches restore pre-note-task-split

# Opción B: pg_restore
dropdb $DATABASE_URL
createdb $DATABASE_URL
psql $DATABASE_URL < pre-split-20260708.sql
```

**Datos que se pierden**:
- Las Tasks creadas en producción entre el backfill y el rollback (no deberían ser muchas: deploy es atómico, ventana corta).
- Las Notes nuevas capturadas después del deploy. **Esto es doloroso** si el usuario ha estado usando la app.

**Mitigación**: hacer el deploy en horario de bajo uso. Si el deploy falla, restaurar la DB y comunicarse con el usuario.

### 5.3 Rollback de app (si los nuevos endpoints fallan)

```bash
# Revertir el último commit en main
git revert HEAD
git push
# Vercel redeploy automático
```

**Problema**: si el revert se hace pero la DB ya está en estado nuevo, la app vieja no entenderá el modelo (buscará `note.status` que no existe). **El rollback de app debe ir acompañado de rollback de DB, en ese orden estricto: DB primero, app después.**

### 5.4 ¿Vale la pena exportar antes?

**Sí, pero solo Tasks**:
- Export pre-migration B (después del backfill, antes de producción): `COPY (SELECT * FROM "Task") TO ...`.
- Coste: 1 query, 1 archivo. Insignificante.
- Beneficio: si rollback + re-migration es necesario, podemos comparar qué se creó en producción para entender el bug.

---

## 6. Tests strategy (refinamiento)

### 6.1 Factorías — signatures exactas

```ts
// tests/helpers/factories.ts
import { PrismaClient, Note, Task, Domain, NoteStatus, TaskStatus } from '@prisma/client';
import { createId } from 'cuid';

const prisma = new PrismaClient();
const id = () => createId();

export type NoteInput = {
  content?: string;
  title?: string | null;
  domain?: Domain;
  noteStatus?: NoteStatus;
  tags?: string[];
  suggestedGoals?: string[];
  embedding?: number[];
};

export type TaskInput = {
  status?: TaskStatus;
  dueDate?: Date | null;
  isImportant?: boolean;
  focusedAt?: Date | null;
  completedAt?: Date | null;
};

export async function createNote(userId: string, input: NoteInput = {}): Promise<Note> {
  return prisma.note.create({
    data: {
      id: id(),
      userId,
      content: input.content ?? 'Test content',
      title: input.title ?? '',
      domain: input.domain ?? 'PERSONAL',
      noteStatus: input.noteStatus ?? 'DRAFT',
      tags: input.tags ?? [],
      suggestedGoals: input.suggestedGoals ?? [],
    },
  });
}

export async function createNoteWithTask(
  userId: string,
  noteInput: NoteInput = {},
  taskInput: TaskInput = {},
): Promise<{ note: Note; task: Task }> {
  return prisma.$transaction(async (tx) => {
    const note = await tx.note.create({
      data: {
        id: id(), userId,
        content: noteInput.content ?? 'Test content',
        title: noteInput.title ?? null,
        domain: noteInput.domain ?? 'PROYECTOS',
        noteStatus: noteInput.noteStatus ?? 'ACTIVE',
        tags: noteInput.tags ?? [],
        suggestedGoals: noteInput.suggestedGoals ?? [],
      },
    });
    const task = await tx.task.create({
      data: {
        id: id(),
        noteId: note.id,
        userId,
        status: taskInput.status ?? 'OPEN',
        dueDate: taskInput.dueDate ?? null,
        isImportant: taskInput.isImportant ?? false,
        focusedAt: taskInput.focusedAt ?? null,
        completedAt: taskInput.completedAt ?? null,
      },
    });
    return { note, task };
  });
}

export async function createFocusedTask(userId: string, input: NoteInput = {}): Promise<{ note: Note; task: Task }> {
  return createNoteWithTask(userId, input, { focusedAt: new Date() });
}

export async function createCompletedTask(userId: string, input: NoteInput = {}): Promise<{ note: Note; task: Task }> {
  return createNoteWithTask(userId, input, { status: 'DONE', completedAt: new Date() });
}

export async function cleanupTestData(userId: string): Promise<void> {
  await prisma.task.deleteMany({ where: { userId } });
  await prisma.note.deleteMany({ where: { userId } });
}
```

### 6.2 E2E — scenarios críticos a cubrir

**Existentes (re-escritos)**:
- Capture → Note DRAFT aparece en Inbox.
- Process → Note DRAFT pasa a ACTIVE; Task creada si ejecutable.
- Dashboard muestra focused task.
- Calendar muestra Tasks por `dueDate`.
- Editar Note desde NotePanel persiste.

**Nuevos**:
- **Focus toggle**: 2 Tasks OPEN; enfocar B → A desenfocada, B enfocada.
- **Focus on DONE**: enfocar una Task con `status='DONE'` → 409.
- **Complete Task**: marcar como DONE → status cambia, `completedAt` se setea.
- **Edit Task desde NotePanel**: cambiar `dueDate` → persiste en Task.
- **Accept-goal happy**: Note con `suggestedGoals` → POST accept-goal → Task creada.
- **Accept-goal 409**: Note que ya tiene Task → POST accept-goal → 409 con `taskExists`.
- **Cascade delete**: borrar Note con Task → ambas desaparecen.
- **Concurrency en focus**: dos requests simultáneos `/api/tasks/[idA]/focus` y `/api/tasks/[idB]/focus` → solo 1 queda con `focusedAt != null` (verificado con partial unique index).
- **Inbox solo DRAFT**: Notes ACTIVE no aparecen en Inbox.
- **Dashboard sin foco**: si no hay Task con `focusedAt`, `focusedTask: null` en response.

### 6.3 Unit tests — funciones puras

| Test | Archivo | Qué cubre |
|---|---|---|
| `backfill: IN_PROGRESS → Task OPEN, focusedAt=updatedAt` | `prisma/backfill.test.ts` | Mapping status viejo → Task. |
| `backfill: DONE → Task DONE, completedAt=updatedAt` | idem | Idem. |
| `backfill: ACTIVE con dueDate → Task OPEN` | idem | Idem. |
| `backfill: ACTIVE sin nada → no Task` | idem | Idem. |
| `backfill: DRAFT/NEEDS_REVIEW → no Task` | idem | Idem. |
| `backfill: ACTIVE con isImportant=true → Task OPEN` | idem | Idem. |
| `process: ejecutable → tx (updateMany + create)` | `lib/parse-capture.test.ts` | Tx atómica. |
| `process: no ejecutable → tx solo updateMany` | idem | Idem. |
| `process: AI fail → NEEDS_REVIEW, sin Task` | idem | Idem. |
| `process: REGISTROS → tx (createTransaction + deleteNote)` | idem | Bug latente arreglado. |
| `focus: 2 tasks → solo 1 focusedAt` | `app/api/tasks/[id]/focus/route.test.ts` | Invariante 1-foco. |
| `focus: Task DONE → 409 notOpen` | idem | Guard. |
| `unfocus: id existente con focusedAt → null` | `app/api/tasks/[id]/unfocus/route.test.ts` | Idempotencia. |
| `complete: Task OPEN → DONE, completedAt=now` | `app/api/tasks/[id]/complete/route.test.ts` | Transition. |
| `complete: Task DONE → 409` | idem | Guard. |
| `accept-goal: sin Task → crea` | `app/api/notes/[id]/accept-goal/route.test.ts` | Happy. |
| `accept-goal: con Task → 409 taskExists` | idem | UNIQUE. |
| `dashboard: 0 tasks → focusedTask null, listas vacías` | `app/api/dashboard/route.test.ts` | Edge case. |
| `NOTE_SELECT_DASHBOARD: no incluye embedding` | `lib/hubs.test.ts` | Shape (snapshot ligero). |

### 6.4 Snapshot tests — endpoints

Confirmo la recomendación de deep-think §5: **`/api/today` (ahora `/api/dashboard`)** y **`/api/notes/[id]`**.

**Por qué estos dos**:
- `/api/dashboard` es el más complejo (6 secciones, shapes anidados, ordenamientos). El más propenso a regresiones silenciosas (el dashboard puede mostrar "casi lo mismo" con un campo de menos).
- `/api/notes/[id]` es la fuente de `NotePanel`. Si cambia el shape, el panel queda inconsistente sin error de tsc.
- Otros endpoints (POST /api/notes, PATCH /api/tasks) tienen shapes simples,不值得快照.

**Implementación**:
```ts
// tests/snapshots/api-dashboard.test.ts
test('GET /api/dashboard shape', async () => {
  const user = await createTestUser();
  const { note, task } = await createNoteWithTask(user.id, {}, { focusedAt: new Date() });
  const res = await fetch('/api/dashboard', { headers: { cookie: await authCookie(user) } });
  expect(await res.json()).toMatchSnapshot();
});
```

**Mantenimiento**: si los shapes cambian intencionalmente, `pnpm test:snapshots -u` y revisar el diff en el PR.

---

## 7. Definition of Done (técnica)

Checklist binario (verificación por ejecutor, no por narrador):

```bash
# 1. Tipos
pnpm tsc --noEmit && echo "tsc OK"

# 2. Schema estable
pnpm prisma migrate dev 2>&1 | grep -q "No migration needed" && echo "prisma stable"

# 3. Tests E2E
pnpm test:e2e

# 4. Tests unitarios
pnpm test:unit

# 5. Tests de snapshot
pnpm test:snapshots

# 6. Sin refs rotas a campos viejos
! grep -rE "note\.status\b|note\.dueDate\b|note\.isImportant\b" app/ components/ lib/ --include="*.ts" --include="*.tsx" && echo "no legacy refs"

# 7. Sin selects con campos viejos
! grep -rE "status:\s*true|dueDate:\s*true|isImportant:\s*true" lib/hubs.ts && echo "selects clean"
```

Checklist funcional (humano en staging):
- [ ] Dashboard carga con datos reales de staging (verificado con cuenta de test).
- [ ] `/api/dashboard` responde con `focusTask`, `todayTasks`, `maintenanceTasks`, `habits`, `dueSubscription`, `resurgenceNote` (6 secciones).
- [ ] Inbox muestra solo Notes con `noteStatus='DRAFT'`.
- [ ] CaptureOverlay crea Note DRAFT sin errores.
- [ ] Process crea Task transaccionalmente (verificado con rollback manual).
- [ ] Focus toggle respeta invariante "1 foco".
- [ ] Complete cambia Task a DONE con `completedAt` set.
- [ ] Editar Note desde NotePanel persiste (Note + Task por separado).
- [ ] Borrar Note borra Task en cascada.
- [ ] `prisma db pull` y `pnpm prisma generate` ejecutan limpio.
- [ ] `NOTE_SELECT` y `TASK_SELECT` son los únicos selects en el código (no selects ad-hoc).

---

## 8. Riesgos residuales

| # | Riesgo | Severidad | Mitigación |
|---|---|---|---|
| 1 | **Migration de ENUM pierde datos** si el backfill mapea mal un `status` (ej. `IN_PROGRESS` → `DRAFT` en vez de `ACTIVE`). | P0 | Dry-run del script (Batch 3) en staging + validación de counts (spec §4.3) + snapshot pre-migration. Si los counts no cuadran, abortar antes de migration B. |
| 2 | **`/api/dashboard` 100% reescrito**: cualquier query residual sobre `Note.status` rompe la pantalla principal. | P0 | Refactor atómico (Batch 4a/4b) + grep post-merge (`grep -rE "note\.status\b"`) + E2E con datos reales + smoke manual (Batch 10). |
| 3 | **`Dashboard.tsx` (~750 líneas, ~10 refs 🔴)**: reescritura incompleta deja referencias mixtas. | P1 | Tipos extraídos en `lib/types/` para que tsc atrape inconsistencias. E2E exhaustivo (Batch 6) cubre happy path. Snapshot tests del endpoint (Batch 8) cubren shape. |
| 4 | **Race condition en focus** con dos clicks simultáneos en Tasks distintas: el partial unique index protege, pero el error de DB puede propagarse como 500 si no se maneja. | P1 | Manejar `P2002` específico en `/api/tasks/[id]/focus` → 409 `focusRace`. El tx actual (desenfocar + enfocar) puede fallar al enfocar si otra tx ya puso `focusedAt` ahí. Mitigación: capturar `P2002` en el paso (2) y devolver 409 con mensaje claro. |
| 5 | **REGISTROS no transaccional** (bug latente actual) sigue sin arreglarse si se olvida en el Batch 4a. | P1 | El test unitario `process: REGISTROS → tx (createTransaction + deleteNote)` (Batch 7) es la red de seguridad. Si falla, el PR no se mergea. |

**Riesgos NO residuales** (descartados por diseño):
- Pérdida de `embedding`: no, se queda en Note.
- Soft-delete ausente: documentado como out-of-scope, no es riesgo del refactor.
- API pública rota: no hay clientes externos.

---

## Result Contract

- **Fase**: brain-design (Fase 3)
- **Status**: `done`
- **Artefacto**: `docs/sdd/active/refactor-note-task-split/design.md`
- **Insumos consumidos**:
  - `docs/sdd/active/refactor-note-task-split/deep-think.md` (Fase 0).
  - `docs/sdd/active/refactor-note-task-split/spec.md` (Fase 2).
  - 14 decisiones locked (mapeo spec §1.6, §2, §4).
  - OpenWiki quickstart (entendimiento del stack).
- **Insumos producidos**:
  1. Arquitectura de capas (UI → API → services → types → schema) con diagrama ASCII.
  2. 10 batches de implementación con dependencias, validaciones y riesgos.
  3. 5 decisiones de diseño resueltas con recomendación razonada:
     - §3.1: 2 PATCH paralelos desde NotePanel (frontend optimista).
      - §3.2: endpoint único `/api/dashboard` con 6 secciones.
     - §3.3: rename `/api/today` → `/api/dashboard` (sin clientes externos).
     - §3.4: toast + link a Task en 409 de accept-goal.
     - §3.5: `embedding` fuera de `NOTE_SELECT_DASHBOARD` (shape separado).
  4. Plan de observabilidad (10 eventos a loggear, métricas opcionales, rate limits).
  5. Plan de rollback (DB snapshot, app revert, export defensivo).
  6. Tests strategy refinada: factorías con signatures, 18 unit tests, 10 E2E scenarios, 2 snapshot tests confirmados.
  7. DoD binaria (7 checks automatizados + 12 funcionales).
  8. 5 riesgos residuales priorizados con mitigación concreta.
- **Próxima fase**: `brain-tasks` (atomización en tareas individuales con dependencias).
- **Riesgos top para el orchestrator**:
  1. **P0** — Migration de ENUM Postgres puede perder datos si el backfill mapea mal `status` viejo → Task. Mitigación: dry-run + validación de counts antes de migration B + snapshot pre-deploy.
  2. **P0** — `/api/dashboard` 100% reescrito (antes `/api/today`). Cualquier query residual sobre `Note.status`/`dueDate`/`isImportant` rompe la pantalla principal. Mitigación: refactor atómico en Batch 4a/4b + grep `note\.status\b` retorna 0 + E2E exhaustivo.
  3. **P1** — `Dashboard.tsx` ~750 líneas con ~10 refs 🔴 a campos viejos. Riesgo de regression visual alto. Mitigación: tipos en `lib/types/` para que tsc atrape inconsistencias + snapshot tests del endpoint + smoke manual con datos de staging.
  4. **P1** — `REGISTROS` no transaccional (bug latente) debe arreglarse en este refactor. Mitigación: unit test específico (Batch 7) es la red de seguridad; si falla, el PR no se mergea.
