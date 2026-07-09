# Deep Think: Split del modelo `Note` → `Note + Task`

> Fase 0 del pipeline `refactor-note-task-split-2026-07-08`.
> Razonamiento pre-código sobre bordes, transacciones, race conditions y
> semántica de migración. **No hay código de migración aquí** — solo
> estrategia y decisiones de diseño que alimentan `brain-spec`.

**Estado**: `done` (con 4 preguntas abiertas, 2 bloqueantes para spec).
**Siguiente fase**: `brain-spec` (las decisiones cerradas + este análisis
son insumo suficiente; no hace falta re-explorar).

---

## 1. Mapa de bordes y casos límite

Convención: **ANTES** = comportamiento actual con `Note.status` monolítico.
**DESPUÉS** = comportamiento con `Note(noteStatus)` + `Task(status, focusedAt)`.

### 1.1 Borrado de Note con Task asociada

| | |
|---|---|
| **ANTES** | No existe Task. Borrar Note es `DELETE` simple (cascade de `NoteRelationship` ya cubierto por `onDelete: Cascade`). |
| **DESPUÉS** | `Task.noteId` es FK obligatoria 1:1. Si se borra la Note, la Task queda huérfana → violación de FK. |

**Decisión recomendada**: `onDelete: Cascade` en `Task.note → Note` (igual que
`NoteRelationship`). Es decir, **borrar Note arrastra su Task**. Justificación:
- La Task es derivada de la Note (la Note es la fuente de verdad semántica).
  Sin Note, la Task pierde contexto (título, contenido, embedding, tags).
- Soft-delete introduce complejidad (columna `deletedAt`, filtros en todas las
  queries, índices parciales) que no se justifica todavía — no hay requisito de
  papelera de reciclaje en el producto.
- Si más adelante se quiere papelera, se añade `deletedAt` a ambas tablas en
  otro refactor; el cascade hard no cierra esa puerta.

**Riesgo**: borrado accidental de Note borra Task DONE con historial. Mitigación:
UI de confirmación + (opcional, P2) guardar `completedAt` y `dueDate` de la
Task borrada en una tabla `DeletedTaskAudit` si el producto lo pide. **No
bloqueante para spec.**

**Edge**: ¿qué pasa con `accept-goal`? Esa ruta crea Task ligada a Note origen.
Si el usuario borra la Note origen, la Task-objetivo también desaparece. Es
comportamento correcto (la Task sin Note-objetivo no tiene sentido).

### 1.2 AI process falla a mitad (crea Task, falla al actualizar Note)

| | |
|---|---|
| **ANTES** | `enrichDraftNote` es un único `updateMany` CAS-gated (status='DRAFT'). Atómico a nivel de Note. |
| **DESPUÉS** | Process hace: (a) enrich Note DRAFT→ACTIVE, (b) opcionalmente `create Task`. Si (b) se hace antes que (a) y (a) falla, queda Task apuntando a Note DRAFT. |

**Decisión recomendada**: **envolver (a)+(b) en una transacción Prisma**
(`prisma.$transaction([...])`). Orden dentro de la tx:
1. `note.updateMany({ where: { id, status: 'DRAFT' }, data: { ...ACTIVE } })`
   → si `count === 0`, alguien ya la procesó → abort tx, devolver `alreadyProcessed`.
2. Si `parsed.isExecutable`: `task.create({ noteId, ... })`.

Así, si (2) falla, la tx hace rollback y la Note **no** queda en ACTIVE sin Task
(ni en DRAFT con Task fantasma). El CAS del paso (1) sigue siendo el guard
anti-race que ya existe hoy.

**Edge dentro del edge**: ¿y si la Task ya existe (re-process de una Note ya
ACTIVE)? El guard `status='DRAFT'` del paso (1) lo impide: una Note ACTIVE no
pasa por process de nuevo. Pero `accept-goal` sí puede crear Task sobre Note
ACTIVE. → `Task.noteId` UNIQUE (ver §4) protege contra duplicados. Si
`accept-goal` choca con `process` creando Task para la misma Note, el UNIQUE
lanza `P2002` y `accept-goal` debe devolver 409 "ya tiene task". **Decisión:
aceptar el 409, no hacer upsert.**

### 1.3 Race condition en foco (dos clicks rápidos)

| | |
|---|---|
| **ANTES** | Foco = `status='IN_PROGRESS'`. No hay lógica de "solo una IN_PROGRESS" — hoy el dashboard hace `findFirst` y asume una. Si hay dos IN_PROGRESS, solo muestra la primera. Bug latente. |
| **DESPUÉS** | `Task.focusedAt: DateTime?`. Invariante: máximo 1 Task con `focusedAt != null` por usuario. |

**Decisión recomendada**: **transacción atómica con `updateMany` condicional**
(no `SERIALIZABLE` — ver §2). Secuencia en `POST /api/tasks/[id]/focus`:
```
$transaction([
  // 1. Desenfocar TODAS las tasks del usuario (CAS implícito: solo afecta focusedAt != null)
  task.updateMany({
    where: { userId, focusedAt: { not: null } },
    data: { focusedAt: null },
  }),
  // 2. Enfocar la nueva (solo si sigue existiendo y está OPEN)
  task.updateMany({
    where: { id, userId, status: 'OPEN' },
    data: { focusedAt: new Date() },
  }),
])
```
El paso (2) es CAS: si la Task fue DONE/borrada entre el click y la ejecución,
`count === 0` → devolver 409/404. Dos clicks concurrentes en Tasks distintas:
ambas tx corren en `ReadCommitted`, el `updateMany` del paso (1) adquiere
row-locks sobre las filas `focusedAt != null`. Si dos tx intentan desenfocar
la misma fila simultáneamente, una espera a la otra (row-lock), no hay
deadlock porque el paso (1) es un solo `updateMany` (no orden parcial).
Resultado: gana la última en commit. **Aceptable** — el invariante "máximo 1"
se preserva aunque el "cuál" sea no-determinista entre dos clicks exactamente
simultáneos (caso irreal en UI).

**Alternativa descartada**: trigger PG `BEFORE UPDATE` que valide
`count(focusedAt != null) <= 1`. Más robusto pero añade lógica en DB que
Prisma no ve en el schema → fricción de mantenimiento. **Solo si se detectan
violaciones en producción se promueve a trigger.**

**Edge**: ¿desenfocar la misma Task que ya está enfocada? El paso (1) la
pone a null, el paso (2) la vuelve a poner. Neto: refresca `focusedAt`. OK
(no es idempotente en timestamp, pero inofensivo).

### 1.4 Note huérfana post-proceso (no ejecutable → ACTIVE sin Task)

| | |
|---|---|
| **ANTES** | Toda Note ACTIVE aparece en hubs/search. Las que no son "tarea" igualmente tienen `status='ACTIVE'`. `/api/today` filtra por `domain='PROYECTOS'` + `dueDate`, así que notas sin dueDate no aparecen en today. |
| **DESPUÉS** | Note ACTIVE sin Task. Aparece en hubs/search (correcto: es conocimiento). **No aparece en `/api/today`** porque today ahora consulta `Task`, no `Note`. |

**Decisión**: **correcto tal cual**. La separación es exactamente el punto:
- `/api/today` → solo `Task` (con JOIN a Note para título/content si hace falta).
- `/api/search`, hubs → `Note` (con LEFT JOIN a Task opcional, para mostrar
  badge "tiene tarea" si se quiere).

**Edge**: una Note ACTIVE que el usuario *quería* como tarea pero el AI no la
marcó ejecutable. Hoy no hay UI de "promover Note a Task manualmente". **Pregunta
abierta §7.1** — ¿necesitamos acción manual "convertir en tarea"? Sospecho que
sí (caso: AI falla clasificación, usuario corrige), pero puede esperar a design.

### 1.5 REGISTROS: ¿sigue borrándose la Note?

| | |
|---|---|
| **ANTES** | `process` con `domain='REGISTROS'` + `recordType` reconocido → crea Transaction/HabitLog/Workout y **borra la Note** (CAS `status='DRAFT'`). |
| **DESPUÉS** | ¿Task entra en juego? |

**Decisión recomendada**: **NO**. REGISTROS no crea Task. La Note se sigue
borrando (o, mejor, se marca `noteStatus='ACTIVE'` en un dominio `REGISTROS`
y se guarda como referencia — pero eso cambia comportamiento existente y es
out of scope). **Mantener el borrado** es lo coherente con el modelo: una
nota "gasté 20€ en café" no es conocimiento ni tarea, es un evento que vive en
`Transaction`. La Note era solo el vehículo de captura.

**Riesgo**: si el usuario quiere ver el texto original de la captura después,
ya no existe. Pero esto ya pasa hoy y no se ha reportado como problema.
**Mantener comportamiento, no introducir Task aquí.**

**Edge**: REGISTROS sin `recordType` reconocido → cae al path default
(enrich a ACTIVE). Ahí sí: si el AI decide que es ejecutable, crea Task.
Pero REGISTROS + ejecutable es raro (¿una tarea de "registrar algo"?). El AI
debería clasificarlo como PROYECTOS si es ejecutable. **Acepto el
comportamiento default sin caso especial.**

### 1.6 Migración de datos existentes

Para cada `Note` actual con `status` (enum viejo de 5 valores) → nuevo modelo.

| `status` actual | `noteStatus` nuevo | ¿Crea Task? | Campos Task |
|---|---|---|---|
| `DRAFT` | `DRAFT` | No | — |
| `NEEDS_REVIEW` | `NEEDS_REVIEW` | No | — |
| `ACTIVE` (sin dueDate ni isImportant) | `ACTIVE` | **No** (decisión §7.2) | — |
| `ACTIVE` (con dueDate o isImportant) | `ACTIVE` | **Sí** | `status='OPEN'`, `dueDate`, `isImportant`, `focusedAt=null` copiados de la Note |
| `IN_PROGRESS` | `ACTIVE` | **Sí** | `status='OPEN'`, `focusedAt = updatedAt` (preserva "estaba en foco"), resto copiado |
| `DONE` | `ACTIVE` | **Sí** | `status='DONE'`, `completedAt = updatedAt`, `dueDate`/`isImportant` copiados |

**Decisión clave (§7.2, bloqueante)**: ¿una Note `ACTIVE` con `dueDate` o
`isImportant` hoy se considera "tarea implícita" y genera Task en migración?
- **Sí** (recomendado): preserva la semántica de "esta nota era accionable".
  El usuario no pierde nada: sigue viéndola en `/api/today` vía la Task nueva.
- **No**: más limpio conceptualmente (ACTIVE = conocimiento puro), pero el
  usuario pierde visibilidad de tareas que tenía antes.

**Recomiendo SÍ**. Si no, hay regresión visible: notas que aparecían en today
desaparecen. Eso es un no-go para datos de un usuario real en staging.

**Script de migración (estrategia, no SQL final)**:

Postgres ENUM no se puede "renombrar valores" ni reducir in-place. Secuencia:
1. Crear tabla `Task` (sin FK todavía, o con FK pero vacía).
2. Crear nuevo enum `NoteStatusNew` con `DRAFT, NEEDS_REVIEW, ACTIVE`.
3. `ALTER TABLE Note ADD COLUMN noteStatus NoteStatusNew DEFAULT 'ACTIVE'`.
4. `UPDATE Note SET noteStatus = CASE status WHEN 'DRAFT' THEN 'DRAFT'::... WHEN 'NEEDS_REVIEW' THEN 'NEEDS_REVIEW'::... ELSE 'ACTIVE'::... END`.
5. **Backfill de Task** (una sola query `INSERT INTO Task ... SELECT ... FROM Note WHERE status IN ('IN_PROGRESS','DONE') OR (status='ACTIVE' AND (dueDate IS NOT NULL OR isImportant))`):
   - `id = cuid()` (generar en SQL con `gen_random_uuid()` o en script Prisma).
   - `noteId = Note.id`, `userId = Note.userId`.
   - `status = CASE WHEN Note.status='DONE' THEN 'DONE' ELSE 'OPEN' END`.
   - `dueDate = Note.dueDate`, `isImportant = Note.isImportant`.
   - `focusedAt = CASE WHEN Note.status='IN_PROGRESS' THEN Note.updatedAt ELSE NULL END`.
   - `completedAt = CASE WHEN Note.status='DONE' THEN Note.updatedAt ELSE NULL END`.
   - `createdAt = Note.createdAt`, `updatedAt = Note.updatedAt`.
6. `ALTER TABLE Note DROP COLUMN status, DROP COLUMN dueDate, DROP COLUMN isImportant` (ya viven en Task). **Ojo**: `dueDate`/`isImportant` se mueven, no se duplican — confirmar que ningún query de Note los use después (hubs/search no los usan, solo today que ahora va a Task).
7. `ALTER TABLE Note ALTER COLUMN noteStatus DROP DEFAULT` + poner `DEFAULT 'DRAFT'` (las nuevas capturas).
8. `DROP TYPE NoteStatus` viejo, `ALTER TYPE NoteStatusNew RENAME TO NoteStatus`.
9. Añadir FK `Task.noteId → Note.id ON DELETE CASCADE`, UNIQUE en `noteId`, índices (§4).

**Recomendación fuerte**: hacer el backfill de Task en un **script Prisma
Client** (TS), no en SQL puro, porque `cuid()` se genera en app y es más
auditable. El SQL hace el ALTER de enum/columnas; el script TS hace el
`prisma.task.createMany` leyendo Notes. Orden: schema migration primero
(tabla Task + columnas nuevas), luego script de backfill, luego segunda
migration que dropea columnas viejas. **Dos migrations, no una.**

**Validación post-migración** (script de smoke):
- `count(Task) == count(Note where status in IN_PROGRESS,DONE) + count(Note where status=ACTIVE AND (dueDate OR isImportant))`.
- `count(Note where noteStatus IS NULL) == 0`.
- `count(Task where noteId NOT IN (SELECT id FROM Note)) == 0`.

---

## 2. Transacciones y consistencia

### Boundaries transaccionales

| Operación | ¿Atómica? | Isolation | Notas |
|---|---|---|---|
| Capture → `createNoteWithRelations` (Note DRAFT) | **Sí** (ya lo es hoy) | ReadCommitted | Una sola Note.create + relaciones. Sin Task. |
| Process → enrich Note + (opcional) create Task | **Sí** (NUEVO — hoy no había Task) | ReadCommitted | `$transaction([updateMany CAS, task.create])`. El CAS del updateMany sigue siendo el guard anti-race. |
| Focus toggle (desenfocar A + enfocar B) | **Sí** (NUEVO) | ReadCommitted | `$transaction([updateMany desenfocar, updateMany enfocar])`. Row-locks de PG bastan. |
| accept-goal → create Task + update Note.suggestedGoals | **Sí** | ReadCommitted | `$transaction([task.create, note.update])`. |
| REGISTROS → create Transaction/HabitLog/Workout + delete Note | **Sí** (ya debería serlo — hoy NO lo es, bug latente) | ReadCommitted | **P0**: hoy si `deleteMany` falla tras `createTransaction`, queda entidad huérfana sin Note. Envolver en tx. |
| Mark Task DONE → `status='DONE'` + `completedAt=now()` | No (1 fila) | ReadCommitted | Simple update. |

### ¿Hace falta `SERIALIZABLE`?

**No, en ningún caso.** Justificación:
- El invariante "máximo 1 foco" se preserva con `updateMany` condicional + row
  locks en `ReadCommitted`. `SERIALIZABLE` añadiría retries/restarts que
  complicarían sin beneficio (no hay read-then-write que genere write skew
  aquí: el `updateMany` es una sola sentencia que PG ejecuta atómicamente por
  fila).
- El CAS `status='DRAFT'` en process ya es el patrón anti-race probado en el
  código actual (comentarios "ponytail" lo documentan). Reusarlo.
- `SERIALIZABLE` en Supabase/Prisma tiene pitfalls (serialization failure
  `40001` que Prisma no reintenta por defecto). Evitar.

**Único caso que podría justificar constraint de DB**: si en producción se
detectan violaciones de "máximo 1 foco" (dos Tasks con `focusedAt != null`),
añadir **partial unique index**:
```sql
CREATE UNIQUE INDEX task_one_focus_per_user
  ON Task(userId) WHERE focusedAt IS NOT NULL;
```
Esto es barato, robusto y no necesita trigger. **Recomiendo añadirlo desde el
principio** (P1) — cuesta nada y elimina la clase entera de bugs. El `updateMany`
del §1.3 seguiría en app para UX, pero el index es el guard hard de último
recurso. **Decisión: sí, incluir el partial unique index en la migration.**

---

## 3. Backward compatibility y rollout

### Clientes de `/api/notes`

- **Web (Dashboard, Calendar, Inbox)**: controlamos el código, se actualiza a la par. No hay problema.
- **Mobile/Extensión**: **no existen** hoy (el proyecto es web-only según el contexto). No hay clientes externos que romper.
- **Integraciones**: no hay webhooks salientes ni API pública documentada.

**Decisión**: **big-bang sin feature flag**. Justificación:
- Un solo usuario en staging (datos reales pero entorno controlado).
- No hay clientes externos.
- Feature flag añade complejidad de código dual (Note con/sin Task) que se
  borra en semanas — deuda técnica gratis.

**Si** el producto tuviera más usuarios o clientes externos, la respuesta
cambiaría a: flag `task_split_v1` + devolver response de `/api/notes` con
campos `dueDate`/`isImportant`/`status` "aplanados" desde Task vía JOIN,
para que clientes viejos no rompan. **No es el caso hoy.**

### ¿Schema nuevo sin migración de datos inmediata?

**No recomendado** pero posible: crear `Task.noteId` NULL-able, permitir Notes
sin Task durante una ventana, luego backfill asíncrono. Problemas:
- Doble lógica en todos los queries (`LEFT JOIN Task` + null checks).
- La invariante "Task siempre tiene Note" se relaja a "Task tiene Note o null"
  → pierdes la garantía 1:1 que es el punto del refactor.
- Para un solo usuario en staging, el coste de la ventana transitoria supera
  el beneficio.

**Decisión**: migración big-bang en un maintenance window (la app puede estar
down 30s). Dos migrations Prisma + script de backfill TS ejecutados en orden.
Rollback: snapshot de DB antes de migrar (Supabase branch/restore).

### Contrato de response de `/api/notes`

Hoy devuelve `{ id, title, content, domain, status, dueDate, isImportant, tags, ... }`.
Después del split, `/api/notes` devuelve Note **sin** `dueDate`/`isImportant`/
`status` (esos viven en Task). El frontend debe pedir Task vía `/api/tasks` o
`/api/notes/[id]?include=task`. **Decisión de diseño para spec**: definir si
`/api/notes` incluye la Task anidada por defecto (conveniente para el
Dashboard que hoy lee todo de una) o si se separan los endpoints. **§7.3.**

---

## 4. Validaciones de modelo

### `Task` — constraints

| Constraint | ¿Sí/No? | Razón |
|---|---|---|
| `noteId UNIQUE` | **Sí** | Garantiza 1:1. Prisma: `@unique` en el campo. |
| `userId` NOT NULL | Sí | FK a User, cascade. |
| `status` NOT NULL, default `OPEN` | Sí | Enum `TaskStatus { OPEN, DONE }`. |
| `focusedAt` NULL-able | Sí | NULL = no en foco. |
| `completedAt` NULL-able, NOT NULL si `status='DONE'` | **CHECK constraint** recomendado | `CHECK (status <> 'DONE' OR completedAt IS NOT NULL)`. Prisma no soporta CHECK nativo → raw migration SQL. **P1**: vale la pena. Alternativa app-only: frágil. |
| `dueDate`, `isImportant` | NULL-able / default false | Migrados desde Note. |

### Índices recomendados

| Índice | Query que sirve | Prioridad |
|---|---|---|
| `Task(userId, status)` | `/api/today` (OPEN tasks), "tareas done" | **P0** |
| `Task(userId, focusedAt) WHERE focusedAt IS NOT NULL` (partial unique) | "tarea en foco" + invariante 1-foco | **P0** (es el unique de §2) |
| `Task(userId, dueDate)` | `/api/calendar` (tareas por día) | **P0** |
| `Task(noteId)` | ya cubierto por `@unique` | — |
| `Task(userId, status, dueDate)` | compound para today (OPEN + dueDate range) | **P1** si perf importa; hoy 1 usuario no lo necesita |

### ¿Trigger o check para "máximo 1 foco"?

**Partial unique index** (§2), no trigger. Más simple, más rápido, Prisma-friendly.
El trigger sería necesario solo si el invariante fuera "máximo N" con N>1.

### ¿`completedAt` derivado o almacenado?

**Almacenado** (con CHECK constraint). Razón:
- `status='DONE'` sin `completedAt` es estado inválido.
- Derivarlo de `updatedAt` es frágil (cualquier update posterior de la Task
  —ej. editar dueDate tras completar— sobreescribe `updatedAt`).
- El CHECK constraint fuerza consistencia en DB, no depende de la app.

---

## 5. Estrategia de tests

### E2E (`tests/e2e.spec.ts` líneas 67–313)

Hoy hace seed inline: crea Notes con todos los `status` del enum viejo. Tras
el split, eso no compila (no hay `IN_PROGRESS`/`DONE` en NoteStatus).

**Plan**:
1. Extraer factoría `tests/helpers/factories.ts`:
   - `createNote({ status: NoteStatus, domain, ... })` → crea Note sola.
   - `createNoteWithTask({ note, task })` → crea Note + Task asociada en una
     tx, con defaults sensatos (Task OPEN si no se especifica).
   - `createFocusedTask(userId)` → crea Note + Task con `focusedAt=now()`.
2. Reescribir las líneas 67–313 usando factorías. El seed de "una IN_PROGRESS"
   pasa a ser `createNoteWithTask({ task: { focusedAt: new Date() } })`.
3. Los asserts que comprueban `note.status === 'IN_PROGRESS'` pasan a
   `task.focusedAt !== null` (o `task.status === 'OPEN'` según el caso).

**Prioridad**: **P0** — sin esto los E2E no corren y no hay CI verde.

### Tests unitarios nuevos

| Test | Qué cubre | Prioridad |
|---|---|---|
| `process` crea Task cuando AI dice ejecutable | transición DRAFT→ACTIVE + Task OPEN | P0 |
| `process` NO crea Task cuando AI dice no-ejecutable | DRAFT→ACTIVE sin Task | P0 |
| `process` falla AI → DRAFT→NEEDS_REVIEW (sin Task) | ya existe, re-verificar | P1 |
| `focus` toggle: solo 1 foco | invariante con 2 tasks | P0 |
| `focus` sobre Task DONE → 409 | guard de estado | P1 |
| `accept-goal` sobre Note sin Task → crea Task | happy path | P0 |
| `accept-goal` sobre Note con Task → 409 | UNIQUE violation manejada | P1 |
| migración backfill: counts cuadran | smoke post-migración | P0 |

### Snapshot tests de contratos API

**Recomendado** para `/api/today` y `/api/notes/[id]` antes/después del refactor.
Captura el response shape actual (con `status`/`dueDate` en Note), aplica el
refactor, actualiza snapshots, verifica que el frontend consume el nuevo
shape. **P1** — no bloqueante pero evita regresiones de shape en el Dashboard
(que es 750 líneas y frágil).

---

## 6. Riesgos técnicos ordenados por severidad

### P0 (bloquean ship)

1. **Migración de ENUM Postgres pierde datos**. Si el `CASE` del backfill
   mapea mal un `status` (ej. `IN_PROGRESS`→`DRAFT` en vez de `ACTIVE`), el
   usuario pierde visibilidad de su tarea en foco.
   **Mitigación**: dry-run en Supabase branch → script de validación de counts
   (§1.6) → solo aplicar a main DB si cuadran. Snapshot/restore listo.

2. **`/api/today` 100% roto**. Hoy 3 queries sobre `Note.status`. Tras split
   deben ir a `Task`. Si se olvida una, el Dashboard muestra vacío o error.
   **Mitigación**: reescribir las 3 queries en una PR atómica + test E2E que
   verifique que today devuelve la Task migrada desde una `IN_PROGRESS`.

3. **E2E no compilan** (enum viejo). Bloquea CI.
   **Mitigación**: factorías (§5) en la misma PR que el schema.

4. **REGISTROS sin tx** (bug latente actual). Hoy `createTransaction` +
   `deleteMany` no son atómicos. El refactor es excusa para arreglarlo.
   **Mitigación**: envolver en `$transaction` en la PR de process route.

### P1 (deberían arreglarse antes de ship, no bloquean)

5. **`Dashboard` (~750 líneas, ~10 refs 🔴)**. Reescribir referencias a
   `note.status`/`note.dueDate`/`note.isImportant` → `task.*`. Riesgo de
   regression visual/funcional alto por tamaño del archivo.
   **Mitigación**: extraer tipos `NoteItem`/`NoteDraft` a `lib/types/` (ya
   detectado en explore: 4 interfaces duplicadas) + snapshot tests.

6. **`NOTE_SELECT` compartido en `lib/hubs.ts`**. Incluye `status`/`dueDate`/
   `isImportant` que dejan de existir en Note. Todos los que lo importan rompen.
   **Mitigación**: dividir en `NOTE_SELECT` (sin campos de Task) +
   `TASK_SELECT`. Actualizar todos los imports en una pasada.

7. **`completedAt` CHECK constraint requiere raw SQL**. Prisma no lo genera.
   **Mitigación**: migration SQL a mano + comentario en schema.prisma
   (`@@check` no existe, documentar en `// CHECK completedAt`).

8. **Partial unique index de foco**. Si no se añade, el invariante depende
   solo de app. **Mitigación**: incluirlo en migration 001.

### P2 (mejoras, pueden esperar)

9. **No hay UI de "promover Note a Task manualmente"**. Si AI falla
   clasificación, el usuario no puede corregir. **Mitigación**: acción
   manual en una iteración posterior (§7.1).

10. **Soft-delete ausente**. Borrar Note borra Task en cascade. Si se quiere
    papelera, otro refactor. **Mitigación**: ninguna ahora; documentar decisión.

11. **`/api/notes` response shape cambia**. Sin clientes externos, OK. Si
    aparecen, añadir capa de compat. **Mitigación**: documentar en ADR.

---

## 7. Preguntas abiertas

### Bloqueantes para spec (deben resolverse antes de `brain-spec`)

1. **¿Una Note `ACTIVE` actual con `dueDate` o `isImportant` genera Task en la
   migración?** (§1.6)
   - **Mi recomendación: SÍ**. Sin esto, el usuario pierde tareas que veía en
     today → regresión visible. Pero implica que "ACTIVE = conocimiento puro"
     se relaja a "ACTIVE = conocimiento, algunos con Task asociada".
   - **Impacto si no se decide**: no se puede escribir el script de backfill
     ni el test de counts. Bloquea migration 001.

2. **¿`/api/notes` incluye la Task anidada por defecto, o el frontend pide
   `/api/tasks` por separado?** (§3)
   - **Mi recomendación**: `/api/notes` devuelve Note sola; el Dashboard hace
     dos fetches (`/api/notes` + `/api/tasks`) o un endpoint compuesto
     `/api/today` ya los une. Evita acoplar Note con Task en el contrato de
     notes (coherente con el split).
   - **Impacto**: define el shape del response y cómo se reescribe el
     Dashboard. Bloquea spec de API.

### Pueden esperar a design

3. **¿Acción manual "convertir Note en Task"?** (§1.4, §7.1) Útil cuando AI
   falla. No bloquea el refactor; se añade como feature después.

4. **¿`accept-goal` sobre Note que ya tiene Task devuelve 409 o hace
   upsert/update?** (§1.2) Recomiendo 409 (no upsert, preserva 1:1). Bajo
   impacto, decisión de UX.

---

## Context Map

- **Memoria ai-brain** (recall `Note Task split`): registro "Phase 1: Note/Task
  schema split decisions" confirma las 7 decisiones cerradas + nota que
  `prisma migrate dev` no auto-splitea ENUM (necesita SQL manual) + 17 archivos
  rompen + `NOTE_SELECT` es bottleneck + 4 `interface Note` duplicadas →
  consolidar en `lib/types/`.
- **Schema actual** (`prisma/schema.prisma` líneas 43–64): `Note` con
  `status NoteStatus` (5 valores), `dueDate`, `isImportant`, `embedding vector`,
  `suggestedGoals String[]`. Sin modelo Task. `NoteRelationship` ya cascadea.
- **`/api/notes/[id]/process`**: confirma patrón CAS (`updateMany`/`deleteMany`
  con `status='DRAFT'`), branch REGISTROS borra Note tras crear entidad
  estructurada, fallback a `enrichDraftNote` para el resto de dominios.
- **`/api/today`**: confirma 3 queries sobre `Note` con `status IN ('ACTIVE',
  'IN_PROGRESS')` + `domain='PROYECTOS'` + `dueDate` range. `focusTask` usa
  `status='IN_PROGRESS'` exactamente. 100% se mueve a `Task`.

## Exploration Angles (para la siguiente fase, brain-spec)

No se necesita más exploración de codebase. Spec debe:
1. Definir el schema Prisma final de `Task` + `Note` (con `noteStatus` rename).
2. Especificar los 4 endpoints afectados (`/api/notes/[id]/process`,
   `/api/today`, `/api/notes/[id]/accept-goal`, nuevo `/api/tasks/[id]/focus`).
3. Escribir las 2 migrations Prisma + script de backfill TS con validación.
4. Definir `NOTE_SELECT` / `TASK_SELECT` y `lib/types/` (NoteItem, NoteDraft,
   TaskItem).
5. Listar los archivos a tocar con el cambio exacto esperado por archivo
   (inventario ya existe en explore; spec lo refina a nivel de contrato).

---

## Result Contract

- **Fase**: brain-deep-think (Fase 0)
- **Status**: `done`
- **Artefacto**: `docs/sdd/active/refactor-note-task-split/deep-think.md`
- **Insumos consumidos**: `prisma/schema.prisma`, `app/api/notes/[id]/process/route.ts`, `app/api/today/route.ts`, memoria ai-brain (registro "Phase 1").
- **Insumos producidos para la siguiente fase**: 7 secciones de bordes/transacciones/rollout/validaciones/tests/riesgos/preguntas. 2 preguntas bloqueantes marcadas para resolver antes de spec.
- **Próxima fase**: `brain-spec` (no `brain-explore` — la exploración ya está completa y este análisis la construye).
- **Riesgos top para el orchestrator**:
  1. **P0** — Migración de ENUM Postgres puede perder datos si el backfall mapea mal `status` (mitigar con dry-run + validación de counts).
  2. **P0** — `/api/today` 100% roto (3 queries sobre Note.status → deben ir a Task).
  3. **P1** — `Dashboard` 750 líneas con ~10 refs 🔴, riesgo de regression alto (mitigar con tipos extraídos + snapshots).
  4. **P1** — Bug latente actual: REGISTROS no es atómico (createTransaction + deleteMany fuera de tx) — arreglar en esta pasada.