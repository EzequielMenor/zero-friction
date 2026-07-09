# Project Engine — Memoria del proyecto

**Proyecto**: zero-friction
**Fase**: 3 (Project Engine)
**Fecha**: 2026-07-09
**Status**: ✅ Completa

## TL;DR

Se añadió un modelo `Project` con ENUM `ProjectStatus` (IDEATION/ACTIVE/MAINTENANCE/ARCHIVED) que agrupa Notes via `Note.projectId` con `onDelete: SetNull` (Second Brain sobrevive al borrar Project). Task NO se modificó (D4) — el project se deriva vía `Task → Note → Project` en JOIN. 4 endpoints nuevos + 3 extendidos. Cascade `SetNull` para Notes (conocimiento sobrevive). DAG de transiciones permite revivir desde ARCHIVED. Path canónico `/api/dashboard` (no `/api/today`). Componente `ProjectBadge` con colores Tailwind estáticos por status. Sin vista dedicada de Projects en MVP (YAGNI, D7).

## Decisiones cerradas

| ID  | Decisión                                                                 |
| --- | ------------------------------------------------------------------------ |
| D1  | ProjectStatus = [IDEATION, ACTIVE, MAINTENANCE, ARCHIVED] con DAG + revive |
| D2  | Note.projectId → onDelete: SetNull (Second Brain sobrevive)              |
| D3  | /api/dashboard global, campo project informativo en items Task           |
| D4  | NO Task.projectId. Derivar vía JOIN (Task → Note → Project)              |
| D5  | Project.userId por consistencia con el resto del schema                  |
| D6  | No soft-delete, no deletedAt                                             |
| D7  | No endpoint por-proyecto en MVP (YAGNI)                                  |

### Fixes design phase
- **C1**: CAS pattern con updateMany + WHERE status para PATCH race-safe
- **C2**: 3 codes separados para invalid_projectId (format/not_found/forbidden)
- **C3**: VALID_STATUSES pre-validate antes de validateTransition (evita TypeError)
- **C4**: DoD check #9 con regex [4][0-9]{2} para 4xx sin ApiError

### Fixes apply phase
- **F1**: NOTE_SELECT_WITH_TASK_FLAG_PROJECT para GET /api/notes/[id]
- **F2**: project sale de TaskWithNote, entra en NoteItem
- **F3**: PATCH sin CAS falso cuando body no tiene status
- **F4**: try/catch + mapPrismaError en todos los handlers de Projects
- **F5**: Rate-limit keys separadas por método HTTP

## Patrones reutilizables

- **3 codes separados para validation errors** (format/not_found/forbidden) en vez de un code con details.reason. Usar para cualquier validación de referencias a entidades externas.
- **CAS pattern con updateMany + count === 0** para PATCH con validación de transición. Útil para cualquier recurso con DAG de estados donde pueda haber race conditions (single-user improbables pero cubiertas).
- **Mapas estáticos de clases Tailwind** (`Record<Status, string>`) para evitar issues de purge con clases dinámicas.
- **Rate-limit keys separadas por método HTTP** (no compartidas entre verbos aunque compartan endpoint). Añadir al checklist de diseño de API.
- **try/catch + mapPrismaError** helper para todos los endpoints nuevos. Mapea P2003→400, P2025→404.

## Anti-patrones detectados

- `tail: process` en `lib/parse-capture.ts` sin un wrapper (detectado en explore, menor). Conviene revisar en próxima fase.
- NUNCA usar `grep` con `--include` para "asegurar" DoD sin validar el contexto completo (el check D4 con grep puede dar falsos positivos si el string aparece en comentarios o strings).
- `wc -l` sobre greps de codes de error subestima si están en la misma línea (un `return` y un `error.code` en distintas líneas cuentan como 2 apariciones).

## Próximas acciones

- Fix pre-existente en `playwright.config.ts` (testDir debe excluir unit/)
- Aplicar `20260709130000_add_project` migration en staging con backup
- Smoke manual con cuenta de staging (13 puntos del verify-checklist)
- Commit + PR con los 7 batches mergeados
