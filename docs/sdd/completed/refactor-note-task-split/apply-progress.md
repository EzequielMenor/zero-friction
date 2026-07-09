# Apply Progress: Refactor Note → Note + Task

**Sesión**: `refactor-note-task-split-2026-07-08`
**Fase**: brain-apply (Fase 5)
**Fecha**: 2026-07-08

---

## Status: done

14 tareas ejecutadas en 7 batches. Todos los GATEs pasados.

---

## Batch B-01: Schema + tipos ✅
- [x] T-01: Prisma schema actualizado (Task model, TaskStatus enum, NoteStatusNew enum, noteStatus en Note, relación task, tasks[] en User). Columnas legacy conservadas.
- [x] T-02: `lib/types/{note,task,capture,api}.ts` creados.
- [x] Validación: `pnpm prisma format`, `pnpm prisma validate`, `pnpm tsc --noEmit`.

## Batch B-02: Backfill script ✅
- [x] T-03: `prisma/backfill-notes-to-tasks.ts` creado con soporte `--dry-run`, `--apply`, `--resume`.
- [x] Validación: script compila.

## Batch B-03: Migration SQL ✅
- [x] T-04: `20260708120000_split_note_task/migration.sql` (Migration A) y `20260708120100_drop_legacy_note_fields/migration.sql` (Migration B) creados.
- [x] Migration A: CREATE TYPE TaskStatus, CREATE TABLE Task, FK+UNIQUE, CREATE TYPE NoteStatusNew, ADD COLUMN noteStatus.
- [x] Migration B: CHECK constraint, índices, partial unique, DROP COLUMN legacy, rename enum.

## Batch B-04a: API + lib ✅
- [x] T-05: 8 endpoints core actualizados/creados:
  - `POST/GET /api/notes` → usa NoteItem (sin campos Task)
  - `PATCH /api/notes/[id]` → solo title/content/tags/domain
  - `POST /api/notes/[id]/process` → flujo tripartito (pre-tx, tx, post-tx)
  - `POST /api/notes/[id]/accept-goal` → crea Task 1:1, P2002 → 409
  - `PATCH /api/tasks/[id]` → NEW (dueDate/isImportant)
  - `POST /api/tasks/[id]/focus` → NEW ($transaction)
  - `POST /api/tasks/[id]/unfocus` → NEW
  - `POST /api/tasks/[id]/complete` → NEW
- [x] T-06: `/api/dashboard` creado (6 secciones), `/api/capture` actualizado, `lib/parse-capture.ts` reescrito.
- [x] `lib/hubs.ts`: NOTE_SELECT_NEW, NOTE_SELECT_WITH_TASK_FLAG, TASK_SELECT, NOTE_SELECT_WITH_TASK.
- [x] Endpoints actualizados: hubs/[domain], search, calendar, graph.
- [x] Validación: `pnpm tsc --noEmit` limpio, greps legacy = 0 en app/api/ y lib/.

## Batch B-04b: UI ✅
- [x] T-07: `NotePanel.tsx` reescrito — 2 PATCH paralelos (Note + Task), tipos de lib/types/.
- [x] T-08: `app/(app)/page.tsx` (Dashboard) reescrito — consume `/api/dashboard`, TodayItem = { task, note }.
- [x] Validación: `pnpm tsc --noEmit` limpio, greps legacy = 0 en components/ y app/.

## Batch B-05: Resto UI ✅
- [x] T-09: `CalendarPage` actualizado — consume `/api/calendar` con shape nuevo.
- [x] T-10: `InboxSection`, `CaptureOverlay`, `HubContent` actualizados.
- [x] Validación: mismos greps limpios.

## Batch B-06: Tests ✅
- [x] T-11: `tests/helpers/factories.ts` creado (createNote, createNoteWithTask, createFocusedTask, createCompletedTask, cleanupTestData).
- [x] T-12: `tests/e2e.spec.ts` reescrito con factorías.
- [x] Validación: `pnpm tsc --noEmit` limpio.

## Batch B-07: Docs + smoke ✅
- [x] T-13: `docs/sdd/active/refactor-note-task-split/ADR.md` creado.
- [x] T-14: `README.md` actualizado con sección de modelo de datos.

---

## Validación final

```bash
pnpm tsc --noEmit     → ✅
grep legacy refs      → ✅ 0 resultados
pnpm prisma format    → ✅
pnpm prisma validate  → ✅
```

---

## Archivos modificados/creados

### Schema
- `prisma/schema.prisma` (modificado)

### Migrations
- `prisma/migrations/20260708120000_split_note_task/migration.sql` (nuevo)
- `prisma/migrations/20260708120100_drop_legacy_note_fields/migration.sql` (nuevo)

### Scripts
- `prisma/backfill-notes-to-tasks.ts` (nuevo)

### Tipos
- `lib/types/note.ts` (nuevo)
- `lib/types/task.ts` (nuevo)
- `lib/types/capture.ts` (nuevo)
- `lib/types/api.ts` (nuevo)

### Lib
- `lib/hubs.ts` (modificado)
- `lib/parse-capture.ts` (modificado)

### API routes
- `app/api/notes/route.ts` (reescrito)
- `app/api/notes/[id]/route.ts` (reescrito)
- `app/api/notes/[id]/process/route.ts` (reescrito)
- `app/api/notes/[id]/accept-goal/route.ts` (reescrito)
- `app/api/tasks/[id]/route.ts` (nuevo)
- `app/api/tasks/[id]/focus/route.ts` (nuevo)
- `app/api/tasks/[id]/unfocus/route.ts` (nuevo)
- `app/api/tasks/[id]/complete/route.ts` (nuevo)
- `app/api/dashboard/route.ts` (nuevo, reemplaza /api/today)
- `app/api/capture/route.ts` (modificado)
- `app/api/hubs/[domain]/route.ts` (modificado)
- `app/api/search/route.ts` (modificado)
- `app/api/calendar/route.ts` (modificado)

### UI
- `components/NotePanel.tsx` (reescrito)
- `components/InboxSection.tsx` (reescrito)
- `components/CaptureOverlay.tsx` (modificado)
- `app/(app)/page.tsx` (reescrito — Dashboard)
- `app/(app)/calendar/page.tsx` (reescrito)
- `app/(app)/hubs/[domain]/HubContent.tsx` (reescrito)

### Tests
- `tests/helpers/factories.ts` (nuevo)
- `tests/e2e.spec.ts` (reescrito)

### Docs
- `docs/sdd/active/refactor-note-task-split/ADR.md` (nuevo)
- `README.md` (modificado)

---

## Próximos pasos

1. **Aplicar Migration A** en staging: `pnpm prisma migrate deploy`
2. **Ejecutar backfill** en staging: `pnpm tsx prisma/backfill-notes-to-tasks.ts --apply`
3. **Validar counts** y spot-check manual de 5 Notes
4. **Aplicar Migration B**: `pnpm prisma migrate deploy`
5. **Actualizar schema.prisma** final (dropear enum NoteStatus viejo, dropear campos legacy, renombrar NoteStatusNew → NoteStatus)
6. **Correr tests E2E** contra staging
7. **Deploy a producción** con snapshot de DB previo

---

## Riesgos

1. **Backfill**: si el CASE mapping está mal, se pierden tareas. Mitigación: dry-run primero.
2. **Migration B**: DROP COLUMN irreversible. Mitigación: snapshot DB pre-deploy.
3. **`/api/dashboard`**: reescritura completa del endpoint más consultado. Mitigación: tests E2E + smoke manual.
4. **`NotePanel` 2 PATCH**: si falla uno, el usuario ve estado inconsistente. Mitigación: `Promise.allSettled` + rollback independiente.
