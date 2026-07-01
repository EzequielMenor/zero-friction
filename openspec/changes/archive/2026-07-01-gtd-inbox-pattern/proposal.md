# Proposal: GTD Inbox Pattern — Decouple Capture from AI Processing

## Intent

Today `CaptureOverlay.tsx` calls `POST /api/capture` which runs OpenAI synchronously (5–15s). The modal freezes with zero feedback on slowness or error. We apply the GTD Inbox mental model: **capture is instant, processing is async and user-triggered**. Capture saves a DRAFT note (no AI), modal closes immediately. The Dashboard shows an Inbox where users decide when to process each draft.

## Scope

### In Scope
- `POST /api/notes` — instant DRAFT save (auth, validate, `prisma.note.create`, return 201)
- `POST /api/notes/[id]/process` — AI processing endpoint (classification, embedding, relationships → status ACTIVE)
- Extract `lib/parse-capture.ts` from current 387-line capture route
- `CaptureOverlay.tsx` refactor: call new endpoint, close instantly, emit `zf:draft`
- Dashboard "📥 Inbox" section: list DRAFT notes, per-card "Procesar con IA" + global "✨ Procesar todo"
- Per-card states: idle → "Procesando con IA..." (spinner) → success toast + remove / error stays DRAFT + red warning
- Playwright e2e: capture → inbox appears → process → active note; AI-failure preserves data

### Out of Scope
- Workouts, transactions, habit capture (existing routes untouched)
- Polling, SSE, WebSockets for processing status
- NEEDS_REVIEW promotion (stays DRAFT on failure)
- Embeddings context / pgvector changes

## Capabilities

### New Capabilities
- `inbox-capture`: instant note creation with DRAFT status, no AI dependency
- `inbox-processing`: async AI enrichment of DRAFT notes via dedicated endpoint
- `inbox-dashboard`: Inbox UI section listing DRAFT notes with process/retry controls

### Modified Capabilities
None — `openspec/specs/` is empty. This is the first SDD change with specs.

## Approach

**Approach 1** from exploration: new REST-aligned routes + shared lib extraction.

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Draft endpoint | `POST /api/notes` | Resource-aligned with existing `[id]/route.ts` |
| Processing endpoint | `POST /api/notes/[id]/process` | Cleaner than overloading `/api/capture`; reuses extracted lib |
| Dashboard data | `GET /api/notes?status=DRAFT` | Separate fetch avoids polluting `/api/today` shape |
| AI failure | Stay DRAFT + red warning card | User data never deleted; NEEDS_REVIEW reserved for human curation |
| Processing UX | Synchronous POST, 10s timeout, "Reintentar" on failure | Simplest that works; no polling/SSE infrastructure |

`lib/parse-capture.ts` extracts `parseCaptureInput`, `runAIClassification`, `createNoteWithRelations` from current capture route. Both `/api/capture` and `/api/notes/[id]/process` become thin wrappers around it.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `app/api/notes/route.ts` | **New** | `POST` handler for instant DRAFT save |
| `app/api/notes/[id]/process/route.ts` | **New** | AI processing endpoint |
| `lib/parse-capture.ts` | **New** | Extracted from `app/api/capture/route.ts` |
| `app/api/capture/route.ts` | **Modified** | Refactored to use shared lib |
| `components/CaptureOverlay.tsx` | **Modified** | `submit()` → `POST /api/notes`; instant close |
| `app/(app)/page.tsx` | **Modified** | Inbox section, process/retry handlers, draft listener rewrite |
| `tests/e2e.spec.ts` | **Modified** | Inbox → process flow coverage |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Dashboard draft listener (lines 317–385) assumes inline resolution; rewrite may regress today-task UX | Medium | Extract inbox logic into separate component; keep today-task listener intact |
| Processing endpoint hits OpenAI timeout (same as today) but per-card UX stays interactive | Low | 10s frontend timeout; card shows "Reintentar"; no modal freeze |
| No unit test runner — e2e only covers happy path | Medium | e2e test covers error case explicitly; add smoke test for draft creation |
| `/api/capture` backward compat broken by lib extraction | Low | Existing route kept working; extraction is pure refactor with same behavior |

## Rollback Plan

- `POST /api/notes` and processing route are additive — delete files to roll back
- `CaptureOverlay.tsx` revert: restore `submit()` to call `/api/capture` directly
- Dashboard: remove Inbox section component, restore old draft listener
- Lib extraction: keep old capture route code; roll back file-by-file

## Dependencies

- OpenAI API key (existing) — no changes needed
- Prisma schema — no migrations required (DRAFT/ACTIVE already in enum)

## Success Criteria

- [ ] Capture: type text → submit → overlay closes in <300ms with note saved as DRAFT
- [ ] Inbox: DRAFT notes appear in Dashboard "📥 Inbox" section at page load and on new draft event
- [ ] Process: click "Procesar con IA" → spinner → toast "Guardado en Hub [Dominio]" → note removed from Inbox
- [ ] AI failure: note stays in Inbox with red warning text and "Reintentar" button
- [ ] "Procesar todo": processes all drafts sequentially, success/error per card
- [ ] TypeScript: strict mode, zero `any`, zero `useEffect` with synchronous `setState`
- [ ] e2e test passes: full capture → inbox → process → verify active flow
