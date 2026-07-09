# OpenWiki Update Plan

## Recent source changes (since ecf8383738bd9b31622a22ce4d0b7c30b5e92316)

### Major architectural changes

1. **Note + Task split** (commit `2df8424`, "refactor(db): split Note into Note + Task"):
   - New model `Task` (1:1 with Note, holds dueDate/isImportant/focusedAt/completedAt/status)
   - New enum `TaskStatus = OPEN | DONE`
   - Reduced enum `NoteStatusNew = DRAFT | NEEDS_REVIEW | ACTIVE` (replaces legacy `NoteStatus`)
   - Note loses legacy fields (status, dueDate, isImportant)
   - Migration A adds noteStatus + Task table; Migration B drops legacy fields, adds constraints (CHECK completedAt if DONE, partial unique one_focus_per_user), renames NoteStatusNew → NoteStatus
   - Backfill script `prisma/backfill-notes-to-tasks.ts`
   - Endpoints added: `app/api/tasks/[id]/{route,focus,unfocus,complete}.ts`
   - On Today, sections are now driven by Tasks (not Notes).

2. **Project engine** (commits introducing `app/api/projects/`, `lib/projects.ts`, `components/ProjectBadge.tsx`):
   - New model `Project` with `ProjectStatus` enum (IDEATION | ACTIVE | MAINTENANCE | ARCHIVED)
   - Note.projectId optional FK with `onDelete: SetNull`
   - DAG of transitions in `lib/projects.ts::PROJECT_TRANSITIONS` + `validateTransition`
   - Endpoints added: `app/api/projects/route.ts`, `app/api/projects/[id]/route.ts`
   - `ProjectBadge` UI component used in Today items
   - SDD completed at `docs/sdd/completed/projects-engine/`

3. **`/api/today` removed, replaced by `/api/dashboard`** (commit `91b363f`):
   - `app/api/dashboard/route.ts` is the new source of truth for the Today dashboard
   - Returns `TodayItem[]` with both `task` and `note` objects (and `project` brief)
   - Frontend `app/(app)/page.tsx` now fetches `/api/dashboard`

4. **NoteRelationship metadata** (migration `20260709120000`):
   - New enum `NoteRelationshipType` (RELATED/SUPPORTS/CONTRADICTS/EXAMPLE_OF/CONTINUES/RELATED_PROJECT/REFERENCES)
   - New columns `relationshipType` + `reason` on `NoteRelationship`
   - LLM reranker in `lib/parse-capture.ts` (`RERANK_SYSTEM_PROMPT`, `RERANK_RESPONSE_SCHEMA`, `rerankNoteRelationships`)

5. **Parse-capture LLM intent classification** (Commit `2df8424`):
   - New field `intent ∈ {task, knowledge, reflection}` in ParsedCapture / RESPONSE_SCHEMA
   - Drives whether to create a Note+Task or just a Note

6. **Type modules** (`lib/types/{api,capture,note,task,project}.ts`):
   - Single source of truth for `NoteItem`, `TaskItem`, `ProjectItem`, `ApiResponse<T>`, `ParsedCapture` etc.

7. **Rate limiter** (`lib/rate-limit.ts`):
   - In-memory `Map`-based limiter for sensitive endpoints (used by /api/projects)
   - Documented ponytail: swap to Redis/KV for multi-instance.

8. **Legacy `enrichDraftNote`** moved to `lib/legacy/enrich-draft-note.ts` (deprecated).

9. **Tests** (`tests/unit/`, `tests/helpers/factories.ts`, `tests/helpers/test-setup.ts`, `vitest.config.ts`):
   - Vitest unit tests for `lib/projects.ts`, `hubs.ts`, `focus`, smoke
   - Test factories (`createNote`, `createNoteWithTask`, `createFocusedTask`, `createProject`, `cleanupTestData`)
   - New `pnpm test:unit` and `pnpm test` scripts

10. **Migration / Account model** added later (was earlier in `20260701061145`):
   - `prisma/migrations/20260701061145_add_account_model/migration.sql` modified locally (re-apply?)

11. **Responsive audit** (`docs/sdd/completed/responsive-audit-layout/`):
    - `app/(app)/layout.tsx` paddings responsive
    - `app/(app)/page.tsx` skeleton + greeting + subscription prompt responsive

### New / removed files
- NEW: app/api/projects/{route, [id]/route}.ts, app/api/dashboard/route.ts
- NEW: app/api/tasks/[id]/{route,focus,unfocus,complete}/route.ts
- NEW: lib/{projects,rate-limit}.ts, lib/types/{api,capture,note,task,project}.ts
- NEW: lib/legacy/enrich-draft-note.ts, prisma/backfill-notes-to-tasks.ts
- NEW: components/ProjectBadge.tsx, vitest.config.ts
- NEW: prisma/migrations/20260708120000, 20260708120100, 20260709120000, 20260709130000
- NEW: docs/sdd/completed/{projects-engine,responsive-audit-layout}/
- NEW: tests/helpers/{factories,test-setup}.ts, tests/unit/{projects,hubs,focus,smoke}.test.ts
- DEL:  app/api/today/route.ts
- DEL:  test-results/ux-walkthrough/* (UX walkthrough screenshots stale)
- DEL:  tests/ helpers (replaced)

### Repository doc changes
- README.md — updated to mention Note + Task model and link to ADR
- AGENTS.md — adds nextjs-agent-rules section above (already there)
- CLAUDE.md — OpenWiki section present

## Docs impact plan

### Pages to update

| Page | Reason |
|------|--------|
| `openwiki/quickstart.md` | Today dashboard now driven by Tasks; brand-line should still hold. /api/today mentioned but deleted. |
| `openwiki/architecture.md` | API route list: add /api/projects, /api/tasks, /api/dashboard, /api/capture → superset of /api/notes; remove /api/today. New helper modules (lib/projects.ts, lib/rate-limit.ts, lib/types/). Selectors in lib/hubs.ts. |
| `openwiki/auth-and-data.md` | Schema: add Task, Project, NoteStatus split. Migrations list extends. NoteRelationshipType enum + columns. New error shapes (InvalidProjectIdError). |
| `openwiki/hubs-and-domains.md` | Today dashboard sections now Task-driven. Project badge rendered. The "Maintenance/Today/Focus only PROYECTOS" still true but via Task now. |
| `openwiki/capture-and-ai.md` | Intent classification (task/knowledge/reflection). Note+Task creation (vs Note-only). REGISTROS path now deletes the Note CAS-gated inside the same transaction. LLM reranker (NoteRelationshipType + confidence 0.65 min). |
| `openwiki/testing-and-operations.md` | Vitest added (test:unit, test). Factory helpers. /api/today removed. Test snapshots file references. |
| `openwiki/ui-and-theme.md` | New ProjectBadge component. Responsive paddings (responsive-audit-layout). |

### Pages NOT updated
- `openwiki/registros.md` — no changes (capture branches still go through parse-capture but the structure described there is unaffected). UNLESS the notes carry a `project` now but that doesn't change the registros data model.
