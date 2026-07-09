# Spec: Refactor Note → Note + Task

**Proyecto**: `zero-friction`
**Sesión**: `refactor-note-task-split-2026-07-08`
**Fase**: brain-spec (Fase 2)
**Estado**: `done`

---

## 1. Schema Prisma final

### 1.1 Enums

```prisma
enum NoteStatus {
  DRAFT
  NEEDS_REVIEW
  ACTIVE
}

enum TaskStatus {
  OPEN
  DONE
}

// Otros enums SIN CAMBIOS (deben quedar): Domain, RecordType, RelationshipType, etc.
```

> **Migración de enum**: Postgres no permite renombrar valores de ENUM in-place
> ni reducir el set. Estrategia documentada en §4 (dos migrations + rename).

### 1.2 Modelo `User` (confirmación, sin cambios)

```prisma
model User {
  id             String   @id @default(cuid())
  email          String   @unique
  // ... resto de campos sin cambios
  notes          Note[]
  tasks          Task[]              // NUEVO relación inversa
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt
}
```

### 1.3 Modelo `Note` (modificado)

```prisma
model Note {
  id                String   @id @default(cuid())
  userId            String
  title             String                                 // NOT NULL (el fallback «Sin título» se hace en frontend, no en DB)
  content           String
  domain            Domain
  embedding         Unsupported("vector(1536)")?    // se queda (decisión #12)
  tags              String[]
  suggestedGoals    String[]                        // usado por accept-goal
  noteStatus        NoteStatus  @default(DRAFT)     // NUEVO (reemplaza `status`)
  createdAt         DateTime   @default(now())
  updatedAt         DateTime   @updatedAt

  user              User              @relation(fields: [userId], references: [id], onDelete: Cascade)
  task              Task?                              // NUEVO: relación 1:1 opcional
  relationshipsFrom NoteRelationship[] @relation("SourceNote")
  relationshipsTo   NoteRelationship[] @relation("TargetNote")

  @@index([userId, noteStatus])        // para hubs/search filtrando por status
  @@index([userId, domain])
  // @@index eliminado sobre status antiguo
  // Eliminado: enum `status` viejo (5 valores), `dueDate DateTime?`, `isImportant Boolean`
  // Conservado: embedding columna (decisión #12)
}
```

**Campos eliminados de `Note`**:
- `status: NoteStatus_old` (reemplazado por `noteStatus: NoteStatus` de 3 valores)
- `dueDate: DateTime?` → vive en `Task`
- `isImportant: Boolean` → vive en `Task`

**Campos conservados en `Note`**: `title`, `content`, `domain`, `embedding`,
`tags`, `suggestedGoals`, `userId`, `createdAt`, `updatedAt`, `noteStatus` (renombrado).

**Invariante**: `noteStatus='DRAFT'` → único estado desde el que se puede
procesar. `NEEDS_REVIEW` indica AI falló definitivamente (retry manual desde UI).

### 1.4 Modelo `Task` (NUEVO)

```prisma
model Task {
  id          String     @id @default(cuid())
  noteId      String     @unique                      // 1:1 con Note, decisión #2
  userId      String                                    // denormalizado (decisión #2)
  status      TaskStatus @default(OPEN)               // OPEN | DONE (decisión #5)
  dueDate     DateTime?                                // migrado desde Note
  isImportant Boolean    @default(false)               // migrado desde Note
  focusedAt   DateTime?                                // NULL = no en foco (decisión #3)
  completedAt DateTime?                                // NOT NULL si status='DONE' (CHECK en §4)
  createdAt   DateTime   @default(now())
  updatedAt   DateTime   @updatedAt

  note        Note       @relation(fields: [noteId], references: [id], onDelete: Cascade)
  user        User       @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId, status])                // P0: /api/dashboard (OPEN tasks)
  @@index([userId, dueDate])               // P0: /api/calendar (tasks por día)
  // Partial unique (userId) WHERE focusedAt IS NOT NULL → vía SQL crudo (§4)
  // CHECK (status <> 'DONE' OR completedAt IS NOT NULL) → vía SQL crudo (§4)
}
```

**Validaciones cross-field** (deben cumplirse siempre, garantizadas por la app +
constraints en DB):
- `status='DONE'` ⇒ `completedAt IS NOT NULL` (CHECK en DB).
- `Task` siempre tiene `noteId` UNIQUE (1:1 con Note). `accept-goal` lo respeta.
- Máximo 1 `Task` con `focusedAt != null` por `userId` (partial unique index).
- Borrar `Note` borra `Task` en cascada (`onDelete: Cascade`).

### 1.5 Modelo `NoteRelationship` (sin cambios — modelo real del schema)

```prisma
model NoteRelationship {
  id              String   @id @default(cuid())
  sourceNoteId    String
  targetNoteId    String
  similarity      Float?
  isManual        Boolean  @default(false)
  createdAt       DateTime @default(now())

  sourceNote      Note     @relation("SourceNote", fields: [sourceNoteId], references: [id], onDelete: Cascade)
  targetNote      Note     @relation("TargetNote", fields: [targetNoteId], references: [id], onDelete: Cascade)

  @@unique([sourceNoteId, targetNoteId])
  @@index([sourceNoteId])
  @@index([targetNoteId])
}
```

> En el modelo `Note`, las relaciones inversas se llaman:
> ```prisma
> relationshipsFrom NoteRelationship[] @relation("SourceNote")
> relationshipsTo   NoteRelationship[] @relation("TargetNote")
> ```
> Ya están presentes en el schema real y no se modifican en este refactor.

### 1.6 Mapping del backfill (`status` viejo → `noteStatus` + Task)

| `status` actual (5 valores) | `noteStatus` nuevo | ¿Crea Task? | Campos Task |
|---|---|---|---|
| `DRAFT` | `DRAFT` | No | — |
| `NEEDS_REVIEW` | `NEEDS_REVIEW` | No | — |
| `ACTIVE` sin `dueDate`/`isImportant` | `ACTIVE` | **No** (decisión #7 revisada: solo si tiene datos de tarea) | — |
| `ACTIVE` con `dueDate != null` ó `isImportant == true` | `ACTIVE` | **Sí** | `status=OPEN`, `dueDate`/`isImportant` copiados, `focusedAt=null` |
| `IN_PROGRESS` | `ACTIVE` | **Sí** | `status=OPEN`, `focusedAt = updatedAt`, `dueDate`/`isImportant` copiados |
| `DONE` | `ACTIVE` | **Sí** | `status=DONE`, `completedAt = updatedAt`, `dueDate`/`isImportant` copiados |

Reglas comunes para Tasks creadas en backfill:
- `userId` = `Note.userId` (denormalizado, decisión #2).
- `createdAt` / `updatedAt` se copian de la Note.
- `id` se genera con `cuid()` en TS (no en SQL).

---

## 2. Contratos API

> **Convención común**: todas las responses exitosas usan
> `ApiSuccess<T> = { ok: true; data: T }` y los errores
> `ApiError = { ok: false; error: { code: string; message: string; details?: unknown } }`
> definidos en `lib/types/api.ts` (§3).

### 2.1 `POST /api/notes` (modificado)

**Modos** (decisión #1: `CaptureOverlay` siempre crea `Note` DRAFT):

```ts
// Modo A — captura cruda (texto libre desde CaptureOverlay)
type CreateNoteTextInput = {
  mode: 'text';
  content: string;            // requerido, validado no-vacío
  // userId se toma de la sesión
};

// Modo B — estructurado manual (edición desde NotePanel)
type CreateNoteStructuredInput = {
  mode: 'structured';
  title?: string;
  content: string;            // requerido
  domain: Domain;             // requerido (enum del schema)
  tags?: string[];
};
```

**Comportamiento**:
- Validación con Zod: `content` no vacío, `domain` ∈ enum, `mode` ∈ ambos.
- Si el usuario está autenticado → `userId` de la sesión.
- Crea `Note` con `noteStatus='DRAFT'` en ambos modos (siempre DRAFT).
- No crea `Task` (la IA decidirá en `/process` si la Note es ejecutable).

**Responses**:
- `201` → `{ ok: true, data: NoteItem }` (Note SIN campos de Task).
- `400` → validación fallida.
- `401` → no autenticado.

```ts
type NoteItem = {
  id: string;
  userId: string;
  title: string;              // NOT NULL, fallback UI: note.title || 'Sin título'
  content: string;
  domain: Domain;
  tags: string[];
  noteStatus: NoteStatus;     // 'DRAFT' | 'NEEDS_REVIEW' | 'ACTIVE'
  hasTask: boolean;           // auxiliar, derivado: existe Task con noteId=id
  createdAt: string;          // ISO
  updatedAt: string;          // ISO
  // NO incluye: dueDate, isImportant, status (viejo), completedAt, focusedAt
};
```

> **Select para `hasTask`**: en endpoints que devuelven `NoteItem[]` (e.g., `/api/hubs/[domain]`,
> `/api/notes` lista), se usa `NOTE_SELECT_WITH_TASK_FLAG`:
> ```ts
> const NOTE_SELECT_WITH_TASK_FLAG = {
>   id: true, userId: true, title: true, content: true, domain: true,
>   tags: true, suggestedGoals: true, noteStatus: true,
>   createdAt: true, updatedAt: true,
>   task: { select: { id: true } },  // solo el id, no el payload completo
> };
> // hasTask = Boolean(note.task) en el mapper
> ```
> Para endpoints que no necesitan `hasTask` (e.g., `InboxSection` solo muestra DRAFTs),
> se usa `NOTE_SELECT` sin el `task` include.

### 2.2 `PATCH /api/notes/[id]` (modificado)

**Body**:
```ts
type UpdateNoteInput = {
  title?: string;
  content?: string;
  tags?: string[];
  domain?: Domain;
  // NO: dueDate, isImportant, status, noteStatus (todo eso vive en Task ahora)
};
```

**Comportamiento**:
- Valida propiedad de la Note (`userId` coincide con sesión).
- Update parcial con `prisma.note.update`.
- Si el usuario quiere editar fechas/prioridad → llamar `PATCH /api/tasks/[id]` con `{ dueDate, isImportant }`.

**Flujo UI en NotePanel** (decisión documentada):
- Si solo edita título/content/tags/domain → 1 PATCH a `/api/notes/[id]`.
- Si también edita `dueDate`/`isImportant` → 2 PATCH paralelos (uno a Note,
  otro a `/api/tasks/[id]`). Frontend hace optimistic updates por separado;
  si uno falla, revertir solo ese.
- Alternativa: el backend acepta en `/api/notes/[id]` un campo opcional
  `taskPatch?: { dueDate?, isImportant? }` y delega internamente. **Decisión
  recomendada: mantener 2 endpoints separados** (coherente con el split,
  evita acoplar Note con Task en el contrato).

**Responses**:
- `200` → `{ ok: true, data: NoteItem }`.
- `400` → body inválido.
- `404` → Note no existe.
- `403` → no es del usuario.

### 2.3 `POST /api/notes/[id]/process` (modificado, transaccional)

**Body**:
```ts
type ProcessNoteInput = {
  noteId: string;       // viene del path param, pero el body lo admite para trazabilidad
};
```

**Flujo tripartito** (la función `enrichDraftNote` hace LLM calls — embedding + similarity —
que no pueden vivir dentro de una transacción de DB. Se reestructura en 3 fases):

1. **Pre-tx** (fuera de transacción): LLM call para embedding + relationships.
   Esta fase es idempotente y reintentable si falla.

2. **Tx atómica** (`prisma.$transaction([...])`):
   ```ts
   // CAS guard
   prisma.note.updateMany({
     where: { id: noteId, userId, noteStatus: 'DRAFT' },
     data:  { noteStatus: 'ACTIVE', title: parsed.title, tags: parsed.tags /* ... parsed fields */ }
   })
   ```
   Si `count === 0` → alguien ya la procesó → abortar tx → `409 alreadyProcessed`.

   **Si `parsed.isExecutable === true`** (dentro de la misma tx):
   ```ts
   prisma.task.create({
     data: {
       noteId, userId,
       status: 'OPEN',
       dueDate: parsed.dueDate ?? null,
       isImportant: parsed.isImportant ?? false,
       focusedAt: null,
     }
   })
   ```
   Si la Task ya existe (UNIQUE en `noteId`): Prisma `P2002` → tx rollback → `409 taskExists`.
   *Razón*: `accept-goal` puede haber corrido antes; 409 en lugar de upsert preserva 1:1.

   **Branch REGISTROS** (con `recordType` reconocido, decisión #1.5 de deep-think):
   ```ts
   prisma.$transaction([
     prisma.transaction.create({ data: ... }),     // o habitLog.create / workout.create
     prisma.note.deleteMany({ where: { id: noteId, noteStatus: 'DRAFT' } })
   ])
   // NO crea Task en REGISTROS (la Note se borra tras crear la entidad estructurada)
   ```
   **P0**: este path arregla un bug latente (hoy NO es transaccional).

3. **Post-tx** (fuera de transacción): escribir embedding (raw SQL con
   `WHERE noteStatus='ACTIVE'`) + crear NoteRelationships (similarity edges).
   Si esta fase falla, la Note ya está ACTIVE con Task creada; se hace retry
   idempotente o el grafo Mente se recupera en la siguiente sincronización.

**Branch AI falla**: si la IA lanza excepción definitiva en fase 1 → fuera de tx,
update separado a `noteStatus='NEEDS_REVIEW'`. **NO** crea Task. `422 aiFailed`.

**Output (success)**:
```ts
type ProcessNoteOutput = {
  note: NoteItem;
  task?: TaskItem;        // presente solo si isExecutable && branch !REGISTROS
  deleted?: boolean;      // presente solo si branch REGISTROS
};
```

**Errores**:
- `409 alreadyProcessed` — Note ya está en `NEEDS_REVIEW` o `ACTIVE`.
- `409 taskExists` — Task ya asociada a esta Note (probablemente por `accept-goal`).
- `422 aiFailed` — IA falló definitivamente, Note marcada `NEEDS_REVIEW`.
- `404` — Note no existe.
- `403` — no es del usuario.

> **⚠️ BREAKING CHANGE (accept-goal, requiere migración de UI)**:
> Comportamiento actual: `POST /api/notes/[id]/accept-goal` crea una **Note nueva separada**
> (duplica contenido). Nuevo comportamiento: crea una `Task` 1:1 vinculada a la Note original
> y remueve el goal aceptado de `suggestedGoals[]`. La Note origen no cambia de `noteStatus`.
> 
> **Impacto en frontend**: tests E2E que asumen "nueva nota creada tras accept-goal" deben
> reescribirse. La UI debe navegar a la Note origen (no a una nueva) tras aceptar un goal.
> El cambio es necesario para mantener la invariante 1:1 Note↔Task (si accept-goal creara
> una nueva Note, habría dos Notes compitiendo por ser la "fuente" del goal).

### 2.4 `GET /api/dashboard` (renombrado desde `/api/today`)

> **Updated per design §3.3**: renombrar a `/api/dashboard`. El antiguo path `/api/today` se elimina
> sin mantener compatibilidad (no hay clientes externos). El método es **GET**
> (corregido del enunciado que decía POST; el endpoint existente es GET según deep-think §1).

**Query params**:
```ts
type DashboardQuery = {
  // vacío por defecto → todas las secciones
  includeDone?: boolean;   // default false
};
```

**Comportamiento** (decisión #8, ampliado):
- Antes: 6 secciones distribuidas en el cliente con queries a `/api/today`, `/api/habits`, `/api/subscription`, etc.
- Después: **un solo endpoint** `/api/dashboard` agrupa las 6 secciones en una response. Las queries de `Habit`/`HabitLog` y `Subscription` se mantienen desde sus modelos originales (no se tocan en este refactor).

**Nota para implementación**: el backend ejecuta 4-5 queries Prisma en paralelo (no una sola query gigante):
1. Task enfocada (`focusedAt != null`) → `focusTask`
2. Tasks OPEN del día (`dueDate = today`) → `todayTasks`
3. Tasks OPEN sin `dueDate` (mantenimiento) → `maintenanceTasks`
4. Notes ACTIVE con `createdAt < now - 180d` (resurgimiento) → `resurgenceNote`
5. Habits + `completedToday` (query original) → `habits`
6. Subscription info (query original) → `dueSubscription`

Los detalles de implementación (queries Prisma, optimizaciones N+1) se documentan en design §3.2.

**Response**:
```ts
type DashboardResponse = {
  ok: true;
  data: {
    focusTask: TodayItem | null;            // 1 Task con focusedAt != null, si existe
    todayTasks: TodayItem[];                // Tasks OPEN con dueDate = today, orden: focus primero → dueDate asc
    maintenanceTasks: TodayItem[];          // Tasks OPEN sin dueDate (antes: Note.status='ACTIVE')
    habits: HabitItem[];                    // array de Habit con completedToday (query de Habit, sin cambios)
    dueSubscription: SubscriptionInfo | null;  // info de suscripción (query de Subscription, sin cambios)
    resurgenceNote: NoteItem | null;        // Note con noteStatus='ACTIVE' y createdAt < now - 180d
  };
};

type TodayItem = {
  task: TaskItem;
  note: NoteItem;         // Note SIN campos de Task (title, content, domain, tags)
};

// HabitItem y SubscriptionInfo se definen en sus respectivos módulos (sin cambios).
// NOTA: si no existen tipos exportados para estas entidades, se crearán en lib/types/.
```

**NOTA sobre `hasTask`**: en las secciones del dashboard donde se devuelve `TodayItem`, `hasTask`
siempre es `true` (por definición, un `TodayItem` tiene Task). En `resurgenceNote`, `hasTask`
se calcula con `Boolean(note.task)` usando el select:
```ts
const NOTE_SELECT_WITH_TASK_FLAG = {
  id: true, userId: true, title: true, content: true, domain: true,
  tags: true, suggestedGoals: true, noteStatus: true,
  createdAt: true, updatedAt: true,
  task: { select: { id: true } },  // solo para hasTask
};
// En el mapper: hasTask = Boolean(note.task)
```

### 2.5 `POST /api/tasks/[id]/focus` (NUEVO)

**Body**: vacío (path param `id`).
```ts
type FocusTaskInput = { /* none */ };
```

**Flujo atómico** (`prisma.$transaction([...])`, decisión #3, §1.3 deep-think):
1. **Desenfocar todas**:
   ```ts
   prisma.task.updateMany({
     where: { userId, focusedAt: { not: null } },
     data:  { focusedAt: null }
   })
   ```
2. **Enfocar la nueva** (CAS):
   ```ts
   prisma.task.updateMany({
     where: { id, userId, status: 'OPEN' },
     data:  { focusedAt: new Date() }
   })
   ```
   Si `count === 0` → la Task no existe, no es del usuario, o ya está DONE → `404`/`409`.

**Responses**:
- `200` → `{ ok: true, data: TaskItem }` (con `focusedAt` actualizado).
- `404` → Task no existe o no es del usuario.
- `409 notOpen` → Task ya está `DONE`.

### 2.6 Endpoints auxiliares de Task (NUEVOS)

```ts
// POST /api/tasks/[id]/unfocus
type UnfocusTaskInput = { /* none */ };
// Flujo: prisma.task.updateMany({ where: { id, userId, focusedAt: { not: null } }, data: { focusedAt: null } })
// Errores: 404 (no existe), 409 (ya null o no es del user)
type UnfocusTaskOutput = { ok: true; data: TaskItem };

// POST /api/tasks/[id]/complete
type CompleteTaskInput = { /* none */ };
// Flujo: prisma.task.updateMany({
//   where: { id, userId, status: 'OPEN' },
//   data:  { status: 'DONE', completedAt: new Date() }
// })
// Si count === 0 → 409 alreadyDone / 404
type CompleteTaskOutput = { ok: true; data: TaskItem };

// PATCH /api/tasks/[id]
type UpdateTaskInput = {
  dueDate?: string | null;      // ISO o null para limpiar
  isImportant?: boolean;
  // NO: status (cambia solo vía /complete), focusedAt (solo /focus), noteId (inmutable)
};
// Flujo: prisma.task.updateMany({ where: { id, userId }, data: { ... } })
// Errores: 400 (status/focusedAt en body), 404, 403
type UpdateTaskOutput = { ok: true; data: TaskItem };
```

### 2.7 `TaskItem` (shape compartido de Task en todas las responses)

```ts
type TaskItem = {
  id: string;
  noteId: string;
  userId: string;
  status: TaskStatus;            // 'OPEN' | 'DONE'
  dueDate: string | null;        // ISO
  isImportant: boolean;
  focusedAt: string | null;      // ISO
  completedAt: string | null;    // ISO — NOT NULL cuando status='DONE'
  createdAt: string;
  updatedAt: string;
};
```

---

## 3. Tipos compartidos — `lib/types/`

> **Consolida las 4 interfaces `Note` duplicadas en componentes** (detectado en
> explore). Tras el split, el `lib/types/` es la **única fuente** de shapes.

### 3.1 `lib/types/note.ts`

```ts
export type { Note, NoteStatus } from '@prisma/client';   // re-export Prisma

export interface NoteItem {
  id: string;
  userId: string;
  title: string;               // NOT NULL, fallback UI: note.title || 'Sin título'
  content: string;
  domain: string;              // Domain enum como string union
  tags: string[];
  noteStatus: 'DRAFT' | 'NEEDS_REVIEW' | 'ACTIVE';
  hasTask: boolean;            // derivado vía include/check
  createdAt: string;
  updatedAt: string;
}

export interface NoteDraft {
  mode: 'text' | 'structured';
  content: string;
  title?: string;
  domain?: string;
  tags?: string[];
}

export interface NoteWithTask extends NoteItem {
  task: TaskItem | null;       // null si la Note no se tradujo en Task
}
```

### 3.2 `lib/types/task.ts`

```ts
export type { Task, TaskStatus } from '@prisma/client';

export interface TaskItem {
  id: string;
  noteId: string;
  userId: string;
  status: 'OPEN' | 'DONE';
  dueDate: string | null;
  isImportant: boolean;
  focusedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TaskWithNote extends TaskItem {
  note: NoteItem;              // siempre presente (FK NOT NULL)
}

export interface TaskDraft {
  noteId: string;              // FK a Note existente
  dueDate?: string | null;
  isImportant?: boolean;
  // status, focusedAt, completedAt se asignan server-side
}
```

### 3.3 `lib/types/capture.ts`

```ts
export interface CaptureInput {
  text?: string;               // modo raw
  content?: string;            // alias para compatibilidad
  // el resto de campos estructurados se completan vía IA en /process
}

export interface ParsedCapture {
  title?: string;
  domain: string;              // Domain enum
  tags: string[];
  isExecutable: boolean;       // ¿genera Task?
  dueDate?: string | null;
  isImportant?: boolean;
  // branch REGISTROS:
  recordType?: string;         // RecordType enum si aplica
}
```

### 3.4 `lib/types/api.ts`

```ts
export interface ApiSuccess<T> {
  ok: true;
  data: T;
}

export interface ApiError {
  ok: false;
  error: {
    code: string;              // 'alreadyProcessed' | 'taskExists' | 'aiFailed' | 'notOpen' | ...
    message: string;
    details?: unknown;
  };
}

export type ApiResponse<T> = ApiSuccess<T> | ApiError;
```

---

## 4. Plan de migración

> **Estrategia**: dos migrations Prisma + un script TS de backfill. **Big-bang
> sin feature flag** (decisión #11), ventana de mantenimiento ~30s.

### 4.1 Migration A — `prisma/migrations/<ts>_split_note_task/migration.sql`

> Pre-requisito: schema sin columna `noteStatus` aún. Las columnas viejas
> (`status`, `dueDate`, `isImportant`) siguen existiendo en `Note`.

```sql
-- 1. Crear el nuevo enum
CREATE TYPE "TaskStatus" AS ENUM ('OPEN', 'DONE');

-- 2. Tabla Task (todavía sin filas)
CREATE TABLE "Task" (
  "id"         TEXT NOT NULL,
  "noteId"     TEXT NOT NULL,
  "userId"     TEXT NOT NULL,
  "status"     "TaskStatus" NOT NULL DEFAULT 'OPEN',
  "dueDate"    TIMESTAMP(3),
  "isImportant" BOOLEAN NOT NULL DEFAULT false,
  "focusedAt"  TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"  TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Task_pkey" PRIMARY KEY ("id")
);

-- 3. FK + UNIQUE constraint 1:1
ALTER TABLE "Task"
  ADD CONSTRAINT "Task_noteId_fkey" FOREIGN KEY ("noteId") REFERENCES "Note"("id") ON DELETE CASCADE;
CREATE UNIQUE INDEX "Task_noteId_key" ON "Task"("noteId");
ALTER TABLE "Task"
  ADD CONSTRAINT "Task_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE;

-- 4. Crear nuevo enum NoteStatus
CREATE TYPE "NoteStatusNew" AS ENUM ('DRAFT', 'NEEDS_REVIEW', 'ACTIVE');

-- 5. Añadir columna noteStatus con default temporal 'ACTIVE' (para no-violar NOT NULL)
ALTER TABLE "Note"
  ADD COLUMN "noteStatus" "NoteStatusNew" NOT NULL DEFAULT 'ACTIVE';

-- 6. NO dropear columnas viejas todavía. NO crear índices todavía.
--    El CHECK y el partial unique se añaden en Migration B.
```

> **Tras aplicar Migration A en staging**: se ejecuta el backfill script (§4.3).
> Validación de counts antes de seguir.

### 4.2 Migration B — `prisma/migrations/<ts>_drop_legacy_note_fields/migration.sql`

> Pre-requisito: backfill script ejecutado y validado (counts cuadran).

```sql
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

-- 5. Drop default temporal y poner default 'DRAFT'
ALTER TABLE "Note" ALTER COLUMN "noteStatus" DROP DEFAULT;
ALTER TABLE "Note" ALTER COLUMN "noteStatus" SET DEFAULT 'DRAFT';

-- 6. Rename del enum NoteStatusNew → NoteStatus
ALTER TYPE "NoteStatusNew" RENAME TO "NoteStatus";

-- 7. Índice Note(userId, noteStatus) para hubs/search
CREATE INDEX "Note_userId_noteStatus_idx" ON "Note"("userId", "noteStatus");
-- (si ya existía uno similar con `status`, dropearlo en el mismo paso)
```

### 4.3 Backfill script — `prisma/backfill-notes-to-tasks.ts`

> Ejecutable con `pnpm tsx prisma/backfill-notes-to-tasks.ts`. Dry-run por
> defecto; `--apply` para ejecutar de verdad.

**Flujo**:

```ts
// ESQUEMA — no es implementación, es el contrato del script.
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  const apply = process.argv.includes('--apply');

  // (A) Dry-run — cuenta proyección
  const candidates = await prisma.$queryRaw<{ status: string; n: bigint }[]>`
    SELECT status::text AS status, COUNT(*)::bigint AS n
    FROM "Note"
    GROUP BY status
  `;
  const projected = candidates.reduce((acc, r) => {
    acc[r.status] = Number(r.n);
    return acc;
  }, {} as Record<string, number>);
  const projectedTasks =
    (projected['IN_PROGRESS'] ?? 0) +
    (projected['DONE'] ?? 0) +
    (projected['ACTIVE_qualified'] ?? 0);  // solo ACTIVE con dueDate|isImportant (ver abajo)
  console.log('[dry-run] status distribution:', projected);
  console.log('[dry-run] projected tasks (upper bound):', projectedTasks);

  // Calcular ACTIVE_qualified: ACTIVE con dueDate o isImportant (los que generan Task)
  const activeQualified = await prisma.note.count({
    where: {
      status: 'ACTIVE',
      OR: [{ dueDate: { not: null } }, { isImportant: true }],
    },
  });
  projected['ACTIVE_qualified'] = activeQualified;
  console.log('[dry-run] ACTIVE qualified para Tasks:', activeQualified);

  if (!apply && !process.argv.includes('--resume')) return;

  // (B) Validación pre
  const resume = process.argv.includes('--resume');
  const existingTasks = await prisma.task.count();
  if (existingTasks !== 0 && !resume) {
    throw new Error(
      `Task ya tiene ${existingTasks} filas — abortar.\n` +
      `Para recuperación: ejecuta con --resume (salta Notes con Task existente).\n` +
      `Para empezar de cero: DELETE FROM "Task" + re-run sin --resume.`
    );
  }
  if (existingTasks !== 0 && resume) {
    console.log(`[resume] ${existingTasks} Tasks existentes — se saltarán las Notes que ya tienen Task`);
  }
  const noteStatusNullCount = await prisma.note.count({ where: { noteStatus: null } });
  if (noteStatusNullCount !== 0) throw new Error(`${noteStatusNullCount} Notes sin noteStatus`);

  // (B.5) Mapear noteStatus para TODAS las Notes (antes de crear Tasks)
  console.log('[apply] mapeando noteStatus: status viejo → noteStatus nuevo...');
  await prisma.$executeRawUnsafe(`
    UPDATE "Note" SET "noteStatus" =
      CASE "status"::text
        WHEN 'DRAFT' THEN 'DRAFT'::"NoteStatusNew"
        WHEN 'NEEDS_REVIEW' THEN 'NEEDS_REVIEW'::"NoteStatusNew"
        ELSE 'ACTIVE'::"NoteStatusNew"
      END
  `);
  const noteStatusDist = await prisma.$queryRaw<{ noteStatus: string; n: bigint }[]>`
    SELECT "noteStatus"::text AS "noteStatus", COUNT(*)::bigint AS n
    FROM "Note" GROUP BY "noteStatus"
  `;
  console.log('[apply] noteStatus post-mapping:', noteStatusDist);

  // (C) Construir mapping §1.6 y crear Tasks
  const notesToTaskify = await prisma.$queryRaw<RawRow[]>`
    SELECT id AS "noteId", "userId", status::text AS status, "dueDate",
           "isImportant", "updatedAt", "createdAt"
    FROM "Note"
    WHERE (status = 'IN_PROGRESS'
        OR status = 'DONE'
        OR (status = 'ACTIVE' AND ("dueDate" IS NOT NULL OR "isImportant" = true)))
      ${resume ? prisma.$raw`AND id NOT IN (SELECT "noteId" FROM "Task")` : prisma.$raw``}
  `;

  const data = notesToTaskify.map(n => ({
    noteId: n.noteId,
    userId: n.userId,
    status: n.status === 'DONE' ? 'DONE' : 'OPEN',
    dueDate: n.dueDate,
    isImportant: n.isImportant,
    focusedAt: n.status === 'IN_PROGRESS' ? n.updatedAt : null,
    completedAt: n.status === 'DONE' ? n.updatedAt : null,
    createdAt: n.createdAt,
    updatedAt: n.updatedAt,
  }));

  // createMany en batch con skipDuplicates (defensa extra)
  const result = await prisma.task.createMany({ data, skipDuplicates: true });
  console.log(`[apply] creadas ${result.count} Tasks`);

  // (D) Validación post
  const taskCount = await prisma.task.count();
  const orphanTasks = await prisma.task.count({
    where: { note: null },
  });
  const noteCount = await prisma.note.count();
  if (orphanTasks !== 0) throw new Error(`${orphanTasks} Tasks huérfanas`);
  if (taskCount + (noteCount - (projected['IN_PROGRESS'] ?? 0) -
                    (projected['DONE'] ?? 0) -
                    (projected['ACTIVE_qualified'] ?? 0)) !== noteCount) {
    console.warn('[validate-post] revisar conteos manualmente');
  }
  console.log('[ok] backfill validado');
}

main().catch(e => { console.error(e); process.exit(1); });
```

**Comandos**:
```bash
pnpm tsx prisma/backfill-notes-to-tasks.ts                   # dry-run (default)
pnpm tsx prisma/backfill-notes-to-tasks.ts --apply           # ejecutar completo
pnpm tsx prisma/backfill-notes-to-tasks.ts --apply --resume  # recuperación: saltar Notes con Task existente
```

**Recuperación tras fallo sin `--resume`**:
```bash
# Si el script falló a mitad y no usaste --resume:
psql -c 'DELETE FROM "Task";'                                # limpiar Tasks parciales
pnpm tsx prisma/backfill-notes-to-tasks.ts --apply           # re-ejecutar desde cero
# O mejor (para producción):
pnpm tsx prisma/backfill-notes-to-tasks.ts --apply --resume  # saltar lo ya creado
```

---

## 5. Cambios por archivo (blast radius)

> 22 archivos 🔴 + 6 🟡 del explore. Para cada uno: ruta, cambio esperado y
> dependencia de otras tareas. Design refinará los detalles.

### 🔴 Críticos (rompen sin el cambio)

| Archivo | Cambio | Depende de |
|---|---|---|
| `prisma/schema.prisma` | Definir modelos `Task`/Note modificado/enums según §1 | nada |
| `prisma/migrations/<ts>_split_note_task/migration.sql` | Crear nueva migration A (§4.1) | schema.prisma |
| `prisma/migrations/<ts>_drop_legacy_note_fields/migration.sql` | Crear migration B (§4.2) | backfill ejecutado |
| `prisma/backfill-notes-to-tasks.ts` | Script TS con dry-run + apply + resume + validación (§4.3) | migration A aplicada |
| `app/api/notes/route.ts` | `POST` sigue creando `Note` con `noteStatus='DRAFT'`; eliminar campos viejos de response | §1, §2.1, §3.1 |
| `app/api/notes/[id]/route.ts` | `PATCH` solo acepta `title/content/tags/domain`; sin `status/dueDate/isImportant` | §1, §2.2 |
| `app/api/notes/[id]/process/route.ts` | Reestructurar a flujo tripartito (§2.3): pre-tx (LLM), tx (CAS+Task), post-tx (embedding+rels) | §1, §2.3 |
| `app/api/today/route.ts` | Eliminar (renombrado → `app/api/dashboard/route.ts`) | §1, §2.4, §3.2 |
| `app/api/dashboard/route.ts` | **NUEVO**. 6 secciones (focusTask, todayTasks, maintenanceTasks, habits, dueSubscription, resurgenceNote). 5 queries Prisma en `Promise.all`. | §1, §2.4, design §3.2 |
| `app/api/capture/route.ts` | **NUEVO en blast radius 🔴**. Crear Note con `noteStatus='DRAFT'`. Si `parsed.isExecutable`, crear Task en la misma tx. Usar `lib/parse-capture.ts` actualizado. | §1, §2.1, lib/parse-capture.ts |
| `lib/parse-capture.ts` | **NUEVO en blast radius 🔴**. `createNoteWithRelations`: quitar `dueDate`/`isImportant`/`status` de creation de Note. `enrichDraftNote`: raw SQL `WHERE noteStatus='ACTIVE'`. Mover `dueDate`/`isImportant` a `Task.create`. | §1 |
| `app/api/notes/[id]/accept-goal/route.ts` | Crear `Task` (no modificar `Note` directamente); `$transaction([task.create, note.update])`; manejar `P2002` → 409 | §1, §2.6 |
| `app/api/tasks/[id]/focus/route.ts` | **NUEVO**. `$transaction([updateMany desenfocar, updateMany enfocar])` | §1, §2.5 |
| `app/api/tasks/[id]/unfocus/route.ts` | **NUEVO**. `updateMany({ id, userId, focusedAt: { not: null } }, { focusedAt: null })` | §1 |
| `app/api/tasks/[id]/complete/route.ts` | **NUEVO**. `updateMany` con `status: 'OPEN'` → `'DONE'` + `completedAt = now()` | §1, §1.6 |
| `app/api/tasks/[id]/route.ts` | **NUEVO** (`PATCH`). Acepta `{ dueDate, isImportant }` solamente | §1, §2.6 |
| `lib/types/note.ts` | Definir `NoteItem`, `NoteDraft`, `NoteWithTask` (§3.1) | §1 |
| `lib/types/task.ts` | Definir `TaskItem`, `TaskWithNote`, `TaskDraft` (§3.2) | §1 |
| `lib/types/capture.ts` | Definir `CaptureInput`, `ParsedCapture` (§3.3) | §1 |
| `lib/types/api.ts` | Definir `ApiSuccess<T>`, `ApiError`, `ApiResponse<T>` (§3.4) | §1 |
| `tests/helpers/factories.ts` | **NUEVO**: `createNote`, `createNoteWithTask`, `createFocusedTask` (deep-think §5) | §1 |
| `tests/e2e.spec.ts` (líneas 67–313) | Reescribir seeds con factorías; actualizar asserts de `note.status===IN_PROGRESS` a `task.focusedAt!=null` | §1, factories.ts |

### 🟡 Medios (ajustar imports / selects)

| Archivo | Cambio | Depende de |
|---|---|---|
| `lib/hubs.ts` | Dividir `NOTE_SELECT` (sin `status`/`dueDate`/`isImportant`) de `TASK_SELECT`; todos los imports se actualizan | §1 |
| `components/dashboard/Dashboard.tsx` | Sustituir refs a `note.status`/`dueDate`/`isImportant` por `task.*` (~10 refs según deep-think P1); consumir `lib/types/` | §1, §3, `/api/dashboard` |
| `components/notepanel/NotePanel.tsx` | Edición: 2 PATCH (Note + Task) si edita fechas/prioridad; usar `lib/types/` | §2.2, §2.6 |
| `components/capture/CaptureOverlay.tsx` | Solo dispara `POST /api/notes` (modo text); sin cambios funcionales | §2.1 |
| `app/api/search/route.ts` | **Decisión**: devolver Note con `task: { select: { id, isImportant, dueDate, status } }` anidada para badge de search results. Mapear a `NoteItem` con `hasTask = Boolean(note.task)`. | §1, §3.2 |
| `app/api/calendar/route.ts` | Queries de Tasks por fecha (`dueDate`) en vez de Notes | §1, §2.7 |

### ⚪ Verificar / posiblemente sin cambios

- `prisma/seed.ts` — solo si el seed usa los campos viejos; si sí, actualizar.
- Documentación: `README.md`, `openwiki/` — actualizar §1 (modelo) tras el merge.

---

## 6. Definition of Done

- [ ] `prisma/schema.prisma` actualizado según §1; `pnpm prisma format` limpio.
- [ ] `pnpm prisma migrate dev` corre local sin error; las 2 migrations (§4.1, §4.2) generadas y commiteadas.
- [ ] `prisma/backfill-notes-to-tasks.ts --apply` ejecutado en staging; validación post-backfill verde.
- [ ] Aplicada migration B en staging; CHECK constraint `Task_completedAt_required_if_done` activo.
- [ ] Partial unique index `Task_one_focus_per_user` activo (probado intentando crear 2 Tasks con `focusedAt` → debería fallar).
- [ ] `tests/e2e.spec.ts` verde con las nuevas factorías (`tests/helpers/factories.ts`).
- [ ] Unit tests nuevos pasan: process-crea-Task, process-no-Task, focus-toggle, accept-goal-409, focus-sobre-DONE-409.
- [ ] `GET /api/dashboard` devuelve `DashboardResponse` con 6 secciones (focusTask, todayTasks, maintenanceTasks, habits, dueSubscription, resurgenceNote); verificado manualmente con usuario de staging.
- [ ] `POST /api/notes/[id]/process` transaccional: simular fallo de Task.create → Note sigue en `DRAFT` (rollback correcto).
- [ ] `POST /api/tasks/[id]/focus` validado con prueba concurrente (2 clicks → solo 1 queda con `focusedAt`).
- [ ] `lib/types/{note,task,capture,api}.ts` exportados y consumidos por ≥90% de componentes (no quedan `interface Note` ad-hoc).
- [ ] Dashboard visiblemente idéntico al usuario final (mismas interacciones, mismos datos en `today`, `inbox`, `calendar`).
- [ ] Backfill mapping §1.6 verificado manualmente con un subset de las Notes reales (DRAFT/ACTIVE/IN_PROGRESS/DONE).
- [ ] Documentación: `README.md` actualizado con nuevo modelo (Note ↔ Task). ADR/CHANGELOG con la decisión.
- [ ] Snapshot de DB previo a migración conservado (Supabase branch/restore) durante al menos 7 días post-merge.

---

## 7. Out of scope

- **Soft-delete / papelera** — no se añade `deletedAt` ni filtros de tombstone. El cascade hard de `Note → Task` es la política actual (deep-think §1.1).
- **UI de "promover Note a Task manualmente"** — queda como feature P2 (deep-think §1.4 / §7.1). Si el AI falla clasificación, el usuario corrige el contenido y re-dispara `/process` (o se hace desde UI en una iteración posterior).
- **Snapshot tests de contratos API** — P1, otra PR (deep-think §5).
- **Recurrencia de tareas** — `Task` no tiene `recurrence` ni tabla auxiliar.
- **Notificaciones push** — sin cambios en `Task`/`Note` para esto.
- **API pública / clientes externos** — no hay; si aparecen, capa de compat con shape viejo via JOIN (deep-think §3) en PR aparte.
- **Cambios de UX visibles** — el Dashboard debe verse igual; el refactor es interno.
- **Migración de datos de embeddings** — `embedding` se queda como columna en `Note` (decisión #12), no se mueve a tabla satélite.
- **Refactor de `lib/hubs.ts` más allá de dividir selects** — no se rediseña la API de hubs, solo se ajusta a los nuevos shapes.
- **Internacionalización de mensajes de error** — los `message` de `ApiError` siguen en español/inglés mezclados como están hoy.

---

## Result Contract

- **Fase**: brain-spec (Fase 2)
- **Status**: `done`
- **Artefacto**: `docs/sdd/active/refactor-note-task-split/spec.md`
- **Insumos consumidos**: `docs/sdd/active/refactor-note-task-split/deep-think.md` + 14 decisiones cerradas + memoria ai-brain (registro "Phase 1").
- **Insumos producidos para la siguiente fase**:
  1. Schema Prisma final con firma exacta de `Task` + `Note` modificado + enums (§1).
  2. Contratos API de los 5 endpoints afectados + 4 nuevos (§2).
  3. Tipos compartidos en `lib/types/` consolidados (§3).
  4. Plan de migración en 3 pasos (migration A, backfill TS, migration B) (§4).
  5. Inventario exhaustivo archivo-por-archivo con dependencias (§5).
  6. Definition of Done verificable (§6).
  7. Out of scope explícito para evitar scope creep (§7).
- **Próxima fase**: `brain-design` (diseñar arquitectura, partitioning por capas, estrategia de testing detallada por archivo).
- **Riesgos top para el orchestrator**:
  1. **P0** — Migración de ENUM Postgres (`NoteStatus` 5→3 valores) puede perder datos si el backfill mapea mal `IN_PROGRESS/DONE` → mitigación con dry-run + validación de counts antes de aplicar migration B.
  2. **P0** — `Dashboard.tsx` (~750 líneas, ~10 refs 🔴 a `note.status/dueDate/isImportant`); riesgo de regression visual/funcional alto → mitigación con tipos extraídos en `lib/types/` + tests E2E actualizados con factorías.
  3. **P1** — `lib/hubs.ts` comparte `NOTE_SELECT` que aún incluye los campos eliminados; todos los imports rompen → dividir en `NOTE_SELECT` + `TASK_SELECT` en la misma PR.
  4. **P1** — `accept-goal` puede chocar con `/process` creando Task para la misma Note; UNIQUE `Task.noteId` lanza `P2002` → manejar 409 explícito, **no** upsert (decisión cerrada).
