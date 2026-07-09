# Deep Think: Project Engine (Phase 3)

> Fase 0 del pipeline brain-team. Análisis pre-código, read-only.
> Artefacto de entrada para `brain-explore` (validar contra código real).
> No contiene código Prisma final — solo contrato y decisiones.

---

## 1. Contexto y alcance

**Producto**: `zero-friction` es la herramienta personal de Ezequiel — single-user,
Vercel + Supabase, Next.js App Router, Prisma + Postgres + pgvector. NO es SaaS
multi-tenant ni herramienta colaborativa ("eso ya vive en otro software"). Es una
**cabina de ejecución personal de alta velocidad** con un **Second Brain** acoplado:
el conocimiento (Note) y la ejecución táctica (Task) conviven en la misma base.

**Estado actual relevante (post Phase 2 `refactor-note-task-split`)**:
- Note y Task ya están separados. Task tiene `noteId @unique` (1:1 con Note).
- Note tiene `noteStatus` (DRAFT | NEEDS_REVIEW | ACTIVE), `embedding` pgvector,
  y relaciones `incomingLinks`/`outgoingLinks` (NoteRelationship, grafo de Second Brain).
- Task tiene `status` (OPEN | DONE), `dueDate`, `isImportant`, `focusedAt`, `completedAt`.
- El endpoint `/api/today` fue **renombrado a `/api/dashboard`** en Phase 2 §3.3.
  Es GET, devuelve 6 secciones: `focusTask`, `todayTasks`, `maintenanceTasks`,
  `habits`, `dueSubscription`, `resurgenceNote`. **Este deep-think usa `/api/dashboard`
  como path canónico** — cualquier mención del usuario a `/api/today` se mapea aquí.

**Lo que Phase 3 añade**: un contenedor `Project` que agrupa Notes y Tasks. Un
Proyecto aquí NO es un proyecto colaborativo con sprints y equipo — es un
**contenedor semántico de trabajo personal**: "estoy construyendo el micro-SaaS X,
estas Notes son mi investigación y estas Tasks son mi ejecución". El Proyecto es
un **tag estructurado con estado**, no un workspace.

**Supuesto explícito**: asumo single-user (1 cuenta de producción = Ezequiel). Si
zero-friction mutara a multi-tenant, el `userId` en Project pasaría de "decorativo"
a "crítico de aislamiento" y habría que revisar RLS. No lo resuelvo aquí, lo señalo.

---

## 2. Respuesta a Pregunta 1 — ENUM ProjectStatus

### Set propuesto (4 valores — coincido con el usuario, con matices)

```
IDEATION | ACTIVE | MAINTENANCE | ARCHIVED
```

**POR QUÉ 4 y no más**: un micro-SaaS personal tiene un ciclo de vida corto y
brutal. Cuatro estados cubren el arco completo: "pienso → construyo → mantengo →
descarto". Añadir más (PAUSED, SHIPPED, PIVOTING) introduce estados que o bien son
derivables de timestamps (PAUSED = ACTIVE sin commits recientes), o bien son
momentos puntuales sin duración (SHIPPED es un instante, no un estado estable).

**POR QUÉ NO añadir PAUSED**: en una cabina personal, "pausado" es una emoción, no
un estado de sistema. Si Ezequiel deja de tocar un proyecto 2 semanas, no necesita
cambiarle el estado — el dashboard puede derivar "staleness" de `updatedAt` o de la
última Task completada. Un ENUM PAUSED invita a procrastinar con clasificación.
Si más adelante la ausencia de PAUSED duele en la UI, se añade como migración
aditiva (nuevo valor ENUM) sin romper nada. **YAGNI ahora.**

**POR QUÉ NO añadir SHIPPED**: para un micro-SaaS, "shipped" no es estable —
shipped es el momento en que entras en MAINTENANCE. Un proyecto shipped sigue
vivo (bugs, soporte, mejoras). MAINTENANCE cubre "está en producción y le dedico
low-touch". SHIPPED como estado separado solo añade una transición innecesaria
(SHIPPED → MAINTENANCE) sin valor de información.

### Argumento por valor

| Valor | Momento del ciclo | Qué significa operativamente |
|-------|-------------------|------------------------------|
| `IDEATION` | Antes de escribir código. Investigación, notas, validación de idea. | El Proyecto existe como contenedor de Notes (investigación). Puede no tener Tasks aún, o Tasks de exploración. |
| `ACTIVE` | Construyendo/shipping activamente. Sprint personal en marcha. | Tasks con dueDate, foco diario. El dashboard puede priorizar Tasks de proyectos ACTIVE. |
| `MAINTENANCE` | Shipped, en producción, low-touch. Bugs puntuales, soporte. | Tasks esporádicas. El dashboard no prioriza estos proyectos para foco, pero sus Tasks siguen siendo "hoy" si tienen dueDate. |
| `ARCHIVED` | Descartado, abandonado, o completado y congelado. No se toca. | Sus Notes vuelven al Second Brain general (si se borra el proyecto) o quedan referenciadas pero inactivas. Sus Tasks no aparecen en foco. |

### DAG de transiciones válidas (no libre)

```
IDEATION ──→ ACTIVE        (empezar a construir)
IDEATION ──→ ARCHIVED      (descartar la idea antes de codear)
ACTIVE   ──→ MAINTENANCE   (ship → low-touch)
ACTIVE   ──→ ARCHIVED      (abandonar en construcción)
ACTIVE   ──→ IDEATION      (pivot duro: re-idear sobre el mismo contenedor)
MAINTENANCE ──→ ACTIVE     (renewed push: nueva feature mayor)
MAINTENANCE ──→ ARCHIVED   (sunset del producto)
ARCHIVED ──→ ACTIVE         (REVIVIR — ver abajo)
ARCHIVED ──→ IDEATION      (revivir como fresh ideation, manteniendo historia)
```

**Transiciones NO válidas** (la app debe bloquearlas):
- `IDEATION → MAINTENANCE` (no saltarse ACTIVE — si vas a mantenerlo, primero lo
  construiste, pasa por ACTIVE).
- `MAINTENANCE → IDEATION` (no tiene sentido — si quieres re-idear, ve a ACTIVE o
  ARCHIVED+revive). *Esta es una opinión; el spec puede reabrir si Ezequiel discrepa.*

### ¿Revivir un proyecto archivado?

**Sí.** `ARCHIVED → ACTIVE` y `ARCHIVED → IDEATION` son transiciones válidas. Esto
es **crítico para micro-SaaS**: descartas rápido, pero a los 3 meses retomas la
idea con nuevo ángulo. Si ARCHIVED fuera terminal, perderías la historia del
contenedor (Notes, Tasks, decisiones) al tener que crear un Project nuevo.

**Implementación**: no hay `deletedAt` ni soft-delete. ARCHIVED es un estado más
del ENUM. Revivir = `UPDATE project SET status = 'ACTIVE' WHERE id = ?`. La
historia (Notes/Tasks asociadas) sigue ahí porque nunca se borró nada — solo se
marcó ARCHIVED. **Esto es coherente con la filosofía Second Brain.**

### Veredicto Pregunta 1

**D1: `ProjectStatus = [IDEATION, ACTIVE, MAINTENANCE, ARCHIVED]`** con el DAG
arriba. Los 4 valores del usuario son correctos. No añadir PAUSED ni SHIPPED.
Permitir revivir desde ARCHIVED.

---

## 3. Respuesta a Pregunta 2 — Cascade delete vs conocimiento huérfano

### Regla clave del producto (no negociable)

> **Note = Second Brain. El conocimiento NO se pierde.**
> **Task = táctica. Su pérdida es tolerable (se recrea).**

Esta asimetría es la brújula de toda la decisión.

### Opciones sobre la mesa

| Opción | Note al borrar Project | Task al borrar Project | Veredicto |
|--------|------------------------|------------------------|-----------|
| **A** Cascade total | Borrada | Borrada | ❌ Viola Second Brain |
| **B** Soft-delete Project + cascade Task | Sobrevive (Project soft-deleted) | Borrada | ⚠️ Añade complejidad (deletedAt, filtros) |
| **C** `SetNull` Note.projectId + `Cascade` Task.projectId | Sobrevive huérfana (projectId=null) | Borrada | ✅ **Recomendada** |
| **D** `SetNull` Note + `SetNull` Task | Sobrevive huérfana | Sobrevive huérfana | ⚠️ Ruido: tasks de proyecto muerto en inbox |

### Recomendación: Opción C

**`Note.projectId` → `onDelete: SetNull`**
**`Task.projectId` → `onDelete: Cascade`**

### POR QUÉ C y no las demás

**POR QUÉ NO A (cascade total)**: destruye el Second Brain. Si Ezequiel borra un
proyecto que descartó, pierde toda la investigación (Notes) que generó. Eso
contradice la premisa del producto. Inaceptable.

**POR QUÉ NO B (soft-delete Project)**: añade `deletedAt`, filtros `WHERE
deletedAt IS NULL` en cada query, y un estado "archived-soft-deleted" que se
solapa confusamente con `status = ARCHIVED`. Para single-user es
sobre-ingeniería: ARCHIVED ya cubre "no lo toco pero existe", y el hard-delete con
SetNull cubre "lo elimino del todo pero salvo el conocimiento". Dos mecanismos de
"no activo" es ruido. **YAGNI.**

**POR QUÉ NO D (SetNull ambos)**: el prompt la describe como "raro, pero puede
servir para soltar tareas huérfanas al inbox". Exacto — y ese es el problema. Si
borras un proyecto descartado, sus Tasks (tácticas, de un proyecto muerto) caen al
inbox general de `todayTasks`/`maintenanceTasks` y generan ruido: "¿por qué tengo
una task 'deploy micro-saaS X' si maté ese proyecto?". Las Tasks de un proyecto
muerto no son útiles sin el contenedor. La pérdida es tolerable (premis del
usuario) y deseable (limpieza). **C > D porque C limpia deuda táctica.**

**POR QUÉ SÍ C**: combina lo mejor —
1. Note sobrevive (Second Brain intacto). La Note vuelve a "unclassified"
   (`projectId = null`), accesible vía búsqueda semántica y NoteRelationship.
2. Task se limpia (cascade). No contamina el inbox con tareas de un contenedor
   muerto. La pérdida es tolerable por definición del producto.
3. La Note pierde su Task asociado (`Note.taskId → null` vía la relación
   Note↔Task), lo cual es **correcto**: la Note vuelve a ser conocimiento puro
   sin ejecución pendiente. Si Ezequiel revive el proyecto (ARCHIVED→ACTIVE en un
   Project nuevo, o reasigna la Note a otro Project), puede crear una Task nueva.

### Casos edge

**NoteRelationship (links entre Notes)**: las Notes huérfanas **mantienen sus
links**. ¿Útil o confuso? **Útil.** El Second Brain es un grafo de conocimiento;
el Project era un tag estructurado, no la fuente de verdad de las conexiones. Si
la Note A (del proyecto borrado) linkea a la Note B (de otro proyecto), ese link
sigue siendo válido — el conocimiento referenciado no deja de existir porque el
contenedor se borre. Los links son sobre el contenido, no sobre el proyecto.
**Decisión: no tocar NoteRelationship al borrar Project.**

**Embedding pgvector**: la Note huérfana **conserva su embedding**. ¿Válido?
**Sí, totalmente.** El embedding representa el contenido semántico de la Note, no
su pertenencia a un proyecto. Una Note huérfana sigue siendo buscable
semánticamente en el Second Brain. De hecho, es deseable: si Ezequiel borra un
proyecto descartado pero la investigación era buena, esas Notes resurgen en
búsquedas futuras. **Decisión: no re-embeddear ni invalidar al desasignar proyecto.**

### Implicación SQL/Prisma (contrato, no código final)

```
Note.projectId  →  references Project.id, onDelete: SetNull
Task.projectId  →  references Project.id, onDelete: Cascade
Note.taskId     →  references Task.id,  onDelete: SetNull  (ya existe o a confirmar en explore)
```

La cadena al borrar un Project:
1. `DELETE Project` →
2. `Task.projectId` cascade → Tasks borradas →
3. `Note.taskId` SetNull → Notes que apuntaban a esas Tasks quedan con `taskId = null` →
4. `Note.projectId` SetNull → Notes quedan con `projectId = null` (huérfanas, en Second Brain).

**Resultado**: Notes huérfanas + sin task, accesibles. Tasks borradas. Limpio.

### Veredicto Pregunta 2

**D2: `Note.projectId onDelete: SetNull` + `Task.projectId onDelete: Cascade`.
No soft-delete. No cascade sobre Note. NoteRelationship y embedding intactos.**

---

## 4. Respuesta a Pregunta 3 — Impacto en `/api/dashboard`

### Inventario de las 6 secciones vs Project

| Sección | Tipo | ¿Afectada por Project? | Cambio MVP |
|---------|------|------------------------|------------|
| `focusTask` | Task | Informativa (¿de qué proyecto es el foco?) | Añadir `project: {id,name,status}\|null` al item |
| `todayTasks` | Task | Informativa | Añadir `project` al item |
| `maintenanceTasks` | Task | Informativa | Añadir `project` al item |
| `habits` | Habit | No afectada | Sin cambio |
| `dueSubscription` | Subscription | No afectada | Sin cambio |
| `resurgenceNote` | Note | **Sí, sutil** (ver abajo) | Sin cambio en MVP (ver justificación) |

### `focusTask`, `todayTasks`, `maintenanceTasks` — ¿filtrar por Project?

**NO filtrar. Mantener globales (cross-project).**

**POR QUÉ**: la cabina de ejecución personal opera sobre el DÍA de Ezequiel, no
sobre un proyecto. Ezequiel no trabaja "hoy solo en el proyecto X" — trabaja sobre
su vida, que cruza proyectos. Filtrar `todayTasks` por proyecto rompería la
premisa de "vista de hoy". El foco es global por diseño.

Lo que sí aporta Project aquí es **contexto informativo**: saber que `focusTask`
pertenece al proyecto "Micro-SaaS Y" (status: ACTIVE) ayuda a la UI a mostrar de
dónde viene el foco. Por eso añado `project: {id, name, status} | null` al item de
Task — no como filtro, sino como metadata.

### `resurgenceNote` — ¿excluir Notes con Project?

La lógica actual: Note ACTIVE con `createdAt < now - 180d` que resurge.

**Tensión**: si una Note está en un Project ACTIVE/MAINTENANCE, Ezequiel ya la está
"viendo" vía el proyecto → resurgirla es ruido. Pero si está en un Project ARCHIVED,
el proyecto está olvidado → la Note TAMBIÉN está olvidada → debería resurgir.

**Decisión MVP: NO cambiar `resurgenceNote`.** Mantener global.

**POR QUÉ no tocar en MVP**:
- La query actual ya funciona y tiene valor.
- Añadir un JOIN a Project + filtro por status complica la query por un beneficio
  marginal (evitar resurgir notes de proyectos activos).
- El caso "note de proyecto activo resurge" es raro: si el proyecto está ACTIVE,
  las notes son recientes (no >180d) o se están tocando (updatedAt reciente).
  El filtro `createdAt < now-180d` ya filtra la mayoría.
- Si en producción resulta molesto, se añade el filtro después con datos reales.
  **No optimizar prematuramente.**

### Cambios propuestos al endpoint (mínimo viable)

1. **Añadir campo `project` a los items de Task** en la respuesta:
   ```
   project: { id: string, name: string, status: ProjectStatus } | null
   ```
   Se obtiene con un `include: { note: { include: { project: { select: {id,name,status} } } } }`
   (Task → Note → Project, o directo Task.project si Task.projectId existe).

2. **NO añadir filtro `?projectId=` a `/api/dashboard`** en MVP.
   El dashboard es global por definición. Si Ezequiel quiere ver un proyecto
   concreto, eso es otra vista (ver abajo).

3. **NO crear `/api/projects/[id]/dashboard` en MVP.** YAGNI. Ezequiel no ha
   pedido vista por proyecto — ha pedido el modelo de datos. La vista por proyecto
   se diseña cuando la pida, con requisitos reales. Crear el endpoint ahora es
   especular sobre una UI que no existe.

### Backward compatibility

- El campo `project` es **nuevo y opcional** (`null` para Tasks sin proyecto).
- La UI actual que no conoce Projects ignora el campo (o lo muestra como badge
  opcional). No rompe nada.
- Las Tasks existentes (pre-Phase-3) tienen `projectId = null` → `project: null`
  en la respuesta. Comportamiento idéntico al actual.
- **No se cambia el contrato existente** — solo se añade un campo. Los clientes
  que deserialicen con schemas estrictos (zod) necesitan añadir el campo como
  opcional; los que usen JSON flexible no notan nada.

### Veredicto Pregunta 3

**D3: `/api/dashboard` se queda global, sin filtro `projectId`. Se añade campo
informativo `project: {id,name,status}|null` a items de Task. No se crea endpoint
por-proyecto en MVP. `resurgenceNote` sin cambios.**

---

## 5. Modelo de datos propuesto (esbozo — NO código final)

### `Project`

```
model Project {
  id          String   @id @default(cuid())
  userId      String   // single-user pero se mantiene por consistencia con el resto del schema
  name        String
  description String?
  status      ProjectStatus @default(IDEATION)
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  user   User    @relation(fields: [userId], references: [id])
  notes  Note[]
  tasks  Task[]

  @@index([userId, status])   // dashboard/listado por estado
  @@index([userId, updatedAt]) // "proyectos recientes"
}
```

### `ProjectStatus` (ENUM)

```
enum ProjectStatus {
  IDEATION
  ACTIVE
  MAINTENANCE
  ARCHIVED
}
```

### Campos a añadir a `Note`

```
projectId String?   // opcional: una Note puede no tener proyecto (Second Brain puro)
project   Project? @relation(fields: [projectId], references: [id], onDelete: SetNull)

@@index([projectId, noteStatus])  // filtrar notes de un proyecto por estado
```

### Campos a añadir a `Task`

```
projectId String?   // ver D4 abajo — denormalizado, sync con Note.projectId
project   Project? @relation(fields: [projectId], references: [id], onDelete: Cascade)

@@index([projectId, status])  // filtrar tasks de un proyecto
```

### Índices

- `Project(userId, status)` — listar proyectos por estado (dashboard de proyectos).
- `Project(userId, updatedAt)` — "proyectos recientes" / staleness.
- `Note(projectId, noteStatus)` — notes de un proyecto por estado.
- `Task(projectId, status)` — tasks de un proyecto por estado.

### Constraints de DB

- **¿CHECK sobre ProjectStatus?** No — el ENUM de Postgres ya restringe los valores.
- **¿Partial unique?** No hay caso. `name` no es unique (puede haber dos proyectos
  "Experimento" archivados). La unicidad de nombre no aporta valor en single-user.
- **¿CHECK de que Task.projectId = Note.projectId?** No se puede expresar sin
  trigger (comparar campo de fila relacionada). Se enforcea en app layer (ver D4).
  Añadir un trigger por esto es sobre-ingeniería para single-user.

---

## 6. Decisiones cerradas que el spec debe respetar

- **D1**: `ProjectStatus = [IDEATION, ACTIVE, MAINTENANCE, ARCHIVED]`. DAG de
  transiciones como en §2. No PAUSED, no SHIPPED. Revivir desde ARCHIVED permitido.
- **D2**: `Note.projectId onDelete: SetNull` + `Task.projectId onDelete: Cascade`.
  No soft-delete. NoteRelationship y embedding intactos al borrar Project.
- **D3**: `/api/dashboard` global, sin filtro `projectId` en MVP. Se añade campo
  informativo `project: {id,name,status}|null` a items de Task. No endpoint
  por-proyecto. `resurgenceNote` sin cambios.
- **D4**: `Task.projectId` es **denormalizado** (existe además de `Note.projectId`).
  **Invariante de app**: `Task.projectId` debe igualar `Note.projectId` (la Task
  hereda el proyecto de su Note). Se enforcea en la capa de aplicación (service),
  NO en DB. **Señal para spec**: si el explore confirma que Task SIEMPRE tiene
  Note (noteId @unique NOT NULL), considerar alternativa de NO añadir
  `Task.projectId` y derivar vía JOIN. **Reabrir en spec con datos del explore.**
- **D5**: `Project.userId` se mantiene por consistencia con el resto del schema
  (todas las entidades lo tienen), aunque single-user lo haga decorativo. No
  añadir RLS específica en MVP (single-user).
- **D6**: No soft-delete, no `deletedAt` en Project. ARCHIVED cubre "inactivo pero
  existe"; hard-delete + SetNull cubre "eliminado pero conocimiento salvado".
- **D7**: No se crea `/api/projects/[id]/dashboard` ni vista por proyecto en MVP.
  YAGNI hasta que Ezequiel pida requisitos reales de esa vista.

---

## 7. Riesgos top que el orchestrator debe gatekeepear

1. **[P1] D4 — `Task.projectId` denormalizado puede desincronizarse de
   `Note.projectId`.** Si la app actualiza `Note.projectId` sin actualizar
   `Task.projectId`, las Tasks quedan apuntando a un proyecto equivocado.
   *Mitigación*: centralizar la mutación de `projectId` en un service que actualice
   ambos atómicamente (transacción Prisma). El spec debe definir este service.
   Alternativa: NO añadir `Task.projectId` y derivar siempre vía JOIN a Note.
   **El explore debe confirmar si Task.noteId es NOT NULL (siempre hay Note).**

2. **[P1] Migración aditiva — añadir `projectId` a Note y Task es seguro (NULL por
   defecto, no rompe filas existentes) PERO hay que verificar que no hay código
   que haga `SELECT *` con deserialización estricta que falle al ver la columna
   nueva.** *Mitigación*: el explore debe buscar usos de Prisma `findMany` sin
   `select` que deserialicen a tipos estrictos. Bajo riesgo en Prisma (tipos
   generados), pero confirmar.

3. **[P2] `resurgenceNote` puede resurgir Notes de proyectos ARCHIVED que Ezequiel
   ya dio por muertos.** Si un proyecto archivado tenía Notes >180d, resurgen.
   *Mitigación*: acceptable en MVP (es conocimiento que resurge, coherente con
   Second Brain). Si molesta, filtrar `WHERE project.status IS NULL OR
   project.status != 'ARCHIVED'` después. No bloquea MVP.

4. **[P2] Performance — el campo `project` en items de Task del dashboard añade un
   JOIN/INCLUDE por cada Task.** Con single-user y volumen personal (cientos de
   Tasks, no millones), el coste es despreciable. *Mitigación*: índice
   `Task(projectId)` ya propuesto. No optimizar prematuramente.

5. **[P0] Confirmar que `Task.noteId` es `NOT NULL` (Task SIEMPRE tiene Note).**
   Esto determina si D4 (denormalizar Task.projectId) tiene sentido o si se
   deriva. **El explore debe verificar el schema real.** Si Task puede existir
   sin Note, todo el razonamiento de D4 cambia.

---

## Result Contract

- **Fase**: brain-deep-think (Fase 0)
- **Status**: done
- **Artefacto**: `docs/sdd/active/projects-engine/deep-think.md`
- **Insumos consumidos**: input literal del usuario + contexto de Phase 2
  (`refactor-note-task-split`: split Note/Task, rename `/api/today`→`/api/dashboard`,
  pgvector activo, NoteRelationship).
- **Insumos producidos para la siguiente fase**:
  1. ENUM `ProjectStatus` final = `[IDEATION, ACTIVE, MAINTENANCE, ARCHIVED]` con
     DAG de transiciones (§2).
  2. Política de cascade: `Note.projectId SetNull` + `Task.projectId Cascade`,
     NoteRelationship y embedding intactos (§3).
  3. Plan de impacto en `/api/dashboard`: global sin filtro, campo informativo
     `project` en items de Task, sin endpoint por-proyecto en MVP (§4).
  4. Esbozo de modelo Prisma: `Project`, `ProjectStatus`, campos en Note/Task,
     índices (§5) — contrato, no código final.
  5. 7 decisiones cerradas numeradas (D1–D7) (§6).
- **Próxima fase**: `brain-explore` — validar el esbozo contra el código real,
  encontrar blast radius, confirmar P0 (¿`Task.noteId` NOT NULL?), verificar
  usos de `/api/dashboard` y deserialización estricta.
- **Riesgos top para orchestrator**:
  - **P0**: confirmar `Task.noteId` NOT NULL (determina si D4 denormalización es
    válida o se deriva vía JOIN).
  - **P1**: desincronización `Task.projectId` vs `Note.projectId` → requiere
    service con transacción atómica (definir en spec).
  - **P1**: migración aditiva segura, pero verificar deserialización estricta en
    código existente.
  - **P2**: `resurgenceNote` puede resurgir notes de proyectos ARCHIVED (aceptable
    en MVP, filtrable después).
  - **P2**: coste del JOIN por `project` en dashboard (despreciable en single-user,
     no optimizar).