## Exploration: GTD Inbox Pattern — Decouple Capture from AI Processing

### Current State

Today, `CaptureOverlay.tsx` calls `POST /api/capture` which does **everything synchronously** in one request:
1. Audio transcription (Whisper, if voice input)
2. OpenAI Chat Completion for domain classification, title/content cleaning, metadata extraction, tags
3. Note/Transaction/Habit/Workout creation in DB
4. Embedding creation (OpenAI text-embedding-3-small)
5. pgvector similarity search + relationship creation
6. Response

The frontend has a partial workaround: it fires a `zf:draft` CustomEvent before the fetch (optimistic "pending" card), then a second event after resolution. But if OpenAI is slow (5-15s) or errors, the overlay stays frozen in `submitting: true` state with no recovery path.

The Dashboard already listens for `zf:draft` events but only shows cards in "Tareas de Hoy" and only for `PROYECTOS` domain — everything else gets a toast and the card disappears. There is **no Inbox concept** and **no way to retry failed AI processing**.

### Reality Check vs Brief

| Aspect | Brief says | Actual codebase | Status |
|--------|-----------|----------------|--------|
| `NoteStatus` enum | `'DRAFT'` and `'ACTIVE'` | `DRAFT \| NEEDS_REVIEW \| ACTIVE \| IN_PROGRESS \| DONE` | ✅ both exist |
| `Note.domain` | field exists | `Domain` enum: `ESPIRITUAL \| PERSONAL \| APRENDIZAJE \| PROYECTOS \| REGISTROS` | ✅ exists |
| `POST /api/notes` | "or adjust POST /api/notes" | No `app/api/notes/route.ts` exists — only `[id]/route.ts` | ❌ new route needed |
| `zf:draft` event | "emit zf:draft for Dashboard" | Already used in CaptureOverlay + listened in Dashboard | ✅ already exists |
| Toast pattern | implicit | Local `Toast` component in `page.tsx`, `showToast` via `useState` | ✅ exists |
| `saveWorkoutDraft` precedent | not mentioned | Already creates DRAFT notes for gym workouts (line 227) | ✅ aligns with GTD pattern |
| `/api/today` | not mentioned | Only returns `PROYECTOS` domain, `ACTIVE\|IN_PROGRESS` status | ⚠️ needs update for DRAFT |

### Affected Areas

- `prisma/schema.prisma` — no changes needed (DRAFT + ACTIVE exist, domain exists)
- `app/api/notes/route.ts` — **NEW**: `POST /api/notes` for instant draft save (`status: 'DRAFT'`)
- `app/api/capture/route.ts` — refactor: extract core AI parsing into shared lib function; accept `noteId` for re-processing drafts
- `app/api/notes/[id]/process/route.ts` — **NEW** (or refactor capture): endpoint that runs AI on an existing DRAFT note
- `lib/parse-capture.ts` — **NEW** (optional): shared lib extracting `parseCapture`, `createEmbedding`, `saveNote`, `findSimilarNotes`, `createRelationships` from capture route
- `components/CaptureOverlay.tsx` — change `submit()` to POST `/api/notes` instead of `/api/capture`; adjust event payload
- `app/(app)/page.tsx` — add "📥 Inbox" section above today tasks; handle DRAFT notes with "Procesar con IA" button; loading/error states per card
- `app/api/today/route.ts` — add DRAFT notes to the response (or separate fetch)
- `tests/e2e.spec.ts` — add test for inbox → process → active flow

### Approaches

1. **Minimal: New `POST /api/notes` + refactor `POST /api/notes/[id]/process` — extract shared logic from capture**
   - Pros: Cleanest separation of concerns; `POST /api/notes` is just a `prisma.note.create({ status: 'DRAFT' })` — no AI calls; capture route logic extracted to `lib/parse-capture.ts` for reuse; processing endpoint reuses the same logic; `zf:draft` event schema can stay similar (just with `status: 'DRAFT'` now)
   - Cons: Two new route files; one new lib file; refactoring existing capture route
   - Effort: **Medium** (3-4 new/modified files backend, 2 frontend)

2. **Reuse capture: Add `?draft=true` param to existing `POST /api/capture` + new `PATCH /api/capture/[id]`**
   - Pros: Fewer new files; minimal route changes
   - Cons: `/api/capture` route gets complex conditionals (`if draft ... else ...`); endpoint name doesn't match "notes" resource; awkward REST semantics (capture is a verb, not a resource); harder to discover for future devs
   - Effort: **Low-Medium** (modify 1 route, maybe 1 new)

3. **New resource: `POST /api/inbox` + `POST /api/inbox/[id]/process`**
   - Pros: Cleanest API surface; matches GTD terminology exactly
   - Cons: New resource family separate from the `notes` domain; Dashboard reads notes from multiple sources; duplicates some patterns from existing notes API
   - Effort: **Medium** (2 new route files + frontend)

### Recommendation

**Approach 1** (New `POST /api/notes` + processing route with shared lib). Reasons:

1. Follows existing REST patterns (`/api/notes/[id]` already exists for GET/PATCH)
2. The `POST /api/notes` route is trivially simple — just auth, validate, `prisma.note.create({ status: 'DRAFT' })`, return. No AI, no embeddings, no relationships.
3. Extracting `parseCapture`, `saveNote`, `createEmbedding`, `findSimilarNotes`, `createRelationships` into `lib/parse-capture.ts` is already overdue (ponytail: it's one big route file with ~387 lines — the `saveWorkoutDraft` fn already shows a DRAFT pattern waiting to be extracted)
4. The processing endpoint reuses the same lib functions, just operating on an existing note
5. Only 2 new route files + 1 lib extraction + 2 frontend files changed

### Risks

- **Existing `zf:draft` listener in Dashboard assumes inline resolution** (pending→resolved in seconds). The GTD pattern changes this: DRAFT notes persist until user triggers processing. The Dashboard's draft listener (lines 317-385) currently removes temp cards on fail or non-`PROYECTOS` domain — this logic must be rewritten to handle persistent DRAFT notes.
- **`/api/today` returns only `PROYECTOS` domain** — the Inbox section needs ALL domains. Either the /api/today response gets a new `inboxDrafts` field, or the Dashboard does a separate `/api/notes?status=DRAFT` fetch.
- **No unit test runner** (Playwright e2e only). Cannot write isolated backend tests. The e2e test will need to cover: capture → inbox appears → process AI → active note appears → error case keeps note with warning.
- **Processing endpoint will hit OpenAI timeouts** — same problem as today, but now async. Need frontend loading state per card, not a modal freeze. The backend should probably use a timeout and return 202 Accepted, letting the frontend poll or receive a webhook. For ponytail MVP, a simple POST that waits is acceptable as long as the per-card UI shows spinner + stays interactive.

### Ready for Proposal

Yes — but the orchestrator should tell the user the key design decisions to confirm first:
1. **New route path**: `POST /api/notes` (draft save) vs `POST /api/inbox` vs extending capture
2. **Processing endpoint**: refactor `POST /api/capture` vs new `POST /api/notes/[id]/process`
3. **Dashboard data**: add DRAFT to `/api/today` response vs separate fetch
4. **Error handling**: on AI failure, keep DRAFT note with `NEEDS_REVIEW` status? Or stay DRAFT with a warning flag?
5. **Processing UX**: per-card "Procesando con IA" polling, or fire-and-forget with toast? Synchronous wait (current model) is simpler but reuses the same UX problem.
