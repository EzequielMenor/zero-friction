# Design: Project Engine

**Proyecto**: `zero-friction`
**Sesión**: `projects-engine-2026-07-09`
**Fase**: brain-design (Fase 3)
**Estado**: `done`

> **Path canónico del dashboard**: `/api/dashboard` (no `/api/today`). Si el
> usuario vuelve a mencionar `/api/today`, apuntar a `/api/dashboard`. Cualquier
> referencia en este doc usa `/api/dashboard`.

> **NO escribir código**. Este artefacto es solo diseño y estrategia.

---

## Tabla de contenidos

1. [Validación arquitectónica de la spec](#1-validación-arquitectónica-de-la-spec)
2. [Arquitectura por capas](#2-arquitectura-por-capas)
3. [Capa UI — badge de proyecto](#3-capa-ui--badge-de-proyecto)
4. [Capa API — patrones y validación](#4-capa-api--patrones-y-validación)
5. [Errores y contratos](#5-errores-y-contratos)
6. [Observabilidad (logging)](#6-observabilidad-logging)
7. [Métricas futuras (documentar, no implementar)](#7-métricas-futuras-documentar-no-implementar)
8. [Rate limiting](#8-rate-limiting)
9. [Plan refinado de 7 batches](#9-plan-refinado-de-7-batches)
10. [Tests strategy detallada](#10-tests-strategy-detallada)
11. [Plan de rollback](#11-plan-de-rollback)
12. [Definition of Done](#12-definition-of-done)
13. [Riesgos residuales](#13-riesgos-residuales)
14. [Out of scope](#14-out-of-scope)
15. [Result Contract](#15-result-contract)

---

## 1. Validación arquitectónica de la spec

> Revisión sección por sección de `spec.md` (Fase 2). Donde confirmo sin más,
> la spec se sostiene. Donde señalo ajuste, hay que tenerlo en cuenta en las
> siguientes fases.

### 1.1 §1 Schema Prisma

**Veredicto**: ✅ Se sostiene en su totalidad. Sin ajustes.

| Elemento | Validación |
|---|---|
| `enum ProjectStatus { IDEATION, ACTIVE, MAINTENANCE, ARCHIVED }` | No colisiona con ningún ENUM existente. Coherente con D1 (cerrada en deep-think §2). |
| `model Project { id, userId, name, description?, status, createdAt, updatedAt }` | Coherente con D5 (todos los modelos llevan `userId`, decorativo en single-user). `status` default `IDEATION` coincide con flujo natural (piensa → construye). |
| `Project.notes Note[]` (relación inversa sin Task) | **Crítico D4**: Task NO se relaciona con Project. La Task deriva vía JOIN. Esto es lo que elimina el riesgo P1 de desincronización detectado en deep-think §7. Se sostiene. |
| `@@index([userId, status])` | Justificado: query típica "dame proyectos ACTIVE del usuario". |
| `@@index([userId, updatedAt])` | Justificado: ordenamiento "proyectos recientes". |
| `Note.projectId String?` nullable + `onDelete: SetNull` | Sin default → datos existentes quedan con `projectId = NULL` (cero backfill). |
| `@@index([projectId, noteStatus])` | Útil futuro "notes ACTIVE del proyecto X". Hoy no tiene query que lo use pero el coste del índice compuesto es bajo. |
| `User.projects Project[]` | Relación inversa. Prisma infiere sin SQL adicional. |

**Sin cambios al schema fuera de lo que la spec lista en §1.2, §1.3, §1.4.**

#### 1.1.1 Confirmación explícita de ausencia de columna en Task

Confirmo que **NO se añade `Task.projectId`**. Razones ya documentadas en el spec §1.3 y explore §4 D4:

- `Task.noteId` es `NOT NULL UNIQUE` (explore §1, P0 resuelto). Task SIEMPRE tiene Note.
- `note: { project: { select: { id, name, status } } }` añade UN nivel de JOIN. Coste despreciable a volumen de cabina personal (cientos de Tasks).
- Elimina el servicio atómico de sincronización (deep-think §7 riesgo P1).
- Elimina la segunda columna en la migration.
- D4 cerrada por el usuario en Fase 2.

**Confirmado**: no toca `prisma/schema.prisma` en la sección `model Task`.

### 1.2 §2 Cascade `Note.projectId → SetNull`

**Veredicto**: ✅ Se sostiene.

| Punto | Validación |
|---|---|
| `SetNull` para Note | Coherente con patrón existente (`Transaction.subscriptionId → SetNull`, `Transaction.accountId → SetNull`). Coherente con asimetría Note (Second Brain, conocimiento) vs Task (táctica, descartable). |
| Sin `Task.projectId` (D4) | La Task ni se entera del borrado del Project — no tiene FK que romper. La Task sigue apuntando a su Note que ahora tiene `projectId = null`. JOIN devuelve `project: null` en response. Coherente y limpio. |
| NoteRelationship intactas | El grafo de conocimiento es entre Notes, no entre Projects. Los links sobreviven. |
| Embedding pgvector intacto | La columna `embedding` es del contenido semántico, no del proyecto. La Note huérfana sigue buscable. |

**Un único ajuste menor** (no contradice la spec, lo concreta): añadir a `lib/types/note.ts` un comentario explícito de que `project` (si se incluye en responses) puede ser `null` por **dos razones distintas**:

1. La Note nunca tuvo proyecto (huérfana de origen).
2. La Note **perdió** su proyecto al ser borrado (huérfana por cascade).

La UI las renderiza igual (sin badge), pero el dato operativo es distinto y conviene documentarlo en el tipo.

### 1.3 §3 Impacto en queries

**Veredicto**: ✅ Se sostiene, con anotaciones de implementación.

| Endpoint | ¿Añadir project? | Validación |
|---|---|---|
| `GET /api/dashboard` (3 secciones Task) | SÍ | El cambio mínimo es `note: { select: { ...NOTE_SELECT_NEW, project: { select: { id: true, name: true, status: true } } } }`. Implementación vía nuevo `NOTE_SELECT_NEW_WITH_PROJECT` en `lib/hubs.ts`. |
| `GET /api/hubs/[domain]` | SÍ | Extender `NOTE_SELECT_WITH_TASK_FLAG` (o crear `NOTE_SELECT_WITH_TASK_FLAG_PROJECT`). |
| `GET /api/notes` | SÍ | Mismo selector que hubs (consistencia). |
| `GET /api/search` | SÍ | Añadir al inline select. |
| `GET /api/graph` | NO | El grafo es Note↔Note, project es ruido del contenedor. |
| `GET /api/calendar` | SÍ | Extender `NOTE_SELECT_NEW` con project. |

**Ajuste menor** (no contradice §3.2 spec): el spec recomienda crear
`NOTE_SELECT_NEW_WITH_PROJECT` y `NOTE_SELECT_WITH_TASK_FLAG_PROJECT`. Mi
recomendación concreta es:

- Crear `NOTE_SELECT_WITH_PROJECT` (select base con project) en `lib/hubs.ts`.
- `NOTE_SELECT_NEW_WITH_PROJECT = NOTE_SELECT_WITH_PROJECT` (alias actual para
  mantener nombre usado en spec).
- `NOTE_SELECT_WITH_TASK_FLAG_PROJECT = { ...NOTE_SELECT_WITH_PROJECT, task: { select: { id: true } } }`.

Un único select base + dos derivados = menos riesgo de drift entre los
selectores. Si la spec lo prefiere literal, mantener los dos nombres. Decisión
de naming para `brain-tasks` (no bloquea).

**Ajuste fino**: la query 6 (`resurgenceNote`) usa `NOTE_SELECT_WITH_TASK_FLAG`.
Mantener ese shape en MVP; la spec lo deja intacto (decisión D3). **No tocar
la query 6** para añadir project — la spec lo desaconseja expresamente.

### 1.4 §4 Endpoints

**Veredicto**: ✅ Se sostiene, con aclaraciones de implementación.

| Endpoint | Validación |
|---|---|
| `POST /api/projects` | OK. Default `status = IDEATION` cuando falta en body. |
| `GET /api/projects` | OK. `orderBy: { updatedAt: 'desc' }` por defecto. Filtro `?status=` opcional (default = todos los status). |
| `GET /api/projects/[id]` | OK. Dos queries (`prisma.project.findUnique({ where, include: { _count: { select: { notes: true } } } })` + `prisma.task.count({ where: { note: { projectId: id }, status: 'OPEN' } })`) — más legible que el `_count.notes` con map `filter.status`. **Confirmo la recomendación del spec §4.3**. |
| `PATCH /api/projects/[id]` | OK. Validación de transición **en app layer** con constante `PROJECT_TRANSITIONS` + helper `validateTransition(from, to)`. 409 con `details.allowedFromCurrent`. |
| `DELETE /api/projects/[id]` | OK. Hard-delete. Cascade `Note.projectId → null` lo gestiona Prisma. **Decisión de implementación**: usar `prisma.project.delete` (Prisma traduce el cascade SetNull automáticamente). Response `204 No Content`. |
| `POST /api/notes` + `PATCH /api/notes/[id]` | OK. Aceptan `projectId` opcional. Validación: regex cuid (`/^c[a-z0-9]{24,}$/i`) + ownership eager (`prisma.project.findUnique({ where: { id: projectId, userId }, select: { id: true } })`). 400 con `code: 'invalid_projectId'` si falla. |

**Aclaración R-B del explore** (validación inline manual sin Zod): el repo
no usa Zod. El código hoy valida con `if (!title || ...)` y assertions de
tipo. **Consistencia**: usar el mismo patrón para `projectId`. NO introducir
Zod en este batch (sería scope creep; documentar en otra PR si se quiere).

#### 1.4.1 Aclaración sobre PATCH multi-campo en Project

`UpdateProjectInput` permite actualizar `name`, `description` y `status` en
cualquier combinación. **Reglas**:

- Si `status` viene en el body pero es idéntico al actual → idempotente, 200 sin warning.
- Si `status` viene Y la transición es inválida → 409 con `details.allowedFromCurrent`. No aplicar el resto de cambios.
- Si `status` no viene → no tocar `status` (solo aplicar los otros campos).
- `name` validado no-vacío (mismo patrón que Notes).
- `description` acepta cualquier string o `null` explícito para borrar.

```ts
// Pseudo-implementación (referencia, no código final)
const project = await prisma.project.findUnique({ where: { id, userId } });
if (!project) return 404;

if (body.status && body.status !== project.status) {
  const v = validateTransition(project.status, body.status);
  if (!v.ok) return 409 invalidTransition;
  // Nota: hay que validar que body.status es un ProjectStatus válido
  // antes de llamar a validateTransition (ver §4.1.2). Si no, puede lanzar TypeError.
}

// CAS: el WHERE incluye status esperado para detectar race
const updated = await prisma.project.updateMany({
  where: { id, userId, status: project.status },
  data: {
    ...(body.name && { name: body.name }),
    ...(body.description !== undefined && { description: body.description }),
    ...(body.status && { status: body.status }),
  },
});

if (updated.count === 0) {
  // Alguien cambió el status entre el read y el update
  return 409 invalidTransition con details.allowedFromCurrent = [...según nuevo status...];
}
return 200 ProjectItem;
```

#### 1.4.2 Aclaración sobre POST/PATCH de Note con projectId

| Caso | Comportamiento |
|---|---|
| `projectId` ausente o `null` | Pasa `null` a Prisma (limpia el proyecto si tenía uno). |
| `projectId` con formato cuid inválido | 400 con `code: 'invalid_projectId_format'`. NO toca la DB. |
| `projectId` con formato válido pero no existe en DB | 400 con `code: 'invalid_projectId_not_found'`. NO toca la DB. |
| `projectId` existe pero pertenece a otro user | 400 con `code: 'invalid_projectId_forbidden'`. NO toca la DB. (mejor que 404 porque filtra menos info, pero aceptar discusión). |
| `projectId` válido y del user | Lo asigna. 200 con Note actualizada. |

El ownership eager consume 1 SELECT por write. Aceptable en single-user (ver
riesgo P2 §13).

### 1.5 §5 Migration

**Veredicto**: ✅ Se sostiene. Una sola migration aditiva.

Confirmaciones:

1. **No backfill**: columna `projectId String?` sin default → filas existentes con `NULL`. Cero datos que migrar.
2. **Orden de operaciones importa**: el spec §5 lista 8 pasos en orden. Debe coincidir con el SQL que genera `prisma migrate dev`. **Mitigación**: revisar el diff de `migration.sql` manualmente antes de mergear (riesgo P2 §13).
3. **Cascade SetNull** es nativo Prisma → no necesita SQL crudo (Prisma lo infiere del modelo).
4. **Índice compuesto `Note(projectId, noteStatus)`** — confirmo: aunque el spec lo justifica como "futuro vista por proyecto", añadirlo en MVP no cuesta nada (storage trivial) y si YAGNI se aplica, entonces NO crearlo y añadirlo después. **Decisión recomendada para batch 2**: crearlo, ya que es barato y elimina un ALTER TABLE futuro.

**Pequeño refinamiento**: tras `prisma migrate dev`, ejecutar
`pnpm prisma format` y verificar que el schema y la migration están
sincronizados (esto es lo que `pnpm prisma format` chequea implícitamente).

### 1.6 §6 Plan de ejecución (7 batches)

**Veredicto**: ✅ Se sostiene. El spec lista 7 batches. Refino archivos
exactos, pre-requisitos, validaciones y notas en §9 de este design.

**Sin cambios al orden ni al alcance**.

**Aclaración importante sobre estrategia**: el spec dice "big-bang sin
feature flag". Lo confirmo. La migration es aditiva (sin riesgo de fila), y
los endpoints nuevos no rompen nada existente (solo añaden `project` a
responses, campo opcional). El deploy atómico es seguro. **Sin ventana de
mantenimiento** (no es necesario parar la app para que la migration corra;
Vercel + Supabase manejan el timing).

---

## 2. Arquitectura por capas

```
┌────────────────────────────────────────────────────────────────────────┐
│                      UI (React 19 + App Router)                         │
│  app/(app)/page.tsx                       ← badge en Task (foco/hoy/   │
│  app/(app)/calendar/page.tsx              ← badge en Task de calendario │
│  app/(app)/hubs/[domain]/page.tsx         ← badge en Note del hub       │
│  app/(app)/search/page.tsx               ← badge en search results      │
│  components/dashboard/Dashboard.tsx      ← propaga project opcional    │
│                                                                        │
│  Responsabilidad: render + UX optimista. Consume shapes desde          │
│  lib/types/ (nunca Prisma directo). Badge renderiza si note.project    │
│  (resuelto server-side) llega con datos válidos.                       │
└────────────────────────────┬───────────────────────────────────────────┘
                             │ fetch
                             │ GET /api/dashboard    (devuelve project)
                             │ POST/PATCH /api/notes (body: projectId?)
                             │ POST/GET/PATCH/DELETE /api/projects/* (NUEVOS)
                             │
┌────────────────────────────▼───────────────────────────────────────────┐
│                    API Routes (App Router)                              │
│  app/api/dashboard/route.ts            ← 3 selects con project          │
│  app/api/notes/route.ts                ← + projectId opcional           │
│  app/api/notes/[id]/route.ts           ← + projectId opcional           │
│  app/api/hubs/[domain]/route.ts        ← selector con project           │
│  app/api/calendar/route.ts             ← selector con project           │
│  app/api/search/route.ts               ← inline + project               │
│  app/api/projects/route.ts             ← NUEVO POST, GET                │
│  app/api/projects/[id]/route.ts        ← NUEVO GET, PATCH, DELETE       │
│                                                                        │
│  Responsabilidad:                                                     │
│   • Validar input (inline, sin Zod — R-B explore)                      │
│   • Sesión del user                                                   │
│   • Transacciones Prisma (lo necesario)                               │
│   • Mapear errores Prisma → ApiError (400/401/404/409)                 │
│   • Rate-limit por endpoint (lib/rate-limit.ts §8)                     │
│   • Logging estructurado vía console.log (Vercel captura, ver §6)      │
└────────────────────────────┬───────────────────────────────────────────┘
                             │ Prisma Client (tipado)
                             │
┌────────────────────────────▼───────────────────────────────────────────┐
│                      Services / Helpers (lib/)                         │
│  lib/projects.ts                 ← NUEVO ProjectItem shape,            │
│                                     PROJECT_TRANSITIONS,               │
│                                     validateTransition,                │
│                                     formatProjectItem,                 │
│                                     formatProjectBrief                 │
│  lib/hubs.ts                     ← + NOTE_SELECT_WITH_PROJECT,         │
│                                     NOTE_SELECT_WITH_TASK_FLAG_PROJECT,│
│                                     PROJECT_SELECT, PROJECT_BRIEF_SELECT│
│  lib/types/project.ts            ← NUEVO ProjectItem, ProjectBrief,    │
│                                     CreateProjectInput,                │
│                                     UpdateProjectInput                 │
│  lib/types/note.ts               ← + project?: ProjectBrief | null    │
│  lib/types/task.ts               ← + project?: ProjectBrief | null    │
│  lib/rate-limit.ts               ← REUSAR Phase 2 (lib en MVP)         │
│                                                                        │
│  Responsabilidad: lógica pura del modelo. Selectores reutilizables.   │
│  Mappers sin estado (formatProjectItem, formatTaskItem, etc.).         │
└────────────────────────────┬───────────────────────────────────────────┘
                             │
┌────────────────────────────▼───────────────────────────────────────────┐
│                       Prisma Schema (DB)                               │
│  Project { id, userId, name, description?, status,                     │
│            createdAt, updatedAt,                                       │
│            notes Note[] }                                              │
│        @@index([userId, status])                                       │
│        @@index([userId, updatedAt])                                    │
│                                                                        │
│  Note { id, userId, title, content, domain, tags, suggestedGoals,    │
│         embedding, noteStatus, createdAt, updatedAt,                   │
│         task Task?,                                                   │
│         projectId String?,                                            │
│         project Project? @relation(onDelete: SetNull),                 │
│         incomingLinks/outgoingLinks ... }                             │
│        @@index([projectId, noteStatus])   ← NUEVO                      │
│                                                                        │
│  User { ..., projects Project[] }  ← + relación inversa               │
│                                                                        │
│  Task: SIN CAMBIOS (D4 — derivation vía JOIN Task→Note→Project).      │
└────────────────────────────────────────────────────────────────────────┘
```

### 2.1 Flujo de datos end-to-end

```
[UI: focusTask card]
       ↓
       GET /api/dashboard
       ↓
[Server: dashboard/route.ts]
   Promise.all([focusTask, todayTasks, maintenanceTasks, ...])
       ↓
   prisma.task.findFirst/findMany({ select: { ..., note: { select: NOTE_SELECT_WITH_PROJECT } } })
       ↓
   PostgreSQL ejecuta 3 queries (índices existentes en Task + prisma infiere JOIN a Note + include nested a Project)
       ↓
   formatTodayItem → { task: formatTaskItem, note: formatNoteBrief ({ ..., project }) }
       ↓
[Response JSON con field "project": { id, name, status } | null]
       ↓
[UI: renderiza badge con color según status]
```

### 2.2 Acoplamiento por capas

| Capa | Lee de | Escribe en | Acoplamiento |
|---|---|---|---|
| UI | `lib/types/project.ts` (ProjectItem, ProjectBrief) | — | Débil (solo tipos). Añadir badge = un componente sin tocar el resto. |
| API | `lib/projects.ts`, `lib/types/project.ts`, Prisma Client | DB | Transaccional. 1 SELECT extra por write (ownership check). |
| Lib | Prisma Client | — | Cero estado. Selectores y mappers puros. |
| Prisma | DB | DB | Nativo. |

**Decisión arquitectónica clave**: la validación de transición (`PROJECT_TRANSITIONS`, `validateTransition`) vive en `lib/projects.ts` (helper puro). **NO se duplica** en API routes. Cada PATCH de Project llama al helper. Testeable aisladamente (batch 7 + §10).

---

## 3. Capa UI — badge de proyecto

> **Decisión**: NO nueva pantalla de Projects en MVP (D7). Única adición UI
> visible: un **badge informativo** en cada Task de foco/día/mantenimiento,
> en las Notes de hub/notas/búsqueda y en las Tasks del calendario. Esto da
> valor inmediato sin construir navegación nueva.

### 3.1 Dónde se renderiza el badge

| Vista | Archivo | Token donde se muestra | Campo de la response |
|---|---|---|---|
| Dashboard — focusTask | `app/(app)/page.tsx` (línea ~área de render de focusTask) | Encabezado del card de Task, junto a prioridad | `data.focusTask.note.project` |
| Dashboard — todayTasks | `app/(app)/page.tsx` | Línea de cada Task (derecha, antes de fecha) | `data.todayTasks[i].note.project` |
| Dashboard — maintenanceTasks | `app/(app)/page.tsx` | Línea de cada Task | `data.maintenanceTasks[i].note.project` |
| Calendar | `app/(app)/calendar/page.tsx` | Línea de Task del día | `task.note.project` (a través de la query calendar ya existente) |
| Hub (`[domain]`) | `app/(app)/hubs/[domain]/page.tsx` | Tarjeta de Note | `note.project` |
| Notes list (Inbox section si hay filtro por proyecto, o cualquier listado de Notes) | `components/InboxSection.tsx`, listados en hubs | Tarjeta de Note | `note.project` |
| Search results | UI de search | Tarjeta de result | `result.note.project` (si la response incluye) |

### 3.2 Color por status

| Status | Color CSS sugerido (Tailwind) | Razonamiento |
|---|---|---|
| `IDEATION` | `bg-gray-200 text-gray-700 dark:bg-gray-700 dark:text-gray-200` | Gris neutro. "Pensando" / sin compromiso. |
| `ACTIVE` | `bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200` | Verde. "Construyendo". Color de progreso vivo. |
| `MAINTENANCE` | `bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200` | Azul. "Sostenido". Color de baja energía / soporte. |
| `ARCHIVED` | `bg-gray-300 text-gray-600 dark:bg-gray-800 dark:text-gray-400` | Gris oscuro. "Congelado" / apagado. |

**Decisión de implementación**: el componente `ProjectBadge.tsx` (a crear) acepta `project: ProjectBrief | null` y aplica el color. **Si `project === null` → no renderiza** (no muestra slot vacío). El badge es informativo, no obligatorio.

**Riesgo bajo**: Tailwind purge puede no recoger las clases si son dinámicas. Usar `clsx` o template literals seguros. El equipo puede validar con la build local.

### 3.3 Comportamiento del badge

- **Clickable**: opcional. En MVP lo dejo NO clickeable (D7). La próxima iteración si Ezequiel pide "ver proyecto" lo enlaza a `/projects/[id]` (endpoint futuro, out of scope hoy).
- **Texto**: nombre del proyecto (`project.name`). Si el nombre es largo (>20 chars), truncar con ellipsis.
- **Tooltip**: `title={project.name + ' · ' + project.status}` para hover (accesibilidad básica).
- **Tamaño**: `text-xs px-1.5 py-0.5 rounded` — discreto, no compite con la prioridad de la Task.

### 3.4 A11y

- `role="status"` con texto que ScreenReader pueda leer.
- `aria-label="Proyecto: {name}, estado {status}"`.
- Color NO es la única señal: siempre muestra el nombre (texto).

### 3.5 Out of UI en MVP

- ❌ Página `/projects` o `/projects/[id]` (D7).
- ❌ Filtro por proyecto en dashboard (D3 — global por diseño).
- ❌ Dropdown para asignar proyecto desde Task (se hace vía Note).
- ❌ Drag-and-drop Note → Project.
- ❌ Lista de "proyectos recientes" en sidebar.
- ❌ Stats/contadores UI de proyectos.

---

## 4. Capa API — patrones y validación

### 4.1 `lib/projects.ts` — NUEVO

**Decisión**: módulo dedicado a lógica de Project. Vive junto a `lib/hubs.ts`
y `lib/types/project.ts`. Cero estado, todo puro.

**Contendrá**:

#### 4.1.1 `PROJECT_TRANSITIONS` (constante)

```ts
// Aislada aquí, NO duplicada en routes. Una sola fuente de verdad.
export const PROJECT_TRANSITIONS: Record<ProjectStatus, ProjectStatus[]> = {
  IDEATION:    ['ACTIVE', 'ARCHIVED'],
  ACTIVE:      ['MAINTENANCE', 'ARCHIVED', 'IDEATION'],
  MAINTENANCE: ['ACTIVE', 'ARCHIVED'],
  ARCHIVED:    ['ACTIVE', 'IDEATION'],  // revive
}
```

#### 4.1.2 `validateTransition(from, to)`

```ts
export type TransitionValidationOk = { ok: true }
export type TransitionValidationErr = {
  ok: false
  from: ProjectStatus
  attempted: ProjectStatus
  allowedFromCurrent: ProjectStatus[]
}
export type TransitionValidation = TransitionValidationOk | TransitionValidationErr

**Validación previa en la route** (obligatoria, antes de llamar a `validateTransition`):

```ts
// La route debe validar que body.status es un ProjectStatus válido
// antes de llamar a validateTransition. Si no, PROJECT_TRANSITIONS[from]
// puede ser undefined y .includes() lanza TypeError → 500.
const VALID_STATUSES = ['IDEATION', 'ACTIVE', 'MAINTENANCE', 'ARCHIVED'] as const;
if (body.status && !VALID_STATUSES.includes(body.status)) {
  return 400 invalid_status;
}
```

*Alternativa (refactor de `validateTransition`)*: aceptar `string` y devolver
`{ok: false, error: 'invalid_status'}` si `from` no está en `PROJECT_TRANSITIONS`.
Ver §5.2 para el contrato.

export function validateTransition(from: ProjectStatus, to: ProjectStatus): TransitionValidation {
  // Si mismo estado → ok (idempotente)
  // Si transición en PROJECT_TRANSITIONS[from] → ok
  // Sino → err con allowedFromCurrent
}
```

**Comportamiento idempotente**: `validateTransition('ACTIVE', 'ACTIVE')` → `{ ok: true }`. Justificación: PATCH que solo cambia `name` no debe pasar `status`, pero si lo pasa igual, no rompe.

#### 4.1.3 Mappers (`formatProjectItem`, `formatProjectBrief`)

- `formatProjectItem(p: Project): ProjectItem` — incluye `id`, `userId`, `name`, `description`, `status`, `createdAt`, `updatedAt` con fechas a ISO string.
- `formatProjectBrief(p: { id, name, status } | null): ProjectBrief | null` — solo `{ id, name, status }` para listas ligeras. Si `null`, devuelve `null`.

#### 4.1.4 (Opcional) `findOwnProjectOrThrow(projectId, userId)`

Helper que combina regex cuid + ownership. Usado por POST/PATCH de Note. Si no existe o no es del user → lanza `InvalidProjectIdError` que la route mapea a 400 con `code: 'invalid_projectId'`. **Reduce duplicación** entre los 2 endpoints.

#### 4.1.5 Razones para aislar esto

- **Testabilidad**: helper puro, fácil de cubrir con tests unitarios (§10).
- **DRY**: 2 routes (POST/GET en raíz + GET/PATCH/DELETE en `[id]`) consumen la constante y helper.
- **Cambio futuro**: si en MVP siguiente se permite revive, se cambia en un sitio. Si se añade un nuevo valor a `ProjectStatus`, se actualiza el DAG aquí.

### 4.2 `lib/types/project.ts` — NUEVO

Tipos compartidos para API + UI. Sigue el patrón de `lib/types/task.ts` y `lib/types/note.ts`.

```ts
// Re-export del enum de Prisma para que las types no acoplen a Prisma Client.
export type { ProjectStatus } from '@prisma/client'

// Brief: lo que se embebe en items compuestos (Task, Note).
export type ProjectBrief = {
  id: string
  name: string
  status: ProjectStatus
}

// Full: shape completo de Project.
export type ProjectItem = {
  id: string
  userId: string
  name: string
  description: string | null
  status: ProjectStatus
  createdAt: string  // ISO
  updatedAt: string  // ISO
}

// Detalle con contadores.
export type ProjectDetail = ProjectItem & {
  notesCount: number
  openTasksCount: number
}

// Inputs.
export type CreateProjectInput = {
  name: string
  description?: string
  status?: ProjectStatus  // default IDEATION
}

export type UpdateProjectInput = {
  name?: string
  description?: string | null  // null explícito para borrar
  status?: ProjectStatus
}

// Error específico para transiciones inválidas.
export type ProjectTransitionError = {
  code: 'invalidTransition'
  message: string
  details: {
    from: ProjectStatus
    attempted: ProjectStatus
    allowedFromCurrent: ProjectStatus[]
  }
}

// Errores específicos de validación de projectId en Note (POST/PATCH).
export type InvalidProjectIdFormatError = {
  code: 'invalid_projectId_format'
  message: string
  details: { projectId: string; expected: 'cuid' }
}
export type InvalidProjectIdNotFoundError = {
  code: 'invalid_projectId_not_found'
  message: string
  details: { projectId: string }
}
export type InvalidProjectIdForbiddenError = {
  code: 'invalid_projectId_forbidden'
  message: string
  details: { projectId: string }
}
export type InvalidProjectIdError =
  | InvalidProjectIdFormatError
  | InvalidProjectIdNotFoundError
  | InvalidProjectIdForbiddenError
```

### 4.3 Validación de `projectId` en Note POST/PATCH

**Decisión**: validar formato (regex cuid) + ownership eager.

#### 4.3.1 Regex cuid

```ts
// El cuid generado por Prisma empieza por 'c' y luego 24+ chars alfanuméricos.
// Esto cubre el formato. No garantiza validez absoluta (eso requiere lookup),
// pero filtra inputs basura rápido antes de la query de DB.
const CUID_REGEX = /^c[a-z0-9]{20,30}$/i  // rango tolerante (cuid actual 25)
```

**Si falla el regex** → 400 `code: 'invalid_projectId_format'`. **NO** se hace la query a DB.

#### 4.3.2 Ownership check eager

```ts
const project = await prisma.project.findUnique({
  where: { id: projectId },  // ya validado por regex
  select: { userId: true },
})
if (!project) return error('invalid_projectId_not_found')
if (project.userId !== userId) return error('invalid_projectId_forbidden')
```

**Si pasa** → asignar `projectId` a la Note. 1 query extra por write (R-B explore).

**Justificación**: la FK de Postgres no protege contra proyecto de otro user (la fila existe, la constraint no falla). Sin el check, Ezequiel podría pasarle `projectId` de otro usuario y la DB aceptaría → **fuga de datos cross-user en multi-tenant futuro**. El check eager previene esto desde el MVP.

#### 4.3.3 Inline en route

Patrón a aplicar **idéntico** en `POST /api/notes` y `PATCH /api/notes/[id]`:
1. Si `projectId` ausente → omitir campo en el `create/update`.
2. Si `projectId === null` explícito → pasar `null` (limpia).
3. Si `projectId` string → regex + ownership check.

Repetir la lógica inline es feo pero **consistente con el patrón actual**
del repo (R-B explore). Considerar extraer a helper en `lib/projects.ts`
(§4.1.4) si se repite más de 2 veces. Hoy se repite 2 veces (POST/PATCH de
Note) → **justifica la extracción**.

### 4.4 `formatTaskItem` y `formatNoteBrief` — actualización

#### 4.4.1 `formatTaskItem` en `app/api/dashboard/route.ts`

El mapper actual **NO se toca**. `project` se añade en `formatNoteBrief`
debajo, no en `formatTaskItem`. Razón: la Task no tiene projectId (D4), el
project vive en la Note anidada. Devolverlo en el item de Task confundiría
el shape (Task no sabe de Project).

#### 4.4.2 `formatNoteBrief` — añadir `project`

Estado actual (route.ts línea 173-187):

```ts
const formatNoteBrief = (n: Record<string, unknown>) => {
  const note = n as { id, userId, title, content, domain, tags, noteStatus, createdAt, updatedAt }
  return { id, userId, title, content, domain, tags: tags ?? [], noteStatus, hasTask: true, createdAt: createdAt.toISOString(), updatedAt: updatedAt.toISOString() }
}
```

Cambio propuesto:

```ts
const formatNoteBrief = (n: Record<string, unknown>) => {
  const note = n as { id, userId, title, content, domain, tags, noteStatus, createdAt, updatedAt, project: { id, name, status } | null }
  return { id, userId, title, content, domain, tags: tags ?? [], noteStatus, hasTask: true, project: note.project ? { id: note.project.id, name: note.project.name, status: note.project.status } : null, createdAt: ..., updatedAt: ... }
}
```

**Afirmación de contrato**: `hasTask: true` es invariante actual (un TodayItem viene con Task). En Tasks de calendario esto puede ser `false`. El badge de proyecto, por su parte, es **siempre opcional** (`project | null`).

### 4.5 Selectores nuevos en `lib/hubs.ts`

```ts
// Selector base Note con project anidado (3 campos).
export const PROJECT_BRIEF_SELECT = {
  id: true,
  name: true,
  status: true,
} as const

// Select base para Note con project.
export const NOTE_SELECT_WITH_PROJECT = {
  ...NOTE_SELECT_NEW,
  project: { select: PROJECT_BRIEF_SELECT },
} as const

// Para hubs/notes list (lleva hasTask también).
export const NOTE_SELECT_WITH_TASK_FLAG_PROJECT = {
  ...NOTE_SELECT_WITH_PROJECT,
  task: { select: { id: true } },
} as const
```

Y renombrar alias para mantener compatibilidad con spec:

```ts
export const NOTE_SELECT_NEW_WITH_PROJECT = NOTE_SELECT_WITH_PROJECT
```

Las 3 queries del dashboard usan `NOTE_SELECT_NEW_WITH_PROJECT` para la nota
anidada de Task. La sección `resurgenceNote` mantiene `NOTE_SELECT_WITH_TASK_FLAG`
(hubs de momento llevan project también, pero resurgenceNote **no lo
muestra** en MVP).

### 4.6 Rutas Prisma modificadas

| Route | Cambio | Riesgo |
|---|---|---|
| `app/api/dashboard/route.ts` | select de las 3 queries Task usa `NOTE_SELECT_NEW_WITH_PROJECT`. `formatNoteBrief` añade `project`. | Bajo. |
| `app/api/hubs/[domain]/route.ts` | select usa `NOTE_SELECT_WITH_TASK_FLAG_PROJECT`. | Bajo. |
| `app/api/notes/route.ts` (GET y POST) | GET: select usa `NOTE_SELECT_WITH_TASK_FLAG_PROJECT`. POST: acepta `projectId` opcional en body, lo asigna tras ownership check. | Bajo. |
| `app/api/notes/[id]/route.ts` (PATCH) | Acepta `projectId` opcional en body, valida y asigna. | Bajo. |
| `app/api/calendar/route.ts` | `NOTE_SELECT_NEW` (vía task.note) → `NOTE_SELECT_NEW_WITH_PROJECT`. | Bajo. |
| `app/api/search/route.ts` | Inline select → añade `project: { select: PROJECT_BRIEF_SELECT }`. | Bajo. |

### 4.7 Inyección de headers / cache

`/api/dashboard` ya devuelve `Cache-Control: no-store` (route.ts línea 219).
**No cambiar**. La adición de `project` no altera la política de cache (la
data sigue siendo per-user y dinámica).

---

## 5. Errores y contratos

### 5.1 Matriz de errores por endpoint

| Endpoint | 200/201/204 | 400 | 401 | 403 | 404 | 409 | 500 |
|---|---|---|---|---|---|---|---|
| `POST /api/projects` | 201 (ProjectItem) | `name` vacío / status inválido en body | No autenticado | — | — | — | Error Prisma no contemplado |
| `GET /api/projects` | 200 (ProjectItem[]) | — | No autenticado | — | — | — | Error Prisma |
| `GET /api/projects/[id]` | 200 (ProjectDetail) | — | No autenticado | — | Project no existe o no es del user | — | Error Prisma |
| `PATCH /api/projects/[id]` | 200 (ProjectItem) | Body vacío / campo inválido | No autenticado | — | Project no existe | Transición inválida (con `details`) | Error Prisma |
| `DELETE /api/projects/[id]` | 204 No Content | — | No autenticado | — | Project no existe | — | Error Prisma (cascade fail) |
| `POST /api/notes` (con projectId inválido) | 201 normal | `invalid_projectId_format` / `invalid_projectId_not_found` / `invalid_projectId_forbidden` | Normal | — | Normal | — | P2003 (FK) si se cuela ownership check |
| `PATCH /api/notes/[id]` (con projectId inválido) | 200 normal | idem POST | idem | — | Note no existe | — | P2003 si se cuela |

### 5.2 Códigos de error estructurados

Reutilizar el patrón del repo (`{ ok: false, error: { code, message, details } }`).

| code | Cuándo se devuelve | details |
|---|---|---|
| `unauthenticated` | Sin cookie o sesión inválida | — |
| `invalid_name` (POST/PATCH de Project) | `name` vacío tras trim o > N chars (límite ~200) | — |
| `invalid_status` (POST/PATCH de Project) | `status` no es un valor válido de `ProjectStatus` | `{ received: string }` |
| `invalidTransition` (PATCH de Project) | `status` cambia a uno no permitido desde el actual | `{ from, attempted, allowedFromCurrent: ProjectStatus[] }` |
| `invalid_projectId_format` | Regex cuid falla | `{ projectId: string, reason: 'format' }` |
| `invalid_projectId_not_found` | cuid válido pero no existe Project | idem |
| `invalid_projectId_forbidden` | cuid válido pero `userId` distinto | idem |
| `not_found` (Project por id) | `prisma.project.findUnique` devuelve null | `{ projectId: string }` |

### 5.3 Contrato de respuesta uniforme

Todos siguen `ApiResponse<T>` definido en `lib/types/api.ts`:

```ts
type ApiResponse<T> =
  | { ok: true, data: T }
  | { ok: false, error: { code: string, message: string, details?: unknown } }
```

### 5.4 409 — el caso especial de Project

Cuando la transición es inválida, response:

```json
HTTP 409
{
  "ok": false,
  "error": {
    "code": "invalidTransition",
    "message": "No se puede transicionar de ARCHIVED a MAINTENANCE.",
    "details": {
      "from": "ARCHIVED",
      "attempted": "MAINTENANCE",
      "allowedFromCurrent": ["ACTIVE", "IDEATION"]
    }
  }
}
```

**Importante**: NO se aplica el cambio parcial a los otros campos. Si el body tiene `{name: "X", status: "MAINTENANCE"}` desde un Project ARCHIVED, se devuelve 409 y **NO se actualiza ni el nombre ni el estado**. Validación previa + update atómico = sin estado intermedio.

### 5.5 Prisma error mapping

| Prisma code | Mapeo en API |
|---|---|
| `P2003` (FK constraint fail) | 400 `invalid_projectId_format` / `invalid_projectId_not_found` (no debería ocurrir tras ownership check, pero red de seguridad) |
| `P2025` (Record not found) en update/delete | 404 `not_found` |
| Otros | 500 con code genérico |

Implementar un helper `mapPrismaError(e: Prisma.PrismaClientKnownRequestError, route: string)` en `lib/projects.ts` (puede ser reusado). **Trade-off**: mantenerlo simple — solo mapear los codes de arriba, dejar el resto a 500.

---

## 6. Observabilidad (logging)

> **Decisión de Phase 2 (que se sostiene)**: el repo no usa logger central
> (pino no está instalado). El patrón actual es `console.log` / `console.warn`
> / `console.error`, que Vercel captura y envía a Log Drains. **Esta fase NO
> instala una librería de logging**. Documentamos los eventos a emitir con
> `console.*` estructurado (clave=valor con prefijo `event=`).

### 6.1 Tabla de eventos

| Event name | Nivel | Contexto | Cuándo | Por qué |
|---|---|---|---|---|
| `project.created` | info | `{ userId, projectId, status }` | POST /api/projects exitoso | Métrica `project_created_total` (futura). |
| `project.status.changed` | info | `{ userId, projectId, from, to }` | PATCH /api/projects/[id] con cambio de status | Métrica `project_status_transition_total`. Útil para analytics de revive. |
| `project.deleted` | info | `{ userId, projectId, orphanNotesCount }` | DELETE /api/projects/[id] exitoso | Auditoría. Saber cuántas Notes quedan huérfanas. |
| `note.project.assigned` | info | `{ userId, noteId, projectId }` | POST/PATCH /api/notes con projectId válido | Trazabilidad. |
| `note.project.unassigned` | info | `{ userId, noteId, previousProjectId }` | POST/PATCH /api/notes con `projectId: null` explícito | Auditoría de desasignaciones. |
| `api.error.409.invalidTransition` | warn | `{ userId, projectId, from, attempted, allowed }` | PATCH /api/projects/[id] con transición inválida | Detectar bugs UI (envía transiciones raras). |
| `api.error.p2003` | error | `{ userId, route, table, fields }` | Prisma P2003 en cualquier endpoint | Bug — el ownership check debería haber prevenido. |

### 6.2 Formato de log

```ts
// Patrón recomendado (evento + contexto como string o JSON).
console.log(JSON.stringify({ event: 'project.created', userId, projectId, status, ts: new Date().toISOString() }))
console.warn(JSON.stringify({ event: 'api.error.409.invalidTransition', userId, projectId, from, attempted, ts: new Date().toISOString() }))
```

Vercel Log Drain parsea JSON.parse-able lines. Si la línea no es JSON, se muestra como texto plano (no rompe).

### 6.3 NO loggear

- Body crudo de la request (puede tener texto personal de Notes).
- Embeddings (volumen + privacidad).
- Tokens de sesión.
- API keys (ninguna debería estar en código).

### 6.4 Helper sugerido en `lib/projects.ts` (NO obligatorio)

```ts
export const logProjectEvent = (event: string, ctx: Record<string, unknown>, level: 'log' | 'warn' | 'error' = 'log') => {
  console[level](JSON.stringify({ event, ts: new Date().toISOString(), ...ctx }))
}
```

**Decisión**: incluirlo como helper reusable, low-risk. Si el equipo lo prefiere inline, descartar. No bloquea merge.

---

## 7. Métricas futuras (documentar, no implementar)

> **Ponytail**: no añadir infra de métricas. Documentar qué se mediría para
> cuando Vercel Analytics o similar se active. No se añaden contadores en código
> ni gauges ni Prometheus exporters.

| Métrica | Tipo | Etiquetas | Uso futuro |
|---|---|---|---|
| `project_created_total` | counter | `domain` (?) | Cuántos Projects/día/mes. Detectar si el usuario está creando proyectos y abandonándolos. |
| `project_status_transition_total` | counter | `from`, `to` | Distribución de transiciones. Útil para "¿el revive se usa?". |
| `orphan_notes_total` | gauge | — (point-in-time) | Cuántas Notes tienen `projectId IS NULL`. Si crece sin bound, revisar UX de asignación. |
| `project_deleted_total` | counter | `finalStatus` | Cuántos Projects borrados (y en qué estado). Indicio de limpieza. |

**Origen de datos**:

- `project_created_total` ← contar líneas con `event: 'project.created'` en Vercel Logs.
- `project_status_transition_total` ← idem `event: 'project.status.changed'` con `from`/`to`.
- `orphan_notes_total` ← query ad-hoc: `SELECT COUNT(*) FROM "Note" WHERE "projectId" IS NULL`. Snapshotted mensualmente.
- `project_deleted_total` ← idem `event: 'project.deleted'`.

Si en el futuro el equipo quiere métricas tiempo-real → considerar Vercel
Analytics o PostHog. **No en este batch**.

---

## 8. Rate limiting

### 8.1 Tabla de límites

| Endpoint | Límite | Justificación |
|---|---|---|
| `POST /api/projects` | **30 req/min/user** | Crear proyecto es manual (1 click), pero capturar agresivamente no aporta. 30/min es muy generoso. |
| `GET /api/projects` | **120 req/min/user** | Lectura intensiva (UI puede re-fetchar en focus/blur). 120/min = 2/seg, suficiente para SPA agresiva. |
| `GET /api/projects/[id]` | **120 req/min/user** | Idem (página futura). |
| `PATCH /api/projects/[id]` | **60 req/min/user** | Edición manual (cambiar nombre o status). 60/min cubre doble-click + autosave. |
| `DELETE /api/projects/[id]` | **30 req/min/user** | Acción destructiva. 30/min es muy generoso para single-user. |

### 8.2 Implementación — reutilizar `lib/rate-limit.ts`

**Confirmado por la spec y la documentación de Phase 2**:
`lib/rate-limit.ts` (NUEVO en este batch siguiendo el diseño de Phase 2 §4.3)
implementa un rate-limiter en memoria con `Map<string, {count, resetAt}>` y la
función `rateLimit(key: string, limit: number, windowMs: number): boolean`.

**Riesgos asumidos** (documentados en Phase 2 §4.3):

- Serverless de Vercel = cada lambda es stateless. El rate-limit se aplica **por instancia**, no global. Aceptable para single-user.
- En multi-tenant futuro, este rate-limiter NO escala. **Out of scope hoy** (D5, single-user).

### 8.3 Aplicación por endpoint

Patrón de uso (repetido en cada route):

```ts
import { rateLimit } from '@/lib/rate-limit'

if (!rateLimit(`post-projects:${userId}`, 30, 60_000)) {
  return NextResponse.json(
    { ok: false, error: { code: 'rate_limit', message: 'Demasiadas solicitudes. Intenta en un minuto.' } },
    { status: 429 }
  )
}
```

**Headers de respuesta**: añadir `Retry-After: 60` cuando se devuelve 429 (buena práctica HTTP; no es requerido por la spec).

### 8.4 ¿Rate limit en endpoints existentes?

Los endpoints modificados de Note (`POST/PATCH /api/notes`) **ya tienen** sus
rates definidos en la spec de Phase 2 (no verificado si está aplicado en
código, pero la spec lo definía):

- `POST /api/notes` → 30/min (Capture, intensivo pero limitado).
- `PATCH /api/notes/[id]` → 120/min (edición intensiva).

**Confirmo y no añado rates nuevos** para estos endpoints en este batch (sería scope creep — ya están definidos en la spec anterior). `grep -r rateLimit app/api/notes/` debería confirmar.

---

## 9. Plan refinado de 7 batches

> Refino el §6 del spec con archivos exactos, validaciones concretas y
> dependencias verificadas contra el código existente.

### Batch 1 — Schema Prisma + tipos compartidos

**Objetivo**: sentar la base. Cero impacto en runtime (solo tipos y schema).

**Archivos** (todos los cambios son aditivos o de tipos):

| Archivo | Acción | Detalle |
|---|---|---|
| `prisma/schema.prisma` | Modify | + `enum ProjectStatus`, + `model Project`, + `projectId String?` en Note con `@@index`, + `projects Project[]` en User. NO tocar `model Task`. |
| `lib/types/project.ts` | **NUEVO** | `ProjectItem`, `ProjectBrief`, `ProjectDetail`, `CreateProjectInput`, `UpdateProjectInput`, `ProjectTransitionError`, `InvalidProjectIdError`. Re-export `ProjectStatus`. |
| `lib/types/note.ts` | Modify | + `projectId?: string` a `NoteItem`. + `project?: ProjectBrief \| null` a `NoteWithTask` (si existe) o crear. |
| `lib/types/task.ts` | Modify | + `project?: ProjectBrief \| null` a `TaskWithNote`. |
| `lib/hubs.ts` | Modify | + `PROJECT_BRIEF_SELECT`, + `NOTE_SELECT_WITH_PROJECT`, + `NOTE_SELECT_NEW_WITH_PROJECT` (alias), + `NOTE_SELECT_WITH_TASK_FLAG_PROJECT`. |

**Pre-requisitos**: ninguno.

**Validación**:

```bash
pnpm prisma format
pnpm prisma generate
pnpm tsc --noEmit
```

**Riesgo**: cero. Cambios estrictamente aditivos.

### Batch 2 — Migration

**Objetivo**: crear tabla `Project` y columna `Note.projectId` en producción.

**Archivos**:

| Archivo | Acción | Detalle |
|---|---|---|
| `prisma/migrations/<ts>_add_project/migration.sql` | **NUEVO** (auto-generado) | Resultado de `pnpm prisma migrate dev --name add_project`. |

**Pre-requisitos**: Batch 1 mergeado.

**Validación**:

```bash
# Local: regenerar la migration
pnpm prisma migrate dev --name add_project

# Revisar manualmente que la migration coincide con spec §5:
#   - CREATE TYPE "ProjectStatus" AS ENUM
#   - CREATE TABLE "Project" (...)
#   - ALTER TABLE "Project" ADD CONSTRAINT fk_userId CASCADE
#   - CREATE INDEX "Project_userId_status_idx"
#   - CREATE INDEX "Project_userId_updatedAt_idx"
#   - ALTER TABLE "Note" ADD COLUMN "projectId" TEXT (sin default)
#   - ALTER TABLE "Note" ADD CONSTRAINT fk_projectId SET NULL
#   - CREATE INDEX "Note_projectId_noteStatus_idx"

# Staging: aplicar
pnpm prisma migrate deploy

# Verificar
psql -c "SELECT column_name, is_nullable FROM information_schema.columns WHERE table_name='Note' AND column_name='projectId';"
psql -c "SELECT conname, confdeltype FROM pg_constraint WHERE conname LIKE 'Note_projectId%';"
psql -c "SELECT COUNT(*) FROM \"Project\";"  # 0 esperado
```

**Riesgo**: bajo. Migration aditiva, sin backfill. Si `prisma migrate dev` genera SQL inesperado (e.g. DROP COLUMN accidental), abortar antes de mergear.

### Batch 3 — Endpoints nuevos de Project + lógica de transición

**Objetivo**: endpoints CRUD de Project con validación inline. Lógica pura en `lib/projects.ts`.

**Archivos**:

| Archivo | Acción | Detalle |
|---|---|---|
| `lib/projects.ts` | **NUEVO** | `PROJECT_TRANSITIONS`, `validateTransition`, `formatProjectItem`, `formatProjectBrief`, `mapPrismaError` (helper), `logProjectEvent` (opcional). |
| `lib/rate-limit.ts` | **NUEVO** | Implementación del helper `rateLimit(key, limit, windowMs)`. Seguir diseño Phase 2 §4.3 exactamente. |
| `app/api/projects/route.ts` | **NUEVO** | `POST` (CreateProjectInput + ownership de sesión), `GET` (ListProjectsQuery con `?status=` opcional). Aplicar rate-limit. Logging de eventos. |
| `app/api/projects/[id]/route.ts` | **NUEVO** | `GET` (ProjectDetail con `notesCount` + `openTasksCount`), `PATCH` (UpdateProjectInput + validateTransition), `DELETE` (204). Aplicar rate-limit. Logging de eventos. |
| `app/api/notes/route.ts` | Modify | POST: +`projectId` opcional. Validación: regex cuid + ownership eager via `findOwnProjectOrThrow`. Logging `note.project.assigned/unassigned`. |
| `app/api/notes/[id]/route.ts` | Modify | PATCH: +`projectId` opcional. Misma validación. Logging. |

**Pre-requisitos**: Batches 1 y 2 mergeados.

**Validación**:

```bash
pnpm tsc --noEmit
pnpm prisma format

# Smoke manual con cURL o Postman:
curl -X POST .../api/projects -d '{"name":"Test"}'  # 201
curl .../api/projects                                # 200 array
curl -X PATCH .../api/projects/<id> -d '{"status":"MAINTENANCE"}'  # desde IDEATION → 409
curl -X PATCH .../api/projects/<id> -d '{"status":"ACTIVE"}'        # desde IDEATION → 200
curl -X DELETE .../api/projects/<id>                                  # 204
curl -X POST .../api/notes -d '{"title":"X","content":"Y","domain":"PERSONAL","projectId":"invalid"}'  # 400 invalid_projectId_format
```

**Riesgo**: medio. Es el código nuevo del refactor. Mitigaciones:
- Helper `lib/projects.ts` testeable aisladamente (Batch 7 lo cubre).
- Ownership eager protege contra fugas cross-user.
- Logging estructurado permite debug post-deploy.

### Batch 4 — Refactor de selectores en endpoints existentes

**Objetivo**: extender selectores de Note para incluir `project` en hubs, calendar, search, dashboard.

**Archivos**:

| Archivo | Acción | Detalle |
|---|---|---|
| `app/api/dashboard/route.ts` | Modify | 3 selects de Task → usar `NOTE_SELECT_NEW_WITH_PROJECT` en `note: { select }`. `formatNoteBrief` → añadir `project`. **Sección 6 (resurgenceNote) NO se toca** — sigue con `NOTE_SELECT_WITH_TASK_FLAG` sin project. |
| `app/api/hubs/[domain]/route.ts` | Modify | `select` → `NOTE_SELECT_WITH_TASK_FLAG_PROJECT`. |
| `app/api/notes/route.ts` (solo GET) | Modify | `select` → `NOTE_SELECT_WITH_TASK_FLAG_PROJECT`. (Ya está modificado en Batch 3 para POST con projectId.) |
| `app/api/calendar/route.ts` | Modify | Si usa `NOTE_SELECT_NEW` en `task.note` → `NOTE_SELECT_NEW_WITH_PROJECT`. |
| `app/api/search/route.ts` | Modify | Inline select → añadir `project: { select: PROJECT_BRIEF_SELECT }`. |

**Pre-requisitos**: Batch 3 mergeado (necesita la constante `NOTE_SELECT_NEW_WITH_PROJECT` en `lib/hubs.ts`).

**Validación**:

```bash
pnpm tsc --noEmit
pnpm build

# Verificar manualmente las responses:
curl .../api/dashboard | jq '.data.focusTask.note.project'  # null si la note no tiene proyecto, {id,name,status} si sí.
curl .../api/hubs/proyectos | jq '.[].project'  # similar.
curl .../api/search?q=foo | jq '.results[].note.project'  # opcional.
```

**Riesgo**: medio. El dashboard es la pantalla principal. Mitigaciones:
- Tipos en `lib/types/` para que TS atrape shape mismatch en compile time.
- Smoke en staging con la cuenta real.

### Batch 5 — Frontend: badge de proyecto

**Objetivo**: propagar `project` opcional al badge visual.

**Archivos**:

| Archivo | Acción | Detalle |
|---|---|---|
| `components/ProjectBadge.tsx` | **NUEVO** | Componente presentacional. Props: `project: ProjectBrief \| null`. Si null → no renderiza. Si presente → badge coloreado por status con `aria-label` (ver §3.4). |
| `app/(app)/page.tsx` | Modify | `TaskItem` interface local: + `project?: ...`. Renderizar `<ProjectBadge project={item.note.project} />` en focusTask / todayTasks / maintenanceTasks. |
| `app/(app)/calendar/page.tsx` | Modify | Renderizar ProjectBadge en línea de cada Task del día. |
| `app/(app)/hubs/[domain]/page.tsx` | Modify | Renderizar badge en tarjeta de cada Note. |
| UI de search | Modify | (Si la UI de search tiene componente de resultados) badge en cada result. |

**Pre-requisitos**: Batch 4 mergeado (necesita que las responses devuelvan `project`).

**Validación**:

```bash
pnpm tsc --noEmit
pnpm build
pnpm test:e2e
```

Smoke humano: ver el badge con colores correctos en staging.

**Riesgo**: bajo. Componente aislado. `null` se renderiza como no-badge → comportamiento idéntico al actual si no se asignan proyectos.

### Batch 6 — Tests E2E con factorías

**Objetivo**: tests E2E con factorías extendidas.

**Archivos**:

| Archivo | Acción | Detalle |
|---|---|---|
| `tests/helpers/factories.ts` | Modify | + `createProject(userId, input?)`. Extender `NoteInput` con `projectId?: string \| null`. Extender `createNoteWithTask` para pasar `projectId` al crear la Note. |
| `tests/e2e.spec.ts` | Modify | + 5 tests nuevos (§10 abajo los detalla). |

**Pre-requisitos**: Batches 3, 4, 5 mergeados.

**Validación**:

```bash
pnpm test:e2e
```

**Riesgo**: medio. La factoría se comparte con muchos tests. Si rompe un default, varios tests fallan en cascada. Mitigación: tests existentes usan factorías — factorías tienen valores por defecto razonables.

### Batch 7 — Tests unitarios + smoke manual

**Objetivo**: cubrir funciones puras nuevas y verificar UX manualmente.

**Archivos**:

| Archivo | Acción | Detalle |
|---|---|---|
| `tests/unit/projects.test.ts` | **NUEVO** | `validateTransition` × todas las combinaciones del DAG. `formatProjectItem` y `formatProjectBrief`. `findOwnProjectOrThrow`. |
| `tests/unit/note-validation.test.ts` | **NUEVO** (o extendido) | Validación regex cuid + ownership. |
| `tests/e2e.spec.ts` | Modify | (Ya cubierto en Batch 6 — repetir aquí si quedó alguno.) |

**Smoke manual** (humano, batch separado aunque agrupa aquí para que brain-apply lo tenga claro):

- [ ] Crear proyecto "Test" vía `POST /api/projects`.
- [ ] Asignar Note existente al proyecto vía `PATCH /api/notes/[id]`.
- [ ] Verificar que el dashboard muestra el badge de proyecto en la Task del foco.
- [ ] Transicionar `IDEATION → ACTIVE → MAINTENANCE → ARCHIVED`.
- [ ] Intentar transición inválida (`ARCHIVED → MAINTENANCE`) → 409 con detalles.
- [ ] Revivir `ARCHIVED → ACTIVE`.
- [ ] Borrar proyecto → Note queda huérfana (`GET /api/notes` con `projectId=null`).
- [ ] Buscar la Note huérfana en `/api/search` → sigue encontrable.
- [ ] Verificar embedding pgvector intacto en DB (`SELECT embedding FROM "Note" WHERE id = ?`).

**Pre-requisitos**: Batch 6 mergeado.

**Validación**:

```bash
pnpm test:unit
pnpm test:e2e
# Smoke: ejecutar los 9 pasos de la checklist humana.
```

**Riesgo**: bajo. Tests nuevos, no rompen lo existente.

---

## 10. Tests strategy detallada

### 10.1 Factorías — `tests/helpers/factories.ts`

**Estado actual**:

```ts
export type NoteInput = {
  content?: string
  title?: string | null
  domain?: Domain
  noteStatus?: 'DRAFT' | 'NEEDS_REVIEW' | 'ACTIVE'
  tags?: string[]
  suggestedGoals?: string[]
}

export type TaskInput = {
  status?: 'OPEN' | 'DONE'
  dueDate?: Date | null
  isImportant?: boolean
  focusedAt?: Date | null
  completedAt?: Date | null
}
```

**Extensiones necesarias**:

```ts
// En NoteInput:
projectId?: string | null

// En createNote: leer input.projectId y pasar al create.
// En createNoteWithTask: pasar al tx (vía spread o explícito).

// Nueva función:
export async function createProject(
  userId: string,
  input: {
    name?: string
    description?: string | null
    status?: 'IDEATION' | 'ACTIVE' | 'MAINTENANCE' | 'ARCHIVED'
  } = {}
): Promise<Project> {
  return prisma.project.create({
    data: {
      id: id(),
      userId,
      name: input.name ?? 'Test project',
      description: input.description ?? null,
      status: input.status ?? 'IDEATION',
    },
  })
}
```

**Riesgo bajo**: la factory se llama explícitamente; los tests existentes que no usan Project no se ven afectados.

### 10.2 E2E nuevos — 5 tests mínimos

Cada test usa factorías del §10.1.

#### Test E2E-1: crear proyecto + asignar Note + verificar JOIN en dashboard

**Objetivo**: verificar end-to-end que el badge se muestra en la response del dashboard.

```ts
test('crear proyecto, asignar Note, JOIN en /api/dashboard devuelve project en task.note.project', async () => {
  const user = await createTestUser()
  const project = await createProject(user.id, { name: 'Micro-SaaS X' })
  const note = await createNote(user.id, { content: 'Investigación X' })
  // Asignar vía PATCH /api/notes/[id]
  await api.patch(`/api/notes/${note.id}`, { projectId: project.id }, { user })

  // Crear Task asociada
  const task = await prisma.task.create({
    data: { id: cuid(), userId: user.id, noteId: note.id, status: 'OPEN', dueDate: new Date(), isImportant: false }
  })

  // Fetch dashboard
  const res = await api.get('/api/dashboard', { user })
  expect(res.body.data.todayTasks[0].note.project).toMatchObject({
    id: project.id,
    name: 'Micro-SaaS X',
    status: 'IDEATION',
  })
})
```

#### Test E2E-2: transición inválida → 409 con details

```ts
test('PATCH /api/projects/[id] con transición inválida devuelve 409 y allowedFromCurrent', async () => {
  const user = await createTestUser()
  const project = await createProject(user.id, { status: 'ARCHIVED' })

  const res = await api.patch(
    `/api/projects/${project.id}`,
    { status: 'MAINTENANCE' },
    { user }
  )

  expect(res.status).toBe(409)
  expect(res.body.error.code).toBe('invalidTransition')
  expect(res.body.error.details.allowedFromCurrent).toEqual(['ACTIVE', 'IDEATION'])
})
```

#### Test E2E-3: cadena completa de transiciones válida (incluye revive)

```ts
test('transición completa IDEATION→ACTIVE→MAINTENANCE→ARCHIVED→ACTIVE (revive)', async () => {
  const user = await createTestUser()
  const project = await createProject(user.id, { status: 'IDEATION' })

  for (const status of ['ACTIVE', 'MAINTENANCE', 'ARCHIVED', 'ACTIVE']) {
    const res = await api.patch(`/api/projects/${project.id}`, { status }, { user })
    expect(res.status).toBe(200)
    expect(res.body.data.status).toBe(status)
  }

  // Verificar revive (ARCHIVED→ACTIVE funcionó)
  const final = await api.get(`/api/projects/${project.id}`, { user })
  expect(final.body.data.status).toBe('ACTIVE')
})
```

**Variantes a cubrir en tests adyacentes** (cada transición como test individual pequeño para diagnóstico granular):

- `IDEATION → ACTIVE` 200.
- `IDEATION → ARCHIVED` 200.
- `IDEATION → MAINTENANCE` 409 (no saltes ACTIVE).
- `ACTIVE → MAINTENANCE` 200.
- `ACTIVE → ARCHIVED` 200.
- `ACTIVE → IDEATION` 200 (pivot).
- `MAINTENANCE → ACTIVE` 200.
- `MAINTENANCE → ARCHIVED` 200.
- `MAINTENANCE → IDEATION` 409 (forzar ARCHIVED+revive).
- `ARCHIVED → ACTIVE` 200 (revive).
- `ARCHIVED → IDEATION` 200 (revive como ideation).
- `ARCHIVED → MAINTENANCE` 409.

#### Test E2E-4: delete Project — Note huérfana, Task sobrevive

```ts
test('DELETE /api/projects/[id] deja Note con projectId=null; Task sobrevive apuntando a Note', async () => {
  const user = await createTestUser()
  const project = await createProject(user.id, { name: 'X' })
  const { note, task } = await createNoteWithTask(user.id, {
    content: 'Investigación',
    domain: 'PROYECTOS',
  })

  // Asignar Note a Project
  await prisma.note.update({ where: { id: note.id }, data: { projectId: project.id } })

  // Borrar Project
  const res = await api.delete(`/api/projects/${project.id}`, { user })
  expect(res.status).toBe(204)

  // Verificar Note huérfana
  const orphan = await prisma.note.findUnique({ where: { id: note.id } })
  expect(orphan?.projectId).toBeNull()

  // Verificar Task sobrevive
  const survivingTask = await prisma.task.findUnique({ where: { id: task.id } })
  expect(survivingTask).not.toBeNull()
  expect(survivingTask?.noteId).toBe(note.id)
})
```

#### Test E2E-5: NoteRelationship + embedding persisten tras delete Project

```ts
test('DELETE /api/projects/[id] mantiene NoteRelationship y embedding de Notes huérfanas', async () => {
  const user = await createTestUser()
  const project = await createProject(user.id, { name: 'X' })
  const noteA = await createNote(user.id, { content: 'A', domain: 'PROYECTOS' })
  const noteB = await createNote(user.id, { content: 'B', domain: 'PERSONAL' })

  // Asignar ambas a project
  await prisma.note.update({ where: { id: noteA.id }, data: { projectId: project.id } })
  await prisma.note.update({ where: { id: noteB.id }, data: { projectId: project.id } })

  // Crear embedding en noteA
  const embedding = Array(1536).fill(0).map((_, i) => (i % 100) / 100)
  await prisma.$executeRawUnsafe(
    `UPDATE "Note" SET embedding = $1::vector WHERE id = $2`,
    `[${embedding.join(',')}]`,
    noteA.id
  )

  // Crear NoteRelationship A→B
  await prisma.noteRelationship.create({
    data: { id: cuid(), sourceNoteId: noteA.id, targetNoteId: noteB.id, type: 'RELATED', userId: user.id },
  })

  // Borrar Project
  await api.delete(`/api/projects/${project.id}`, { user })

  // Verificar
  const orphanA = await prisma.note.findUnique({ where: { id: noteA.id } })
  expect(orphanA?.projectId).toBeNull()

  // Embedding intacto
  const result = await prisma.$queryRawUnsafe<{embedding: number[]}[]>(
    `SELECT embedding FROM "Note" WHERE id = $1`,
    noteA.id
  )
  expect(result[0].embedding).toHaveLength(1536)

  // NoteRelationship intacta
  const rel = await prisma.noteRelationship.findFirst({
    where: { sourceNoteId: noteA.id, targetNoteId: noteB.id },
  })
  expect(rel).not.toBeNull()
})
```

### 10.3 Unit tests — `tests/unit/projects.test.ts` NUEVO

#### Cobertura de `validateTransition`

Matriz completa de combinaciones (4 × 4 = 16 transiciones, más self = 20):

| from \\ to | IDEATION | ACTIVE | MAINTENANCE | ARCHIVED |
|---|---|---|---|---|
| IDEATION    | self (ok) | ok | err | ok |
| ACTIVE      | ok | self (ok) | ok | ok |
| MAINTENANCE | err | ok | self (ok) | ok |
| ARCHIVED    | ok | ok | err | self (ok) |

**Cada celda es un test case individual** (16 + 4 self = 20 tests). Naming: `validateTransition(IDEATION, MAINTENANCE) returns invalid with allowedFromCurrent=['ACTIVE','ARCHIVED']`.

**Cobertura extra**:

```ts
describe('validateTransition edge cases', () => {
  test('self-transition (ACTIVE→ACTIVE) is idempotent', () => {
    expect(validateTransition('ACTIVE', 'ACTIVE')).toEqual({ ok: true })
  })

  test('invalid transition includes allowedFromCurrent in details', () => {
    const r = validateTransition('ARCHIVED', 'MAINTENANCE')
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.from).toBe('ARCHIVED')
      expect(r.attempted).toBe('MAINTENANCE')
      expect(r.allowedFromCurrent).toEqual(['ACTIVE', 'IDEATION'])
    }
  })

  test('unknown status throws', () => {
    // @ts-expect-error testing runtime guard
    expect(() => validateTransition('FOO', 'ACTIVE')).toThrow()
  })
})
```

#### Cobertura de mappers

```ts
describe('formatProjectItem', () => {
  test('full Project → ProjectItem (ISO dates)', () => {
    const proj = { id, userId, name, description, status: 'ACTIVE', createdAt: new Date('2026-01-01'), updatedAt: new Date('2026-01-02') }
    const item = formatProjectItem(proj)
    expect(item.createdAt).toBe('2026-01-01T00:00:00.000Z')
    expect(item.status).toBe('ACTIVE')
  })
})

describe('formatProjectBrief', () => {
  test('null → null (no crash)', () => {
    expect(formatProjectBrief(null)).toBeNull()
  })

  test('Project → only { id, name, status }', () => {
    expect(formatProjectBrief({ id: 'a', name: 'X', status: 'ACTIVE' })).toEqual({ id: 'a', name: 'X', status: 'ACTIVE' })
  })
})
```

#### Cobertura de ownership helper

```ts
describe('findOwnProjectOrThrow', () => {
  test('valid + owned → returns project', async () => { /* ... */ })
  test('valid cuid but not found → throws InvalidProjectIdError(not_found)', async () => { /* ... */ })
  test('valid + owned by other user → throws InvalidProjectIdError(forbidden)', async () => { /* ... */ })
  test('regex invalid → throws InvalidProjectIdError(format)', async () => { /* ... */ })
})
```

### 10.4 Tests de API (unit sobre route handlers)

Tests rápidos de las 4 routes nuevas usando `next-test-api-route-handler` o equivalente (verificar qué se usa en el repo; si no, mock simple de NextResponse).

Mínimo:

- `POST /api/projects` con body vacío → 400 `invalid_name`.
- `POST /api/projects` con `name: 'Test'` → 201 ProjectItem.
- `POST /api/projects` con `name: '   '` (whitespace) → 400 `invalid_name`.
- `POST /api/projects` con `status` no válido → 400 `invalid_status`.
- `GET /api/projects` sin auth → 401.
- `GET /api/projects/[id]` con id de otro user → 404.
- `PATCH /api/projects/[id]` con status inválido → 409 con details.
- `PATCH /api/projects/[id]` con `{name}` solo → 200 sin tocar status.
- `DELETE /api/projects/[id]` Project no existente → 404.
- `DELETE /api/projects/[id]` Project existente → 204.

### 10.5 Snapshot tests (decidir si worth it)

**Decisión**: NO snapshot tests en este batch. Razón:

- Las responses son JSON simples (`ProjectItem`, `ProjectBrief`).
- Las transiciones de status no tienen shape variable.
- Añadir snapshot maintenance overhead sin valor claro.

Si en una fase futura el dashboard cambia mucho, considerar snapshot del endpoint `/api/dashboard` (Phase 2 sí lo hizo, pero su `DashboardResponse` es más complejo). En Project Engine, **no necesario**.

---

## 11. Plan de rollback

### 11.1 Pre-deploy

1. **Snapshot de DB Supabase** (branch pre-deploy):

   ```bash
   # Crear branch de Supabase pre-migration
   supabase branches create pre-projects-engine-$(date +%Y%m%d)
   ```

2. **Export defensivo** (no debería perderse nada porque la migration es aditiva, pero por si):

   ```bash
   # Exportar schema actual (no los datos, son personales)
   pnpm prisma db pull
   ```

3. **Tag del deploy**:

   ```bash
   git tag -a pre-projects-engine -m "Snapshot pre-Phase 3 deploy"
   ```

### 11.2 Rollback de DB (si la migration falla o hay bug crítico)

```bash
# Opción A: Supabase branch restore
supabase branches restore pre-projects-engine

# Opción B: Manual
psql $DATABASE_URL <<EOF
DROP TABLE IF EXISTS "Project" CASCADE;
ALTER TABLE "Note" DROP COLUMN IF EXISTS "projectId" CASCADE;
DROP INDEX IF EXISTS "Note_projectId_noteStatus_idx";
DROP INDEX IF EXISTS "Project_userId_status_idx";
DROP INDEX IF EXISTS "Project_userId_updatedAt_idx";
DROP TYPE IF EXISTS "ProjectStatus";
EOF
```

**Datos que se pierden**:

- Projects creados en producción entre el deploy y el rollback.
- Assignments de projectId en Notes (projectId → null).
- **NO** se pierden Notes, Tasks, embeddings, NoteRelationships.
- **NO** se pierden las Notes huérfanas (Project no existe → huérfanas siempre, indistinguible).

**Riesgo aceptable**: el deploy es atómico y la migration aditiva. La ventana de pérdida es ~minutos.

### 11.3 Rollback de app (si los endpoints nuevos fallan)

```bash
# Revertir el último commit en main
git revert HEAD
git push
# Vercel redeploy automático
```

**Problema crítico**: si el revert se hace pero la DB ya está en estado
nuevo (tabla `Project` existe), la app vieja **no usa la tabla pero la DB
la tiene huérfana**. No rompe nada funcional (la app vieja simplemente la
ignora), pero deja basura.

**Solución**: rollback DB primero, app después. Orden estricto: DB → app.

### 11.4 Rollback de ownership check (cambio de comportamiento)

Si el ownership check añadiera latencia o bugs, **se puede quitar** sin rollback completo. Editar `app/api/notes/route.ts` y `app/api/notes/[id]/route.ts` para borrar el `findUnique` previo. Nuevo commit + redeploy. **No requiere migration**.

### 11.5 Comunicación con usuario

Si rollback es necesario, **avisar a Ezequiel** (único usuario). Indicar:

- Qué se perdió (Projects creados en la ventana).
- Por qué se hizo rollback.
- Plan de re-deploy.

---

## 12. Definition of Done

### 12.1 Checklist binario ejecutable

```bash
# 1. Tipos
pnpm tsc --noEmit && echo "✓ tsc OK"

# 2. Schema estable y formateado
pnpm prisma format && echo "✓ schema formatted"
pnpm prisma generate && echo "✓ prisma client generated"

# 3. Migración aplicada localmente
pnpm prisma migrate dev --name add_project 2>&1 | grep -q "No migration needed\|already" || echo "✓ migration applied"

# 4. Tests unitarios
pnpm test:unit && echo "✓ unit tests pass"

# 5. Tests E2E
pnpm test:e2e && echo "✓ e2e tests pass"

# 6. Build
pnpm build && echo "✓ next build clean"

# 7. D4 cumplido: NUNCA Task.projectId
! grep -rE "task\.projectId|Task\.projectId" app/ lib/ --include="*.ts" --include="*.tsx" && echo "✓ D4 held"

# 8. Path canónico /api/dashboard (no /api/today)
! grep -rE "/api/today\b" app/ components/ lib/ --include="*.ts" --include="*.tsx" && echo "✓ path canonical"

# 9. Sin /api/projects/[id] que devuelva 4xx sin respuesta ApiError
grep -rE "NextResponse\.json.*status:\s*[4][0-9]{2}" app/api/projects/ --include="*.ts" | grep -v "ok: false" && echo "✗ endpoint devuelve 4xx sin ApiError shape" || echo "✓ sin 4xx sin ApiError"

# 10. Constante PROJECT_TRANSITIONS presente y usada
grep -rE "PROJECT_TRANSITIONS\[" app/ lib/ --include="*.ts" && echo "✓ transitions used"
```

### 12.2 Checklist funcional humano (staging)

9 puntos derivados del Batch 7 del spec:

- [ ] **1. Crear proyecto "Test"** vía `POST /api/projects` con `name`. → 201 con `ProjectItem`.
- [ ] **2. Asignar Note existente** al proyecto vía `PATCH /api/notes/[id]` con `projectId`. → 200 con Note actualizada.
- [ ] **3. Verificar badge de proyecto** en el dashboard en la Task del foco (`/api/dashboard` devuelve `note.project: {id, name, status}`).
- [ ] **4. Transicionar** `IDEATION → ACTIVE → MAINTENANCE → ARCHIVED`. Cada paso → 200.
- [ ] **5. Transición inválida** `ARCHIVED → MAINTENANCE`. → 409 con `code: 'invalidTransition'` y `allowedFromCurrent: ['ACTIVE', 'IDEATION']`.
- [ ] **6. Revivir** `ARCHIVED → ACTIVE`. → 200, project.status = ACTIVE.
- [ ] **7. Borrar proyecto**. → 204. Verificar en DB que `Note.projectId = null` y que la Task sigue apuntando a la Note (`task.noteId` no cambia).
- [ ] **8. Buscar Note huérfana en /api/search**. → aparece (embedding + NoteRelationship intactos).
- [ ] **9. Verificar embedding pgvector intacto**: `SELECT embedding FROM "Note" WHERE id = ?` devuelve vector de 1536 dimensiones.

### 12.3 Checklist de cobertura de tests

- [ ] `validateTransition` 20/20 combinaciones cubiertas (unit).
- [ ] `formatProjectItem` y `formatProjectBrief` cubiertos (unit).
- [ ] `findOwnProjectOrThrow` 4 casos (format, not_found, forbidden, happy) (unit).
- [ ] 5 E2E nuevos del §10.2: E2E-1, E2E-2, E2E-3, E2E-4, E2E-5.
- [ ] Tests E2E existentes (focusTask, etc.) siguen verdes tras el cambio del select.

---

## 13. Riesgos residuales

Top 5 riesgos tras refinar el análisis del deep-think y del explore.

| # | Riesgo | Severidad | Mitigación |
|---|---|---|---|
| 1 | **Validación de transición de status en app layer** (no en DB). Un bug futuro podría saltarse la validación si se añade un nuevo path de update que olvide llamar `validateTransition`. | P1 | Test E2E E2E-2 cubre el caso conocido. Test unit `validateTransition` cubre la función. **Mitigación futura**: en una próxima iteración, considerar trigger Postgres (`BEFORE UPDATE` cuando `OLD.status <> NEW.status`). Documentado como out-of-scope hoy (spec §8). |
| 2 | **Refactor de selectores rompe tests E2E con shape exacto**. El cambio de `NOTE_SELECT_NEW` a `NOTE_SELECT_NEW_WITH_PROJECT` añade un campo nuevo en la response. Tests que asuman shape exacto (e.g. `toEqual({ ... })`) fallarían. | P1 | grep en `tests/e2e.spec.ts` antes del merge por `toEqual` o `toMatchObject` sobre items de dashboard. Revisar si hay tests con deep equality. Si los hay, actualizar manualmente. |
| 3 | **`prisma migrate dev` genera SQL no esperado**. Podría añadir/dropear columnas por sorpresa si el schema tiene drift respecto a la DB local. | P2 | Antes de mergear la migration, revisar el SQL generado línea por línea. Comparar con el spec §5. Si hay DROP COLUMN, abortar y reescribir. |
| 4 | **Ownership check añade 1 query por write** (POST/PATCH de Note con projectId). En POST que ya tiene su propia escritura + INSERT de Note, son 2 queries en vez de 1. Aceptable en single-user pero no infinito. | P2 | Documentar el trade-off. Si en el futuro la latencia importa (>50ms p95), considerar reemplazar con cache en memoria o denormalizar `Note.userId` y validarlo en una sola query con JOIN. Hoy no aplica. |
| 5 | **Note huérfana sin badge pierde visibilidad**. Si el usuario borra un proyecto y luego ve la Note en `/api/notes` (lista), ya no aparece el badge. La Note está, pero la relación visual "esto era de X" se pierde. | P2 | Documentar. Añadir en una fase futura un historial de "esta Note pertenecía a X" si el usuario lo pide. No bloquea MVP. |

### 13.1 Riesgos NO residuales (descartados por diseño)

- **Pérdida de NoteKnowledge al borrar Project**: NO. `SetNull` salvaguarda.
- **Pérdida de embedding al borrar Project**: NO. Embedding es del contenido.
- **Pérdida de NoteRelationship al borrar Project**: NO. Las relaciones son Note↔Note.
- **Race condition en transición**: **Eliminada por diseño.** PATCH de Project usa CAS (WHERE id AND status = from) con `prisma.project.updateMany`. Si dos requests compiten, la segunda ve `updated.count === 0` y devuelve 409 con details del status actual.
- **Multi-tenant leak via projectId**: cubierto por ownership check.

---

## 14. Out of scope

Lista explícita de lo que **NO** se hace en este batch. Para evitar scope creep y para que la siguiente fase (`brain-tasks`) no las añada por error.

1. **UI dedicada de Projects** (lista, detalle, gestión). YAGNI — el badge basta para MVP (D7).
2. **Endpoint `/api/projects/[id]/dashboard`** (vista por proyecto). YAGNI — ver §3.5 de Phase 2 deep-think.
3. **Filtro `?projectId=` en `/api/dashboard`**. D3 — el dashboard es global por diseño.
4. **Vista de "proyectos recientes" en sidebar**. YAGNI — se puede derivar de `updatedAt` cuando se pida.
5. **Stats/contadores UI** de proyectos. YAGNI.
6. **Recurrencia de Projects** (e.g. templates, clones). No aplica a single-user.
7. **Soft-delete de Project** (D6). `status = ARCHIVED` cubre.
8. **Multi-tenant / RLS**. Single-user; `userId` es decorativo (D5).
9. **Trigger de Postgres para validar transiciones**. Sobre-ingeniería en single-user. Documentado como future work.
10. **Snapshot tests de contratos API**. Bajo valor para este batch (responses simples).
11. **i18n / traducciones del badge**. MVP en español. Si se añade i18n, se cubren los strings.
12. **Editor de Project (CRUD UI)**. El badge es solo lectura en MVP.
13. **Drag-and-drop Note → Project en UI**. La asignación es por NotePanel (PATCH /api/notes/[id] con `projectId`). Drag-and-drop es nice-to-have.
14. **Permisos por proyecto** (compartir con otros). Multi-tenant out of scope.
15. **Endpoint dedicado `/api/projects/[id]/transition`** separado del PATCH. Se hace vía PATCH con `status` (decisión §4.4).
16. **Historial de transiciones** (`ProjectHistory` table). `updatedAt` es suficiente para "cuándo fue la última transición". Auditar cada transición con tabla es YAGNI.
17. **Soft-delete de Project con `deletedAt`**. D6.

---

## 15. Result Contract

```
## Result Contract
- Fase: brain-design (Fase 3)
- Status: done
- Artefacto: docs/sdd/active/projects-engine/design.md
- Insumos consumidos:
  - docs/sdd/active/projects-engine/deep-think.md (Fase 0 — D1–D7)
  - docs/sdd/active/projects-engine/explore.md (Fase 1 — blast radius, R-A..R-E, validación contra código real)
  - docs/sdd/active/projects-engine/spec.md (Fase 2 — schema, migration, endpoints, plan)
  - docs/sdd/completed/refactor-note-task-split/design.md (Phase 2 — referencia de estilo y tono)
  - prisma/schema.prisma, lib/hubs.ts, app/api/dashboard/route.ts, tests/helpers/factories.ts (snapshot de código actual para validación)
- Insumos producidos para la siguiente fase (brain-tasks):
  1. Validación arquitectónica de las 6 secciones del spec — todas sostenidas ✅, con 4 ajustes menores documentados (alias de selectores, comentarios sobre huérfanos, ownership eager vs lazy, transition validation con allowedFromCurrent).
  2. Diagrama ASCII por capas (UI / API / lib / Prisma) con flujo end-to-end del badge.
  3. Diseño de UI (badge con colores por status, A11y, dónde se renderiza, qué NO se hace).
  4. Diseño de API:
     - lib/projects.ts NUEVO con PROJECT_TRANSITIONS, validateTransition, mappers, helper de ownership
     - lib/types/project.ts NUEVO con ProjectItem, ProjectBrief, ProjectDetail, inputs, errores tipados
     - Validación de projectId (regex cuid + ownership eager)
     - Selectores nuevos (PROJECT_BRIEF_SELECT, NOTE_SELECT_WITH_PROJECT, NOTE_SELECT_WITH_TASK_FLAG_PROJECT)
     - Endpoints: POST/GET /api/projects, GET/PATCH/DELETE /api/projects/[id]
     - Modificaciones: formatNoteBrief, app/api/dashboard, hubs, calendar, search, notes POST/PATCH
  5. Tabla de errores por endpoint con códigos estructurados (invalidTransition con details, invalid_projectId_format/not_found/forbidden).
  6. Observabilidad: 7 eventos con nombre + nivel + contexto, formato JSON-line para Vercel Log Drains, sin librería externa.
  7. Métricas futuras (4) documentadas pero no implementadas.
  8. Rate limiting (5 endpoints): tabla de límites + reutilización de lib/rate-limit.ts (Phase 2).
  9. Plan refinado de 7 batches con archivos exactos, validaciones, dependencias.
  10. Tests strategy detallada:
      - Factorías: extension de NoteInput con projectId + createProject nuevo
      - 5 E2E mínimos (crear+asignar+JOIN, transición inválida 409, cadena completa con revive, delete+huérfana, embeddings/relationships persisten)
      - Unit NUEVO tests/unit/projects.test.ts: validateTransition 20/20 combinaciones + formatX + findOwnProjectOrThrow 4 casos
      - 9 checklist funcional humana
  11. Plan de rollback: snapshot Supabase pre-deploy + orden DB→app + datos que se pierden documentados.
  12. Definition of Done binaria (10 checks bash) + funcional humana (9 pasos) + cobertura (3 grupos).
  13. 5 riesgos residuales priorizados con mitigación concreta.
  14. Out of scope con 17 puntos para evitar scope creep.
- Próxima fase: brain-tasks (atomización en tareas con dependencias, asignables a brain-apply).
- Decisiones que requieren input del usuario:
  - Ninguna. D1–D7 + D4-usuario se sostienen. Las 4 micro-ajustes son refinamientos sin reabrir decisiones.
  - Si el usuario quiere cambiar el nombre del selector base (`NOTE_SELECT_WITH_PROJECT` vs alias `NOTE_SELECT_NEW_WITH_PROJECT` como pide la spec) → resolver en brain-tasks con el implementador. No bloquea.
- Riesgos top para el orchestrator:
  - **P1** Validación de transición en app layer (no en DB) → E2E + unit explícitos son la red de seguridad.
  - **P1** Refactor de selectores puede romper tests E2E con shape exacto → grep previo + actualizar manualmente si aplica.
  - **P2** Migration aditiva pero `prisma migrate dev` puede generar SQL no esperado → revisión manual del SQL antes de mergear.
  - **P2** Ownership check añade 1 query por write → aceptable en single-user, documentado.
  - **P2** Note huérfana pierde visibilidad de "antes era de X" → documentado, no bloquea.
```
