# ADR 0001: Split Note → Note + Task

**Estado**: Aceptado
**Fecha**: 2026-07-08
**Decisión**: Separar el modelo `Note` monolítico en `Note` (conocimiento) + `Task` (acción ejecutable).

## Contexto

El modelo `Note` contenía campos de "conocimiento" (título, contenido, tags, embedding) y de "tarea" (status, dueDate, isImportant) mezclados. Esto causaba:
- Polimorfismo en `Note.status` (5 valores: DRAFT, NEEDS_REVIEW, ACTIVE, IN_PROGRESS, DONE) que mezclaba estados de workflow con estados de ejecución.
- Queries ambiguas en `/api/today` (3 queries sobre `Note` con filtros de status + domain + dueDate).
- UI del Dashboard que leía `note.status` para decidir si mostrar foco/check/prioridad.

## Decisiones cerradas

1. **Split 1:1 opcional**: `Note` tiene `Task?` (opcional). No todas las Notes generan Task (solo las ejecutables).
2. **`Task.noteId` UNIQUE con `onDelete: Cascade`**: borrar Note borra Task (sin huérfanas).
3. **`focusedAt` nullable, partial unique index**: `CREATE UNIQUE INDEX Task_one_focus_per_user ON Task(userId) WHERE focusedAt IS NOT NULL`. Máximo 1 foco por usuario.
4. **`completedAt` almacenado con CHECK constraint**: `CHECK (status <> 'DONE' OR completedAt IS NOT NULL)`.
5. **`status`/`dueDate`/`isImportant` viven en Task**: Note ya no tiene estos campos.
6. **`/api/today` renombrado a `/api/dashboard`**: 6 secciones en una sola response.
7. **NotePanel: 2 PATCH paralelos**: `PATCH /api/notes/[id]` para Note, `PATCH /api/tasks/[id]` para Task. Con `Promise.allSettled` y rollback independiente.
8. **`accept-goal`: 409 si Task existe** (no upsert). Preserva 1:1.
9. **REGISTROS envuelto en `$transaction`**: arregla bug latente (createTransaction + deleteNote no era atómico).
10. **Big-bang sin feature flag**: no hay clientes externos ni múltiples usuarios.
11. **Embedding se queda en Note**: no se mueve a tabla satélite.
12. **`hasTask` calculado con `task: { select: { id: true } }`**: sin payload completo.

## Consecuencias

- **Positivo**: Separación clara de responsabilidades. `/api/dashboard` consulta solo `Task` (performance). UI más simple (foco/completar/prioridad son operaciones sobre Task).
- **Negativo**: 2 PATCH en NotePanel (latencia doble, aunque en práctica no se nota). Migración de ENUM Postgres requiere 2 migrations + script de backfill.
- **Riesgos mitigados**: Race condition en foco → partial unique index. REGISTROS no atómico → `$transaction`.

## Alternativas consideradas

- **No split**: mantener el modelo monolítico. Rechazado por ambigüedad semántica creciente.
- **Task con FK nullable**: permitir Task sin Note (huérfanas). Rechazado porque Task sin Note no tiene sentido.
- **Upsert en accept-goal**: si Task existe, actualizarla. Rechazado porque rompe 1:1 (dos goals → misma Task).
