# Spec: Project Engine (Phase 3)

**Proyecto**: `zero-friction`
**Sesión**: `projects-engine-2026-07-09`
**Fase**: brain-spec (Fase 2)
**Estado**: `done`

> **Path canónico del dashboard**: `/api/dashboard` (renombrado en Phase 2 §3.3
> desde el antiguo `/api/today`). Si el usuario vuelve a mencionar `/api/today`,
> apuntar a `/api/dashboard`. Cualquier referencia en este doc usa `/api/dashboard`.

---

## 1. Schema Prisma final

### 1.1 Enum `ProjectStatus`

```prisma
enum ProjectStatus {
  IDEATION
  ACTIVE
  MAINTENANCE
  ARCHIVED
}
```

| Valor | Momento del ciclo | Operativa |
|---|---|---|
| `IDEATION` | Antes de escribir código | Contenedor de Notes de investigación. Puede no tener Tasks aún. |
| `ACTIVE` | Construyendo/shipping activamente | Sprint personal en marcha. Tasks con `dueDate`, foco diario. |
| `MAINTENANCE` | Shipped, low-touch | Tasks esporádicas (bugs, soporte). Sin foco prioritario. |
| `ARCHIVED` | Descartado/abandonado/completado | Inactivo. Sus Notes vuelven al Second Brain si se borra el Project. |

**DAG de transiciones válidas** (validado en app layer, NO en DB):

```
IDEATION     → ACTIVE | ARCHIVED
ACTIVE       → MAINTENANCE | ARCHIVED | IDEATION       (pivot duro)
MAINTENANCE  → ACTIVE | ARCHIVED
ARCHIVED     → ACTIVE | IDEATION                       (REVIVIR — explícitamente permitido)
```

**Transiciones inválidas** (la app debe bloquear con 409):
- `IDEATION → MAINTENANCE` (no saltarse ACTIVE).
- `MAINTENANCE → IDEATION` (si quieres re-idear, pasa por ARCHIVED+revive).

Constante de transición propuesta (referencia, vive en código en `lib/projects.ts`):
```ts
export const PROJECT_TRANSITIONS: Record<ProjectStatus, ProjectStatus[]> = {
  IDEATION:    ['ACTIVE', 'ARCHIVED'],
  ACTIVE:      ['MAINTENANCE', 'ARCHIVED', 'IDEATION'],
  MAINTENANCE: ['ACTIVE', 'ARCHIVED'],
  ARCHIVED:    ['ACTIVE', 'IDEATION'],
};
```

**POR QUÉ permitir revivir (`ARCHIVED → ACTIVE | IDEATION`)**:
crítico para micro-SaaS personal. Descartar y retomar es un patrón natural
(3 meses después vuelves con nuevo ángulo). Sin revive, perderías el historial
del contenedor. **Esto es coherente con la filosofía Second Brain** (D6: no soft-delete).

### 1.2 Modelo `Project` (NUEVO)

```prisma
model Project {
  id          String        @id @default(cuid())
  userId      String
  user        User          @relation(fields: [userId], references: [id], onDelete: Cascade)
  name        String
  description String?
  status      ProjectStatus @default(IDEATION)
  createdAt   DateTime      @default(now())
  updatedAt   DateTime      @updatedAt

  notes Note[]

  @@index([userId, status])    // listar proyectos por estado
  @@index([userId, updatedAt]) // "proyectos recientes" / staleness
}
```

**Justificación campo a campo**:

| Campo | Justificación |
|---|---|
| `id` cuid | Consistente con el resto del schema. |
| `userId` | D5: TODOS los modelos del repo llevan `userId`. Consistencia sin excepciones. Single-user lo hace decorativo hoy, multi-tenant mañana. |
| `name` | NOT NULL. Nombre humano del proyecto. Sin unique: puede haber "Experimento" archivado varias veces. |
| `description?` | Opcional. Texto libre corto para UI (contexto del proyecto). |
| `status` default `IDEATION` | Estado inicial del proyecto recién creado. Coincide con el flujo de uso (piensas → construyes). |
| `createdAt`/`updatedAt` | Auditoría. `updatedAt` indexado vía `@@index([userId, updatedAt])` para "proyectos recientes". |
| `notes Note[]` | Relación inversa. **TASK NO se relaciona con Project** — Task deriva vía Note (D4, decisión cerrada por el usuario). |

**Índices justificados**:
- `@@index([userId, status])` — query típica: "dame proyectos ACTIVE del usuario".
- `@@index([userId, updatedAt])` — query típica: "proyectos recientes" (ordenamiento por `updatedAt desc`).

### 1.3 Modificaciones al modelo `Note`

Añadir (sin tocar nada más):

```prisma
projectId String?
project   Project? @relation(fields: [projectId], references: [id], onDelete: SetNull)

@@index([projectId, noteStatus])  // NUEVO
```

**`onDelete: SetNull`** — ver §2 (argumento completo del cascade).

**`@@index([projectId, noteStatus])`** — para queries tipo "notes ACTIVE del
proyecto X" (futuro: vista por proyecto).

**NO tocar `Task`**: D4 (decisión cerrada por el usuario) dice que Task NO
lleva `projectId` denormalizado. La Task deriva su project vía `Task → Note → Project`
en JOIN al renderizar. Esto elimina el riesgo P1 de desincronización detectado
en el deep-think.

### 1.4 Modificaciones al modelo `User` (relación inversa)

Añadir `projects Project[]` al modelo `User`:

```prisma
model User {
  // ... campos existentes sin cambios ...
  notes         Note[]
  tasks         Task[]
  projects      Project[]        // NUEVO relación inversa
  relationships NoteRelationship[]
  workouts      Workout[]
  transactions  Transaction[]
  subscriptions Subscription[]
  habits        Habit[]
  coachAdvice   CoachAdvice?
  llmConfig     LLMConfig?
  accounts      Account[]
}
```

---

## 2. Argumento de la regla de cascade (REQ 3 del usuario)

### Decisión

> **`Note.projectId → onDelete: SetNull`** (las Notes sobreviven huérfanas con `projectId = null`).

### Por qué

El producto tiene una **asimetría fundamental** entre dos entidades:

- **Note = Second Brain**. Es la fuente de verdad del conocimiento del usuario.
  Una Note de "investigación del micro-SaaS X" sigue siendo conocimiento válido
  aunque X se descarte. El embedding pgvector, los NoteRelationship y el
  contenido textual siguen siendo útiles (resurgen en búsquedas futuras).
- **Task = táctica de un momento**. Su pérdida es tolerable. Representa
  "qué hay que hacer hoy/esta semana" — no conocimiento acumulado.

Una Note no es "una fila de un proyecto" — es "un nodo del grafo mental con un
tag opcional de contenedor". Por eso el cascade NO puede borrar Note cuando se
borra Project: destruiría la base de conocimiento del usuario.

### Por qué NO las alternativas

**No cascade total** (`Note.projectId → Cascade`): destruye el Second Brain.
Si Ezequiel borra un proyecto descartado, pierde toda la investigación que
generó. Inaceptable — viola la premisa del producto.

**No soft-delete** (Project con `deletedAt` + cascade Task): añade `deletedAt`,
filtros `WHERE deletedAt IS NULL` en cada query, y un estado "archivo-borrado"
que se solapa confusamente con `status = ARCHIVED`. Para single-user es
sobre-ingeniería. ARCHIVED ya cubre "no lo toco pero existe"; hard-delete con
SetNull cubre "lo elimino del todo pero salvo el conocimiento". Dos mecanismos
de "no activo" es ruido (D6).

**No SetNull en ambos** (Note + Task): las Tasks de un proyecto muerto caerían
al inbox general de `todayTasks`/`maintenanceTasks` y generarían ruido
("¿por qué tengo una task 'deploy micro-SaaS X' si maté ese proyecto?"). Las
Tasks de un proyecto muerto no son útiles sin su contenedor — la pérdida es
deseable (limpieza de deuda táctica).

### Edge cases

- **NoteRelationship** entre Notes huérfanas: **se mantiene**. Los links son
  sobre el contenido semántico, no sobre el proyecto. Si la Note A (de un
  proyecto borrado) linkea a la Note B (de otro proyecto), ese link sigue
  siendo válido.
- **Embedding pgvector**: la Note huérfana **conserva su embedding**. Es del
  contenido, no del proyecto. La Note sigue siendo buscable semánticamente.
  Esto es deseable: si la investigación era buena, resurge en `/api/search`.
- **Task apuntando a Note huérfana**: la Task **sigue viva apuntando a su Note**
  (que ahora tiene `projectId = null`). La cadena Task → Note → Project (JOIN)
  devuelve `project: null` en la response del dashboard. Es coherente: la Task
  ya no tiene proyecto, pero sigue existiendo con su Note. El usuario decide
  si la completa, la borra, o la reasigna.

---

## 3. Impacto en queries (REQ 4 del usuario)

### 3.1 `/api/dashboard` — sección Task (`focusTask`, `todayTasks`, `maintenanceTasks`)

**Estado actual** (`app/api/dashboard/route.ts:36-76`):

```ts
select: {
  id: true, noteId: true, userId: true, status: true,
  dueDate: true, isImportant: true, focusedAt: true,
  completedAt: true, createdAt: true, updatedAt: true,
  note: { select: NOTE_SELECT_NEW },
}
```

**Modificación propuesta**:

```ts
note: {
  select: {
    ...NOTE_SELECT_NEW,
    project: { select: { id: true, name: true, status: true } },
  },
},
```

Implementación limpia — añadir un nuevo selector en `lib/hubs.ts`:

```ts
// lib/hubs.ts (NUEVO)
export const NOTE_SELECT_NEW_WITH_PROJECT = {
  ...NOTE_SELECT_NEW,
  project: { select: { id: true, name: true, status: true } },
} as const;
```

Y en `app/api/dashboard/route.ts`, las 3 queries Task pasan a usar
`note: { select: NOTE_SELECT_NEW_WITH_PROJECT }`. El `formatNoteBrief` se
extiende para añadir `project: {id, name, status} | null`:

```ts
const formatNoteBrief = (n: Record<string, unknown>) => {
  // ...campos actuales de Note...
  const project = n.project as { id: string; name: string; status: string } | null;
  return {
    // ...campos actuales...
    project: project ? { id: project.id, name: project.name, status: project.status } : null,
  };
};
```

**`resurgenceNote` no se toca** (D3). **Habits y Subscription no se tocan**.

### 3.2 Otros endpoints — decisiones caso por caso

| Endpoint | Selector actual | ¿Añadir project? | Razón |
|---|---|---|---|
| `GET /api/dashboard` | `NOTE_SELECT_NEW` (via task.note) | **SÍ** (vía `NOTE_SELECT_NEW_WITH_PROJECT`) | Badge informativo de proyecto en Task del foco/día. |
| `GET /api/hubs/[domain]` | `NOTE_SELECT_WITH_TASK_FLAG` | **SÍ** (extender el selector) | Badge de proyecto en lista de notes del hub. |
| `GET /api/notes` | `NOTE_SELECT_WITH_TASK_FLAG` | **SÍ** (extender el selector) | Consistencia con hubs. |
| `GET /api/search` | Inline select | **SÍ** (recomendado) | Badge de proyecto en search results ayuda a filtrar visualmente. |
| `GET /api/graph` | `{ id, title, domain }` (mínimo) | **NO** | El grafo es del Second Brain (Note↔Note), no del contenedor. Añadir projectId rompe la limpieza del grafo. |
| `GET /api/calendar` | `TASK_SELECT` + `NOTE_SELECT_NEW` | **SÍ** (extender `NOTE_SELECT_NEW` con project) | Badge en Tasks del calendario. |

**Justificación del "SÍ"**: añadir `project: {id, name, status} | null` como
metadata adicional a `NOTE_SELECT_WITH_TASK_FLAG` es seguro porque:
1. Las queries existentes usan `select` explícito — Prisma solo devuelve lo seleccionado.
2. Los tipos son interfaces TypeScript estructurales — campo opcional no rompe.
3. Las Tasks/Notes sin proyecto devuelven `project: null` — comportamiento idéntico al actual.

**Justificación del "NO" en graph**: el endpoint `/api/graph` es el grafo de
conocimiento (Note↔Note vía NoteRelationship). Su shape mínimo es intencional
(id, title, domain) para no inflar el payload. Project es metadata del
contenedor, no del grafo.

---

## 4. Endpoints nuevos y modificados

> **Convención común**: todas las responses usan `ApiSuccess<T>` /
> `ApiError` definidos en `lib/types/api.ts`.

### 4.1 `POST /api/projects` (NUEVO)

```ts
type CreateProjectInput = {
  name: string;            // requerido, no vacío (trim)
  description?: string;
  status?: ProjectStatus;  // default 'IDEATION'
};

type CreateProjectOutput = { ok: true; data: ProjectItem };
```

Comportamiento:
- `name` validado no-vacío (mismo patrón que en `/api/notes`).
- `userId` de la sesión.
- Si no se pasa `status` → `IDEATION`.
- Response 201 con `ProjectItem`.
- Errores: 400 (`name` vacío o status inválido), 401.

### 4.2 `GET /api/projects` (NUEVO)

```ts
type ListProjectsQuery = {
  status?: ProjectStatus;  // filtro opcional
};

type ListProjectsOutput = { ok: true; data: ProjectItem[] };
```

- Devuelve `Project[]` del usuario.
- Order by `updatedAt desc` (proyectos recientes primero).
- Sin filtro de status por defecto — la UI decide si mostrar ARCHIVED.
- Errores: 401.

### 4.3 `GET /api/projects/[id]` (NUEVO)

```ts
type ProjectDetail = ProjectItem & {
  notesCount: number;
  openTasksCount: number;
};

type GetProjectOutput = { ok: true; data: ProjectDetail };
```

- `notesCount` y `openTasksCount` vía `_count` de Prisma en una sola query:
  ```ts
  prisma.project.findUnique({
    where: { id, userId },
    include: {
      _count: { select: { notes: true } },
      notes: { select: { task: { select: { status: true } } } },
    },
  });
  // openTasksCount = notes.filter(n => n.task?.status === 'OPEN').length
  ```
  Alternativa más simple (dos queries): `prisma.note.count({where:{projectId:id}})`
  + `prisma.task.count({where:{note:{projectId:id}, status:'OPEN'}})`. **Decisión
  recomendada**: dos queries (legible, sin trampas de mapping).
- Errores: 404 (no existe o no es del usuario).

### 4.4 `PATCH /api/projects/[id]` (NUEVO)

```ts
type UpdateProjectInput = {
  name?: string;
  description?: string;
  status?: ProjectStatus;
};

type UpdateProjectOutput = { ok: true; data: ProjectItem };
```

**Validación de transición** (D1, app layer — NO en DB):

```ts
type ProjectTransitionError = {
  code: 'invalidTransition';
  message: string;
  details: {
    from: ProjectStatus;
    attempted: ProjectStatus;
    allowedFromCurrent: ProjectStatus[];
  };
};
```

Si `status` se incluye en el PATCH y la transición no está en `PROJECT_TRANSITIONS[current]`:
- HTTP 409.
- `details.allowedFromCurrent` lista los estados válidos desde el estado actual.

**Por qué app layer y no DB**: Postgres no permite CHECK constraints sobre
transiciones entre valores antiguos y nuevos sin trigger. Implementar un
trigger para esto es sobre-ingeniería en single-user (D6). El usuario es 1
(Ezequiel); un trigger por transición es ruido. Documentar la invariante en
código y test E2E.

Errores: 400 (body vacío / campo inválido), 401, 404, 409 (transición inválida).

### 4.5 `DELETE /api/projects/[id]` (NUEVO)

- Hard-delete.
- Comportamiento de cascade (D2):
  - `Note.projectId = null` (SetNull) — Notes sobreviven huérfanas, embedding y
    NoteRelationship intactos.
  - `Task` sigue apuntando a su Note (que ahora tiene `projectId = null`). La Task
    ni se entera del borrado del Project (no tiene FK).
- Response: `204 No Content`.
- Errores: 401, 404.

### 4.6 Endpoints modificados (no nuevos)

#### `POST /api/notes` y `PATCH /api/notes/[id]`

Añadir `projectId?: string` al body. Validación inline:
1. Regex cuid (`/^c[a-z0-9]{24,}$/`) — formato correcto.
2. **Ownership check**: `prisma.project.findUnique({ where: { id: projectId, userId } })` →
   si no existe o no es del usuario → 400 `invalid_projectId`.
3. Pasar a `prisma.note.create/update` el campo `projectId`.

Decisión recomendada: **lazy check** — validar formato, y dejar que la FK de
Postgres falle si el projectId no existe (mensaje Prisma `P2003`). Pero el
ownership check es necesario porque si el user A pasa un `projectId` del user B,
la FK no fallaría (project existe, pero no es suyo). **Mitigación**: query de
ownership check antes de asignar.

#### `PATCH /api/tasks/[id]`

**NO se toca**. Task no tiene `projectId` (D4). Si el usuario quiere cambiar
el proyecto de una Task, cambia el `projectId` de su Note asociada.

#### `POST /api/notes/[id]/accept-goal`

**NO se hace nada con projectId** (D4: Task no lo lleva). La Task se crea como
siempre. La Note mantiene su `projectId` si lo tenía. La Task queda accesible
vía `task.note.project` (JOIN en queries).

---

## 5. Plan de migración (REQ del usuario)

**Una sola migration aditiva**. Cero backfill (datos existentes = `projectId = null`).

```sql
-- prisma/migrations/<ts>_add_project/migration.sql

-- 1. Crear enum
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

-- 3. FK Project.userId → User.id (Cascade — si se borra user, sus projects se van)
ALTER TABLE "Project"
  ADD CONSTRAINT "Project_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE;

-- 4. Índices de Project
CREATE INDEX "Project_userId_status_idx"    ON "Project"("userId", "status");
CREATE INDEX "Project_userId_updatedAt_idx" ON "Project"("userId", "updatedAt");

-- 5. Añadir projectId nullable a Note (sin default — nullable + sin default = comportamiento idéntico al actual)
ALTER TABLE "Note" ADD COLUMN "projectId" TEXT;

-- 6. FK Note.projectId → Project.id (SetNull — Notes sobreviven huérfanas)
ALTER TABLE "Note"
  ADD CONSTRAINT "Note_projectId_fkey"
  FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL;

-- 7. Índice compuesto Note(projectId, noteStatus) para queries tipo "notes ACTIVE del proyecto X"
CREATE INDEX "Note_projectId_noteStatus_idx" ON "Note"("projectId", "noteStatus");

-- 8. Relación inversa en User (Prisma infiere projects Project[] del lado de Project)
-- No requiere SQL adicional — la convención Prisma infiere del campo `projects Project[]` en User.
```

**Estrategia de generación**: ejecutar `pnpm prisma migrate dev --name add_project`
localmente después de actualizar `prisma/schema.prisma`. Verificar que la
migration generada coincide con el SQL de arriba (especialmente el orden de
operaciones y la ausencia de DROP COLUMN inesperado).

**No requiere backfill**: `projectId` nullable + sin default = filas existentes
quedan con `projectId = NULL`. Comportamiento idéntico al actual. Tasks
existentes siguen apuntando a sus Notes (sin projectId).

---

## 6. Plan de ejecución (REQ del usuario)

**Estrategia**: big-bang sin feature flag (consistente con Phase 2). Una sola
migration aditiva. Deploy atómico. ~30s de ventana de mantenimiento.

**Batches (orden de PRs, deploy todo junto)**:

### Batch 1 — Schema + tipos compartidos

- `prisma/schema.prisma` — añadir `model Project`, enum `ProjectStatus`,
  `projectId` en Note (con índice), relación `projects Project[]` en User.
- `lib/types/project.ts` (**NUEVO**) — `ProjectItem`, `ProjectBrief`,
  `ProjectStatus` (re-export Prisma), `CreateProjectInput`, `UpdateProjectInput`,
  `ProjectTransitionError`.
- `lib/types/note.ts` — añadir `projectId?: string` a `NoteItem` (y opcionalmente
  `project?: ProjectBrief | null` para incluir el proyecto resuelto en algunas
  responses).
- `lib/types/task.ts` — añadir `project?: ProjectBrief | null` a `TaskWithNote`.
- `lib/hubs.ts` — añadir `NOTE_SELECT_NEW_WITH_PROJECT`, `NOTE_SELECT_WITH_TASK_FLAG_PROJECT`
  (variantes), `PROJECT_SELECT`, `PROJECT_BRIEF_SELECT`.

### Batch 2 — Migration

- `prisma/migrations/<ts>_add_project/migration.sql` — generada por `prisma migrate dev`
  desde schema del Batch 1.
- Verificar `prisma migrate dev` local sin error.
- `pnpm prisma generate` limpio.
- Staging: aplicar. Validar:
  - Tabla `Project` existe.
  - Columna `Note.projectId` es nullable.
  - FKs correctos (`Project.userId` Cascade, `Note.projectId` SetNull).
  - Índices creados.

### Batch 3 — Endpoints nuevos de Project

- `app/api/projects/route.ts` (**NUEVO**) — `POST`, `GET`.
- `app/api/projects/[id]/route.ts` (**NUEVO**) — `GET`, `PATCH`, `DELETE`.
- `lib/projects.ts` (**NUEVO**) — constante `PROJECT_TRANSITIONS`,
  helper `validateTransition(from, to)`, helper `formatProjectItem`.
- Validación de `projectId` en `app/api/notes/route.ts` y `app/api/notes/[id]/route.ts`
  (regex cuid + ownership check). Inline manual (el repo no usa Zod — ver
  R-B del explore).
- Validación de transición de status en PATCH de Project (constante + helper).

### Batch 4 — Modificar dashboard + hubs + calendar + search

- `app/api/dashboard/route.ts` — usar `NOTE_SELECT_NEW_WITH_PROJECT` en las 3
  queries Task; extender `formatNoteBrief` con `project`.
- `app/api/hubs/[domain]/route.ts` — extender selector con project.
- `app/api/notes/route.ts` — extender selector con project (afecta GET y POST).
- `app/api/calendar/route.ts` — extender `NOTE_SELECT_NEW` con project.
- `app/api/search/route.ts` — añadir project al inline select.

### Batch 5 — Frontend

- `app/(app)/page.tsx` — extender `TaskItem` local con `project?: ...`; mostrar
  badge de proyecto en focusTask/todayTasks/maintenanceTasks.
- `components/dashboard/` (si existen subcomponentes) — propagar el badge.
- **No nueva pantalla de Projects en MVP** (YAGNI, D7). Solo badge informativo.

### Batch 6 — Tests

- `tests/helpers/factories.ts` — añadir `createProject(userId, input?)` y extender
  `createNote`/`createNoteWithTask` con `projectId` opcional.
- `tests/e2e.spec.ts` — añadir tests:
  - Crear proyecto + asignar Note + verificar JOIN en dashboard (badge visible).
  - Validar transición inválida → 409 con `details.allowedFromCurrent`.
  - Validar transición válida: `IDEATION → ACTIVE → MAINTENANCE → ARCHIVED → ACTIVE` (revive).
  - Borrar proyecto → `Note.projectId = null` (verificado en DB), Task sobrevive.
  - Verificar que NoteRelationship y embedding de Notes huérfanas persisten.

### Batch 7 — Smoke manual (humano)

- [ ] Crear proyecto "Test" vía `POST /api/projects`.
- [ ] Asignar Note existente al proyecto vía `PATCH /api/notes/[id]`.
- [ ] Verificar que el dashboard muestra el badge de proyecto en la Task del foco.
- [ ] Transicionar `IDEATION → ACTIVE → MAINTENANCE → ARCHIVED`.
- [ ] Intentar transición inválida (`ARCHIVED → MAINTENANCE`) → 409 con detalles.
- [ ] Revivir `ARCHIVED → ACTIVE`.
- [ ] Borrar proyecto → Note queda huérfana (`GET /api/notes` con `projectId=null`).
- [ ] Buscar la Note huérfana en `/api/search` → sigue encontrable.
- [ ] Verificar embedding pgvector intacto en DB (`SELECT embedding FROM "Note" WHERE id = ?`).

---

## 7. Definition of Done

- [ ] `prisma/schema.prisma` actualizado según §1; `pnpm prisma format` limpio.
- [ ] `pnpm prisma migrate dev` corre local sin error; migration generada y commiteada.
- [ ] Migration aplicada en staging; tabla `Project` existe, columna `Note.projectId` es nullable.
- [ ] 4 endpoints de Project responden con los contratos documentados en §4
      (POST/GET en `route.ts` raíz + GET/PATCH/DELETE en `[id]/route.ts`).
- [ ] `/api/dashboard` devuelve `project: {id, name, status} | null` en items de Task.
- [ ] `POST /api/notes` y `PATCH /api/notes/[id]` aceptan `projectId` opcional.
- [ ] Validación de transición de `ProjectStatus` bloquea inválidas (probar `ARCHIVED → MAINTENANCE` → 409).
- [ ] `DELETE /api/projects/[id]` deja Notes con `projectId = null` (verificado en DB).
- [ ] Tests E2E nuevos pasan (creación, transición, revive, huérfano).
- [ ] `pnpm tsc --noEmit` sin errores.
- [ ] `pnpm build` sin errores.
- [ ] Backfill: ninguno necesario (datos existentes = `projectId = null`).
- [ ] Documentación: `openwiki/` actualizado con el modelo Note ↔ Project.

---

## 8. Out of scope

- **UI dedicada de Projects** (lista, detalle, gestión) — YAGNI. El badge en
  dashboard basta para MVP (D7).
- **Endpoint `/api/projects/[id]/dashboard`** (vista por proyecto) — YAGNI.
- **Filtro `?projectId=` en `/api/dashboard`** — YAGNI. El dashboard es global por diseño (D3).
- **Recurrencia de Projects** — no aplica.
- **Soft-delete de Project** — `status = ARCHIVED` ya cubre (D6).
- **Multi-tenant / RLS** — single-user, decorativo (D5).
- **Endpoint `/api/projects/[id]/transition`** separado del PATCH — se hace todo
  vía PATCH con `status`. Evita proliferación de endpoints para una sola operación.
- **Trigger de Postgres para validar transiciones** — sobre-ingeniería en
  single-user. Validación en app layer (constant + helper).
- **Snapshot tests de contratos API** — P2, otra PR.

---

## Result Contract

- **Fase**: brain-spec (Fase 2)
- **Status**: `done`
- **Artefacto**: `docs/sdd/active/projects-engine/spec.md`
- **Insumos consumidos**: `deep-think.md` (D1–D7) + `explore.md` (validación contra
  código real, blast radius, R-A a R-E) + decisión D4 cerrada por el usuario
  (NO denormalizar `Task.projectId`).
- **Insumos producidos para la siguiente fase (`brain-design`)**:
  1. Schema Prisma final con `Project`, `ProjectStatus`, `projectId` en Note
     (con índice), relación inversa en User (§1).
  2. Migration SQL exacta — una sola, aditiva, sin backfill (§5).
  3. 2 archivos nuevos de endpoints de Project (`route.ts` raíz + `[id]/route.ts`)
     con contratos detallados por método (§4.1–4.5).
  4. Argumento de cascade `SetNull` justificado con edge cases de
     NoteRelationship y embedding (§2).
  5. Impacto en `/api/dashboard` detallado — selector extendido, mapper
     modificado, resurgenceNote intacto (§3).
  6. Plan de ejecución en 7 batches (§6).
  7. Definition of Done verificable (§7).
  8. Out of scope explícito para evitar scope creep (§8).
- **Próxima fase**: `brain-design` — validar arquitectónicamente con review
  adversarial antes de pasar a `brain-apply`.
- **Riesgos top para el orchestrator**:
  - **P1** Validación de transición de status en app layer (no en DB). Aceptable
    en single-user, pero requiere test E2E explícito que la transición inválida
    devuelve 409 con `details.allowedFromCurrent`.
  - **P1** El refactor del select en `/api/dashboard` puede romper tests E2E que
    asuman shape exacto del JSON. Verificar `tests/e2e.spec.ts:509-515` (test de
    `focusTask`) — actualmente accede a `body.data.focusTask` sin validar forma
    exacta, pero confirmar que ningún otro test usa deep equality.
  - **P2** Migration aditiva sin backfill es segura, pero `prisma migrate dev`
    debe generar la migration limpia (sin DROP COLUMN inesperado). Revisar el
    SQL generado manualmente antes de mergear.
  - **P2** Validación inline de `projectId` en POST/PATCH de Note — ownership
    check añade 1 query por write. Aceptable (single-user), pero documentar el
    trade-off.