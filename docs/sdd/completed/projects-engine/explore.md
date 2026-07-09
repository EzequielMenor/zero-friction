# Explore: Project Engine (Phase 3)

> Fase 1 del pipeline brain-team. Validación del esbozo contra código real.
> Artefacto de entrada para brain-spec (Phase 2).
> No contiene código final — solo exploración y mapeo.

---

## 1. Verificación del schema actual

### Modelos existentes en `prisma/schema.prisma`

| Modelo | Estado | Notas |
|--------|--------|-------|
| `Project` | **❌ No existe** | No se menciona en ningún lado |
| `Note` | ✅ Existe | `task: Task?` (1:1 opcional), sin cascade explícito (default Prisma = SetNull para 1:1 optional) |
| `Task` | ✅ Existe | `noteId String @unique` + `note Note @relation(fields: [noteId], references: [id], onDelete: Cascade)` |
| `NoteRelationship` | ✅ Existe | `sourceNoteId` + `targetNoteId`, `@@unique([sourceNoteId, targetNoteId])` |

### P0 — `Task.noteId` NOT NULL (RESOLUCIÓN CRÍTICA)

**Sí, `Task.noteId` es NOT NULL.** En `schema.prisma` línea 84:
```prisma
noteId String @unique
```
Sin `?` → Prisma genera `NOT NULL`. Confirmado en migration SQL línea 11:
```sql
"noteId" TEXT NOT NULL,
```

**Implicación para D4**: Task SIEMPRE tiene Note. D4 (denormalizar `Task.projectId`) puede reconsiderarse: derivar `project` vía JOIN (`Task → Note → Project`) en vez de almacenar `Task.projectId`. Esto elimina el riesgo de desincronización P1 del deep-think. Ver §4 D4 para el análisis completo.

### Cascade actual Note ↔ Task

- `Task.note` → `@relation(fields: [noteId], references: [id], onDelete: Cascade)` — borrar Note → Task borrada en cascade.
- `Note.task` (1:1 opcional, lado inverso) — sin `onDelete` explícito, default Prisma = `SetNull`. Borrar Task → `Note.taskId` pasa a `null` (la Note sobrevive sin Task asociada).

### Enumeraciones completas en el schema

| ENUM | Valores | Mencionado en deep-think? |
|------|---------|---------------------------|
| `Domain` | `ESPIRITUAL, PERSONAL, APRENDIZAJE, PROYECTOS, REGISTROS` | ❌ No |
| `NoteStatus` | `DRAFT, NEEDS_REVIEW, ACTIVE, IN_PROGRESS, DONE` | ❌ (legacy, se dropea en Migration B) |
| `NoteStatusNew` | `DRAFT, NEEDS_REVIEW, ACTIVE` | ✅ |
| `TaskStatus` | `OPEN, DONE` | ✅ |
| `NoteRelationshipType` | `RELATED, SUPPORTS, CONTRADICTS, EXAMPLE_OF, CONTINUES, RELATED_PROJECT, REFERENCES` | ❌ No |

### pgvector y Note.embedding

- `Note.embedding` → `Unsupported("vector(1536)")?` — línea 72 de `schema.prisma`.
- pgvector extension activa desde `prisma/migrations/001_initial/migration.sql`.
- Añadir `projectId` a Note es una columna regular — no afecta el pipeline de embeddings. Las queries `$executeRaw` que escriben `embedding` (`lib/parse-capture.ts:305`, `lib/legacy/enrich-draft-note.ts:34`) no referencian `projectId`.

### ¿Project existe en comentarios o strings?

Grep por `Project` (case-sensitive) en `.ts` y `.tsx`: **0 resultados** excepto referencias al domain enum `PROYECTOS` y documentación. Grep por `projectId`: **0 resultados**. El modelo no existe, ni como string.

---

## 2. Mapeo del endpoint `/api/dashboard`

### Archivo: `app/api/dashboard/route.ts`

**Método**: `GET` (línea 10).

**6 secciones implementadas** (queries reales, líneas 27-133):

| Sección | Query | Líneas |
|---------|-------|--------|
| `focusTask` | `prisma.task.findFirst({ where: { userId, focusedAt: { not: null } }, select: {...} })` | 35-44 |
| `todayTasks` | `prisma.task.findMany({ where: { userId, status: 'OPEN', dueDate: { gte: startOfToday, lt: startOfTomorrow } }, orderBy: [{ isImportant: 'desc' }, { createdAt: 'asc' }] })` | 47-60 |
| `maintenanceTasks` | `prisma.task.findMany({ where: { userId, status: 'OPEN', dueDate: null }, orderBy: [{ createdAt: 'desc' }] })` | 63-76 |
| `habits` | `prisma.habit.findMany({ where: { userId } })` | 79-82 |
| `dueSubscription` | Subscriptions donde `dayOfMonth = today`, batch-check de transactions existentes | 85-104 |
| `resurgenceNote` | Note ACTIVE, domain ESPIRITUAL\|PERSONAL, createdAt < 180d, random offset | 107-132 |

### Queries exactas de las 3 secciones Task (`focusTask`, `todayTasks`, `maintenanceTasks`)

Todas usan el mismo `select` inline (no `TASK_SELECT` del hubs.ts):
```ts
select: {
  id: true, noteId: true, userId: true, status: true,
  dueDate: true, isImportant: true, focusedAt: true,
  completedAt: true, createdAt: true, updatedAt: true,
  note: { select: NOTE_SELECT_NEW },
}
```
Donde `NOTE_SELECT_NEW` es el selector de `lib/hubs.ts:30-41`: `{ id, userId, title, content, domain, tags, suggestedGoals, noteStatus, createdAt, updatedAt }`.

### `lib/hubs.ts` — selectores compartidos

| Selector | Uso | Líneas |
|----------|-----|--------|
| `NOTE_SELECT_NEW` | Dashboard (via note in Task), search, hubs | 30-41 |
| `NOTE_SELECT_WITH_TASK_FLAG` | Notes list + `hasTask` flag (incluye `task: { select: { id: true } }`) | 44-56 |
| `TASK_SELECT` | API routes (notes POST, tasks PATCH, calendar) | 59-70 |
| `NOTE_SELECT_WITH_TASK` | (Definido pero no usado en dashboard — es para uso futuro) | 73-76 |

### `lib/types/` — tipos compartidos

| Archivo | Contenido |
|---------|-----------|
| `lib/types/note.ts` | `NoteItem`, `NoteDraft`, `NoteWithTask`, `SearchResultItem` |
| `lib/types/task.ts` | `TaskItem`, `TaskWithNote`, `TaskDraft` |
| `lib/types/api.ts` | `ApiSuccess<T>`, `ApiError`, `ApiResponse<T>` |
| `lib/types/capture.ts` | `CaptureInput`, `ParsedCapture` |

**NO existe `lib/types/dashboard.ts`** — los tipos del dashboard (`TodayItem`, `TaskItem`, `DashboardData`, etc.) están definidos **inline** en `app/(app)/page.tsx:12-70`.

### Dependencia con Project

**Confirmado: ninguna.** Las queries solo filtran por `userId`, `status`, `dueDate`, `focusedAt`. No hay mención de `projectId` ni JOIN a Project. El campo `project` se añadirá como metadata adicional sin cambiar la lógica de filtrado.

---

## 3. Blast radius — archivos afectados

### Archivos a modificar (ordenados por capa)

#### A. Schema y migrations

| Archivo | Qué se toca | Tests asociados |
|---------|------------|-----------------|
| `prisma/schema.prisma` | Añadir `model Project {}` + enum `ProjectStatus` + campo `projectId String?` en Note y Task + índices compuestos | Ninguno (no se testea el schema) |
| `prisma/migrations/` | Nueva migration aditiva (CREATE TABLE Project, ALTER TABLE ADD projectId, CREATE INDEXES) | Ninguno |

#### B. API routes (back-end)

| Archivo | Qué se toca | Tests asociados |
|---------|------------|-----------------|
| `app/api/dashboard/route.ts` | Añadir `project: { id, name, status } \| null` a `formatTaskItem` (+ `include` en las 3 queries Task) | `tests/e2e.spec.ts:509-515` (checks `body.data.focusTask`) |
| `app/api/notes/route.ts` | Aceptar `projectId` opcional en POST structured + pasarlo a `prisma.note.create` | `tests/e2e.spec.ts` (creación indirecta) |
| `app/api/notes/[id]/route.ts` | Aceptar `projectId` opcional en PATCH (body) + pasarlo a `prisma.note.update` | `tests/e2e.spec.ts` (PATCH indirecto vía NotePanel) |
| `app/api/tasks/[id]/route.ts` | Aceptar `projectId` opcional en PATCH (body) + pasarlo a `prisma.task.update` | `tests/e2e.spec.ts:267-312` (focus test usa PATCH?) — no, focus usa endpoints separados |
| `app/api/notes/[id]/accept-goal/route.ts` | Al crear Task en accept-goal, heredar `projectId` de la Note si D4 se mantiene | `tests/e2e.spec.ts:367-436` (accept-goal tests) |

#### C. Tipos compartidos

| Archivo | Qué se toca |
|---------|------------|
| `lib/types/note.ts` | Añadir `projectId?: string` a `NoteItem` |
| `lib/types/task.ts` | Añadir `project?: ProjectBrief \| null` a `TaskItem` (o `TaskWithNote`) |
| **Nuevo:** `lib/types/project.ts` | Crear `ProjectItem`, `ProjectBrief` (id, name, status) |

#### D. Selectores

| Archivo | Qué se toca |
|---------|------------|
| `lib/hubs.ts` | Añadir `projectId` a `NOTE_SELECT_NEW` + nuevo selector `PROJECT_SELECT` + nuevo `TASK_SELECT_WITH_PROJECT` |

#### E. Frontend

| Archivo | Qué se toca |
|---------|------------|
| `app/(app)/page.tsx` | Añadir `project?: ...` a `TaskItem` inline + mostrar badge de proyecto en focusTask/todayTasks/maintenanceTasks |

#### F. Tests

| Archivo | Qué se toca |
|---------|------------|
| `tests/helpers/factories.ts` | Añadir `createProject()` factory + extender `NoteInput`/`TaskInput` con `projectId` |
| `tests/e2e.spec.ts` | Añadir tests: crear proyecto, asignar Note/Task, archivar, borrar, validar huérfanos |

### Queries `findMany` sin `projectId` (no rompen, hay que conocerlas)

Todas las queries `prisma.note.findMany` y `prisma.task.findMany` existentes usan `select` explícito, no hay `SELECT *` salvo en el backfill script. La nueva columna `projectId` nullable no rompe nada porque:

1. Todas usan `select` explícito — Prisma solo devuelve los campos seleccionados.
2. Los tipos de respuesta son interfaces estructurales (TypeScript) — campo extra opcional es compatible.
3. Las queries que no incluyan `projectId` en su `select` simplemente no devuelven el campo.

Lista completa de endpoints con `findMany` sobre Note/Task:

| Endpoint | Archivo | Select usado |
|----------|---------|-------------|
| `GET /api/hubs/[domain]` | `app/api/hubs/[domain]/route.ts:28` | `NOTE_SELECT_WITH_TASK_FLAG` |
| `GET /api/notes` | `app/api/notes/route.ts:180` | `NOTE_SELECT_WITH_TASK_FLAG` |
| `GET /api/search` | `app/api/search/route.ts:15` | Inline (explícito) |
| `GET /api/graph` | `app/api/graph/route.ts:18` | Inline (solo id, title, domain) |
| `GET /api/calendar` | `app/api/calendar/route.ts:19` | `TASK_SELECT` + `NOTE_SELECT_NEW` |

### Frontend — `DashboardData` e interfaces inline

En `app/(app)/page.tsx:12-70`, las interfaces `TaskItem`, `TodayItem`, `DashboardData` están definidas inline. No hay un tipo `TodayResponse` compartido. Esto significa que cualquier cambio en la respuesta del dashboard requiere actualizar estas interfaces locales. **Riesgo bajo** porque TypeScript es estructural — campos extra opcionales no rompen.

---

## 4. Validación punto-por-punto de D1-D7

### D1 — `ProjectStatus = [IDEATION, ACTIVE, MAINTENANCE, ARCHIVED]`

**Confirmado: no hay código que asuma otros valores.** No existe ningún ENUM de status de proyecto (Project no existe). Los ENUMs existentes (`NoteStatusNew`, `TaskStatus`, `Domain`, `NoteRelationshipType`) no se solapan con los valores propuestos. El único ENUM con valores similares es `NoteStatusNew` (DRAFT/NEEDS_REVIEW/ACTIVE) — no hay conflicto semántico porque son dominios distintos (estado de Note vs estado de Proyecto).

**Veredicto**: ✅ Se sostiene. Sin objeciones del código real.

### D2 — `Note.projectId onDelete: SetNull` + `Task.projectId onDelete: Cascade`

**Confirmado: no hay lógica de borrado de Project** (no existe). El cascade actual Note↔Task (`onDelete: Cascade` en Task → Note) es independiente. No hay tests que asuman comportamiento de cascade distinto.

La consistencia con el modelo actual:
- `Transaction.subscriptionId` → `onDelete: SetNull` ✅ (patrón de referencia opcional que sobrevive)
- `Transaction.accountId` → `onDelete: SetNull` ✅ (mismo patrón)
- NoteRelationship no tiene `projectId` — no se toca ✅

**Veredicto**: ✅ Se sostiene. Coherente con patrones existentes (SetNull para referencias opcionales).

### D3 — `/api/dashboard` global sin filtro

**Confirmado: la UI actual no pide filtrar por proyecto.** El NavMenu (`components/NavMenu.tsx`) solo navega a hubs (dominios), calendario, settings, mente. No hay navegación por proyecto. El dashboard se renderiza como una vista única de "hoy".

**Veredicto**: ✅ Se sostiene. Sin objeciones.

### D4 — `Task.projectId` denormalizado (REABRIR EN SPEC)

**P0 resuelto: `Task.noteId` es NOT NULL** (String @unique, sin `?`). Task SIEMPRE tiene Note.

**Esto cambia la ecuación de D4.** Si Task siempre tiene Note, podemos derivar `Task.projectId` vía JOIN (`prisma.task.findMany({ include: { note: { include: { project: true } } } })`) en vez de almacenarlo denormalizado.

**Análisis pro/con con código real:**

| Opción | Pro | Con |
|--------|-----|-----|
| **A: Denormalizar** (D4 original) | Dashboard puede obtener project sin JOIN extra a Note | Riesgo P1 de desincronización (hay que actualizar Task.projectId cada vez que cambia Note.projectId) |
| **B: Derivar vía JOIN** | Sin desincronización, modelo más simple, Task no se toca | Dashboard requiere 1 JOIN extra (Task→Note→Project) — con single-user y cientos de Tasks, coste despreciable |

**Evidencia del código real**:
- Las 3 queries Task del dashboard ya hacen `include: { note: { select: NOTE_SELECT_NEW } }`. Añadir `.project` a ese include es trivial.
- El `formatTaskItem` recibe el objeto `task` con `note` anidado (aunque `formatTaskItem` no lo usa actualmente — el note lo procesa `formatNoteBrief`).
- No hay ningún endpoint que actualice `Task.projectId` actualmente (no existe).

**Propuesta para spec**: NO denormalizar `Task.projectId`. Derivar vía `Task → Note → Project`. Esto elimina:
- El riesgo P1 de desincronización.
- La necesidad del service atómico.
- La migración de añadir columna a Task.

**Veredicto**: 🔄 **REABRIR en spec**. Evidencia del código real favorece derivar vía JOIN.

### D5 — `userId` en Project por consistencia

**Confirmado: TODOS los modelos del repo llevan `userId`.**

| Modelo | ¿Tiene userId? |
|--------|---------------|
| Note | ✅ |
| Task | ✅ |
| NoteRelationship | ✅ |
| Workout | ✅ |
| Transaction | ✅ |
| Account | ✅ |
| Subscription | ✅ |
| CoachAdvice | ✅ (userId @unique) |
| Habit | ✅ |
| HabitLog | ✅ (vía relación a Habit) |
| WorkoutSet | ✅ (vía relación a Workout) |
| LLMConfig | ✅ (userId @unique) |

**Consistencia perfecta.** Project debe llevar `userId` para mantener la convención.

**Veredicto**: ✅ Se sostiene. Convención confirmada.

### D6 — No soft-delete

**Confirmado: no hay `deletedAt` en ningún modelo del schema.** Grep por `deletedAt` en `.prisma` y `.ts` da 0 resultados. La única forma de "archivar" es borrar (hard-delete).

**Veredicto**: ✅ Se sostiene. Sin objeciones.

### D7 — No endpoint por proyecto en MVP

**Confirmado: no hay URLs, links, ni navegación que pidan vista por proyecto.** El NavMenu solo tiene Today, Calendario, los 5 hubs, Mente, y Ajustes. No hay `/projects/` en ningún lado.

**Veredicto**: ✅ Se sostiene. No hay requisito de UI que fuerce este endpoint.

---

## 5. Riesgos encontrados (nuevos o refinados)

### R-A — [P2] Tests E2E asumen shape del dashboard flexible

El test `Dashboard: sin foco asignado, focusTask es null` (`tests/e2e.spec.ts:496-520`) accede a `body.data.focusTask` sin validar forma exacta. Añadir `project` a la respuesta no rompe este test. Sin embargo, si en el futuro se añade un snapshot test o un test que verifique JSON exacto, habrá que actualizarlo. Bajo riesgo ahora.

### R-B — [P1] Manual validation en endpoints sin Zod

El código no usa Zod. Usa arrays de validación como `VALID_DOMAINS` y type assertions. Al añadir `projectId` a los endpoints POST/PATCH:
- `app/api/notes/route.ts:29-47` — valida `title`, `content`, `domain` manualmente. `projectId` debe añadirse como campo aceptado con su propia validación.
- `app/api/notes/[id]/route.ts:77-110` — valida `title`, `content`, `tags`, `domain` manualmente. Mismo caso.
- `app/api/tasks/[id]/route.ts:33-54` — valida `dueDate`, `isImportant`. Si D4 se mantiene, `projectId` aquí también.

**Riesgo**: si `projectId` se añade a la validación como literal booleano sin verificación de UUID o existencia real, un `projectId` inválido pasa silenciosamente y causa un error Prisma FK en DB.

**Mitigación**: validar `projectId` contra regex de cuid, y/o verificar ownership del proyecto antes de asignar.

### R-C — [P2] Accept-goal crea Task sin heredar projectId

`app/api/notes/[id]/accept-goal/route.ts:38-47` — crea Task sin `projectId`. Si la Note tiene `projectId`, la Task creada debería heredarlo. Si D4 se mantiene (denormalizado), este es un punto de desincronización más.

**Mitigación**: si D4 se mantiene, aceptar goal debe copiar `note.projectId` a la Task. Si D4 se deriva vía JOIN, este código no necesita cambios.

### R-D — [P2] Migration de Note: añadir columna NOT NULL vs NULL

Si añadimos `projectId String?` (nullable), no requiere default ni backfill. Migration segura. Pero si el deep-think o el spec deciden hacerlo NOT NULL con default a un "proyecto general", hay que definir el default (¿una cuenta de proyecto por usuario?) y hacer backfill.

**Riesgo**: migration NOT NULL sin default rompe filas existentes.

**Mitigación actual**: el deep-think propone `projectId String?` (opcional) para Note y Task, y el código actual ya usa `String?` para referencias opcionales (`subscriptionId`, `accountId`). Seguir ese patrón.

### R-E — [P2] `suggestedGoals` en Note lleva al accept-goal — proyecto inconsistente

Si una Note ACTIVE tiene `suggestedGoals` y se acepta un goal, se crea una Task sin `projectId`. Si después se asigna la Note a un proyecto, la Task queda sin proyecto. Inconsistencia menor (la Task "cuelga" del proyecto solo vía Note), pero si D4 se mantiene, la Task quedaría con `projectId = null` mientras la Note tiene `projectId = algo`. **Riesgo bajo** porque es un flow edge (suggestedGoals + project assignment no simultáneos).

---

## 6. Recomendaciones para la spec

- **R1 — Migration aditiva**: `projectId String?` nullable, sin default. `CREATE TABLE Project` separado. Los datos existentes tienen `projectId = null`. No requiere backfill.
- **R2 — Sin helper de cascade atómica**: Si D4 se deriva vía JOIN (recomendado), no hay dos campos que sincronizar. Si D4 se mantiene, crear un service `updateNoteProject(noteId, projectId, tx)` que haga `note.update + task.update` en transacción.
- **R3 — Validación manual de `projectId`**: Añadir a `app/api/notes/route.ts` y `app/api/notes/[id]/route.ts` la aceptación y validación de `projectId` (regex cuid + ownership check). La validación puede ser lazy (solo verificar formato, no existencia) para evitar N+1 en POST que crea Note + asigna proyecto en un solo paso.
- **R4 — Tipos nuevos**:
  - `lib/types/project.ts`: `ProjectItem { id, userId, name, description?, status: ProjectStatus, createdAt, updatedAt }`, `ProjectBrief { id, name, status }`.
  - `lib/types/task.ts`: Extender `TaskItem` con `project?: ProjectBrief | null`.
  - `app/(app)/page.tsx`: Extender `TaskItem` local con `project?: { id: string; name: string; status: string } | null`.
- **R5 — Tests E2E nuevos**:
  - Crear proyecto via factory (`createProject`).
  - Asignar Note a proyecto + confirmar cascade en dashboard.
  - Asignar Task a proyecto vía Note → confirmar que aparece en `focusTask`/`todayTasks`.
  - Borrar proyecto → confirmar Note.projectId = null (SetNull) y Task borrada (Cascade).
  - Archivar proyecto (status = ARCHIVED) → confirmar que sus Tasks siguen apareciendo pero con status contextual.
  - Validar que Notes huérfanas siguen siendo buscables.
- **R6 — Backfill strategy**: Ninguna. `projectId` nullable, datos existentes = `null`. Comportamiento idéntico al actual. Si en el futuro se quiere migrar datos legacy, se puede hacer con script ad-hoc (no necesario para MVP).

---

## 7. Result Contract

```
## Result Contract
- Fase: brain-explore (Fase 1)
- Status: done
- Artefacto: docs/sdd/active/projects-engine/explore.md
- Insumos consumidos: deep-think.md (D1-D7, esbozo, riesgos)
- Insumos producidos:
  1. Verificación del schema actual con confirmación P0 (Task.noteId NOT NULL ✅)
  2. Mapeo del endpoint /api/dashboard con queries reales (6 secciones, sin dependencia de Project)
  3. Blast radius completo: ~14 archivos a modificar + 1 nuevo (lib/types/project.ts)
  4. Validación de D1-D7 contra código real:
     - D1 ✅, D2 ✅, D3 ✅, D5 ✅, D6 ✅, D7 ✅
     - D4 🔄 REABRIR (Task.noteId NOT NULL → derivar vía JOIN elimina sync y simplifica)
  5. Riesgos nuevos: R-A (tests flexibles), R-B (manual validation sin Zod), R-C (accept-goal sin projectId), R-D (nullable vs not null), R-E (suggestedGoals edge)
  6. Recomendaciones R1-R6 para la spec
- Próxima fase: brain-spec (generar el contrato formal con API + tipos + migration + tests)
- Decisiones que deben REABRIRSE en spec:
  - [D4: Task.projectId denormalizado vs derivado por JOIN — P0 confirma Task.noteId NOT NULL, JOIN es viable y más simple. Propuesta: NO denormalizar.]
- Riesgos top para orchestrator:
  - D4 reabierto: decisión sobre denormalización vs JOIN afecta R2 (service atómico), R3 (validación en tasks PATCH), y alcance de la migration.
  - Migration: asumir `projectId String?` (nullable). Si el spec decide NOT NULL, requiere default + backfill.
  - Validación de `projectId` en endpoints: sin Zod, hay que añadir validación manual inline en cada endpoint.
  - Accept-goal route: si D4 se mantiene, hay que heredar `projectId` al crear Task (punto de desincronización adicional).
  - pgvector y `suggestedGoals`: el grafo semántico y el flujo de aceptación de metas no se ven afectados por la columna `projectId`, pero los tests E2E que crean Notes con `suggestedGoals` deben extenderse con `projectId`.
```
