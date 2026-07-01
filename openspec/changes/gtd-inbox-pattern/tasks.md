# Tasks: GTD Inbox Pattern — Decouple Capture from AI Processing

## Review Workload Forecast

Decision needed before apply: No
Chained PRs recommended: Yes
Chain strategy: stacked-to-main
400-line budget risk: High

Estimated ~690 lines across 3 stacked PRs. Each PR ≤400.

| Unit | Scope | PR | Lines |
|------|-------|----|-------|
| 1 | Lib extraction (pure refactor) | PR 1 → main | ~250 |
| 2 | New API routes | PR 2 → main | ~150 |
| 3 | Frontend + e2e | PR 3 → main | ~290 |

## PR 1 — Lib Extraction (`chore/gtd-inbox-pr1-lib`)

| Field | Value |
|-------|-------|
| Chain | gtd-inbox-pattern |
| Position | 1 of 3 |
| Depends on | None |
| Follow-up | PR 2 |
| Review budget | ~250 / 400 |

```text
main ← 📍 PR 1: lib extraction
          └── PR 2: new routes
               └── PR 3: frontend
```

- [x] 1.1 `lib/parse-capture.ts` — export `ParsedCapture` type, `runCaptureChatCompletion()`, `createEmbedding()`, `createNoteWithRelations()` (CREATE), `enrichDraftNote()` (UPDATE + CAS via `updateMany`), `findSimilarNotes()`, `createRelationships()`. Add `RESPONSE_SCHEMA`, `SYSTEM_PROMPT`, `USER_PROMPT`. No behavior change.
- [x] 1.2 `app/api/capture/route.ts` — import lib functions, remove inline copies. RecordType branching (`saveTransaction`, `saveHabitLog`, `saveWorkoutDraft`) stays inline.

**Verify**: `tsc --noEmit` passes. Existing e2e unchanged.

## PR 2 — New Routes (`chore/gtd-inbox-pr2-routes`)

| Field | Value |
|-------|-------|
| Chain | gtd-inbox-pattern |
| Position | 2 of 3 |
| Depends on | PR 1 |
| Follow-up | PR 3 |
| Review budget | ~150 / 400 |

```text
main ← PR 1: lib extraction
     ← 📍 PR 2: new routes
          └── PR 3: frontend
```

- [x] 2.1 `app/api/notes/route.ts` — `POST`: `cookies()`+`verifySession()` auth → validate `{text}` non-empty → `prisma.note.create({status:'DRAFT',domain:'REGISTROS',title:text.slice(0,80),content:text,userId})` → 201 `{id,title,status,createdAt}`. `GET?status=DRAFT`: auth → `findMany({where:{userId,status},orderBy:{createdAt:'desc'}})` → 200 `Note[]`. 401 on unauth.
- [x] 2.2 `app/api/notes/[id]/process/route.ts` — `POST`: auth → `findFirst({id,userId})` (404 if missing) → status guard (409 if !==DRAFT) → `runCaptureChatCompletion()` → `enrichDraftNote()` → CAS fail = 200 `{alreadyProcessed:true}`. AI error = 502/504. Success = 200 `{note}`.

**Verify**: `tsc --noEmit`. Manual curl confirms POST 201, GET 200, process 200/502/504.

## PR 3 — Frontend + E2E (`chore/gtd-inbox-pr3-frontend`)

| Field | Value |
|-------|-------|
| Chain | gtd-inbox-pattern |
| Position | 3 of 3 |
| Depends on | PR 2 |
| Review budget | ~290 / 400 |

```text
main ← PR 1: lib extraction
     ← PR 2: new routes
     ← 📍 PR 3: frontend
```

Covers: **inbox-capture** (instant save, empty reject, errors, zf:draft), **inbox-dashboard** (list drafts, zf:draft prepend, per-card states, Procesar todo, strict TS), **inbox-processing** (e2e only).

- [x] 3.1 `CaptureOverlay.tsx` — `submit()` calls `POST /api/notes`; emits single `zf:draft {noteId}` (no two-phase pending/resolved). On error: modal stays open with message; no draft created. Empty-text client guard unchanged.
- [x] 3.2 `components/InboxSection.tsx` — mount fetch `GET /api/notes?status=DRAFT`. `zf:draft` listener prepends single note via `GET /api/notes/[id]` (dedup). Empty state "Inbox vacío". Per-card states: `idle→loading→success`(toast+remove)/`error`(red warning+Reintentar). "Procesar todo" sequential for-of. `data-testid` on cards, button, empty. Zero `any`, no sync setState in useEffect.
- [x] 3.3 `app/(app)/page.tsx` — import InboxSection, render above TAREAS DE HOY. Remove old draft listener (lines 317–385) + `DraftEvent`/`TempNote` types.
- [x] 3.4 `tests/e2e.spec.ts` — add test: capture→inbox card→"Procesar con IA"→200→card removed→toast. Add test: AI error (intercept 502)→red warning+Reintentar stays visible.

**Verify**: `tsc --noEmit`. `npx playwright test` passes both new scenarios.
