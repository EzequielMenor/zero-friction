# Fixes Applied — Judgment Day Surgical Fix

**Sesión**: `refactor-note-task-split-2026-07-08`
**Agente**: `jd-fix-agent`
**Timestamp**: 2026-07-08
**Jueces**: Judge A + Judge B (consolidated)

---

## P0 — MUST FIX (aplicados)

### FIX-1: Pipeline de migración pierde `noteStatus` UPDATE
- **Archivo**: `spec.md` §4.3
- **Cambio**: Añadido paso (B.5) — `UPDATE "Note" SET "noteStatus" = CASE status::text...` ANTES de crear Tasks. Documentado que `projected['ACTIVE_qualified']` se computa vía `prisma.note.count({ where: { status: 'ACTIVE', OR: [...] } })`.
- **Validación**: El dry-run ahora muestra la proyección de Tasks con el count correcto.

### FIX-2: `/api/dashboard` pierde 3 features del `/api/today`
- **Archivos**: `spec.md` §2.4, `design.md` §3.2
- **Cambio**: `DashboardResponse` expandido a 6 secciones: `focusTask`, `todayTasks`, `maintenanceTasks`, `habits`, `dueSubscription`, `resurgenceNote`. Queries Prisma documentadas en design §3.2 con 5 queries en `Promise.all`. Habits y Subscription mantienen sus queries originales (sin tocar).

### FIX-3: `/api/capture` y `lib/parse-capture.ts` fuera del blast radius
- **Archivos**: `spec.md` §5, `design.md` §2
- **Cambio**: Ambos añadidos como 🔴 al blast radius en spec §5 con contrato documentado. En design §2, incluidos explícitamente en Batch 4a (API routes + lib). `lib/parse-capture.ts`: raw SQL `WHERE noteStatus='ACTIVE'` (era `status='ACTIVE'`).

### FIX-4: Contradicción spec §2.4 vs design §3.3 sobre rename
- **Archivo**: `spec.md` §2.4
- **Cambio**: Título cambiado a `GET /api/dashboard (renombrado desde /api/today)`. Nota "Updated per design §3.3". Path `/api/today` se elimina sin compatibilidad. DoD actualizado.

---

## P1 — SHOULD FIX (aplicados)

### FIX-5: NoteRelationship spec mismatch con schema real
- **Archivo**: `spec.md` §1.5
- **Cambio**: Modelo reemplazado con el schema real (`sourceNoteId`/`targetNoteId`/`similarity`/`isManual`). Nombres de relación en Note (§1.3) actualizados a `@relation("SourceNote")` y `@relation("TargetNote")`.

### FIX-6: `title` nullable vs NOT NULL
- **Archivos**: `spec.md` §1.3, §2.1, §3.1; `design.md` §6.1
- **Cambio**: `title String?` → `title String` en todos los modelos/types. `NoteItem.title: string` (no `string | null`). Factory defaults: `title: input.title ?? ''`. Nota: fallback UI `note.title || 'Sin título'` se hace en frontend.

### FIX-7: `hasTask` strategy
- **Archivo**: `spec.md` §2.1, §2.4
- **Cambio**: Definido `NOTE_SELECT_WITH_TASK_FLAG` con `task: { select: { id: true } }` y `hasTask = Boolean(note.task)`. Documentado cuándo usarlo (hubs/search/notes lista) y cuándo no (Inbox solo DRAFTs).

### FIX-8: Validación post-backfill con variable inexistente
- **Archivo**: `spec.md` §4.3
- **Cambio**: `projected['ACTIVE_qualified']` ahora se computa explícitamente en dry-run vía `prisma.note.count({ where: { status: 'ACTIVE', OR: [...] } })`. La validación post ya era correcta (referenciaba `ACTIVE_qualified`), ahora el dry-run la computa.

### FIX-9: Batch 4 demasiado grande
- **Archivo**: `design.md` §2
- **Cambio**: Split en Batch 4a (API routes + lib) y Batch 4b (componentes UI). Batch 4a puede mergear y testearse con tests de API. Batch 4b consume endpoints ya estables. Referencias en batches posteriores (5-9) y risks actualizadas.

### FIX-10: `enrichDraftNote` no puede envolverse en `$transaction` sin reestructurar
- **Archivo**: `spec.md` §2.3
- **Cambio**: Documentado flujo tripartito: (1) pre-tx: LLM call (embedding + relationships, idempotente), (2) tx: `note.updateMany CAS DRAFT→ACTIVE` + `task.create` opcional, (3) post-tx: escribir embedding + crear NoteRelationships.

### FIX-11: `accept-goal` breaking change no documentado
- **Archivo**: `spec.md` §2.3
- **Cambio**: Añadido bloque "⚠️ BREAKING CHANGE (accept-goal, requiere migración de UI)" con explicación del cambio semántico (crear Task en vez de Note nueva), impacto en frontend y tests E2E.

### FIX-12: Backfill script sin idempotencia robusta
- **Archivo**: `spec.md` §4.3
- **Cambio**: Añadido flag `--resume` que salta Notes con Task existente. Pre-check modificado para aceptar `--resume` cuando `existingTasks !== 0`. Documentada recuperación manual (`DELETE FROM "Task"` + re-run). Comandos actualizados.

---

## P2 — NICE TO HAVE (aplicados los cortos)

### FIX-13: `prisma/seed.ts` ownership
- **Archivo**: `design.md` §2 (Batch 4a)
- **Cambio**: Añadida línea: "Batch 4a incluye verificar/actualizar `prisma/seed.ts` si usa campos viejos".

### FIX-14: `/api/search` shape ambiguity
- **Archivo**: `spec.md` §5 (blast radius, 🟡)
- **Cambio**: Decisión explícita: search devuelve Note con `task: { select: { id, isImportant, dueDate, status } }` anidada. Mapear a `NoteItem` con `hasTask = Boolean(note.task)`.

### FIX-15: Test factories con cuid()
- **Archivo**: `design.md` §6.1
- **Cambio**: `randomBytes(12).toString('hex')` → `createId()` de paquete `cuid`. Tambien corregido `title` default de `null` a `''` (consecuencia de FIX-6).

### FIX-16: N+1 en habits
- **Archivo**: `design.md` §3.2
- **Cambio**: Documentada optimización: `habitLog.findMany({ where: { habitId: { in: habitIds }, date: { gte: startOfToday } } })` + agrupar en `Set` para `completedToday`. Evita N consultas (una por hábito).

---

## Validación final

- Coherencia spec ↔ design: ✅ sin contradicciones
- Rename `/api/today` → `/api/dashboard`: ✅ consistente en ambos documentos
- Secciones del dashboard: ✅ 6 secciones sincronizadas spec §2.4 ↔ design §3.2
- `title` NOT NULL: ✅ consistente en schema, tipos, y factories
- Blast radius: ✅ 22 archivos 🔴 (incluye `/api/capture`, `lib/parse-capture.ts`, `app/api/dashboard/route.ts`)
- Backfill script: ✅ flujo completo (noteStatus UPDATE + Tasks + --resume + recovery)

---

## Sin resolver / riesgos residuales

- **deep-think.md** no fue modificado (per instrucción explícita: "it's solid per judges"). Las referencias a `/api/today` en deep-think.md son históricas (contexto de la fase 0). El orchestrator debe decidir si actualizarlas en una futura iteración.
- **FIX-2 (habits en dashboard)**: la optimización N+1 está documentada pero no hay tests unitarios específicos para este refactor en habits. Queda a discreción del implementador.
