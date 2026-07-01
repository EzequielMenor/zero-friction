# Design: GTD Inbox Pattern — Decouple Capture from AI Processing

## Technical Approach

Split `POST /api/capture` into two phases: instant DRAFT save (`POST /api/notes`, <300ms, no AI) and user-triggered AI processing (`POST /api/notes/[id]/process`, ≤15s). Extract shared AI logic from `app/api/capture/route.ts` into `lib/parse-capture.ts` as a pure refactor. `CaptureOverlay.submit()` targets `/api/notes`; Dashboard gains `components/InboxSection.tsx` with per-card state machines. The existing capture route and its recordType branching (`saveTransaction`/`saveHabitLog`/`saveWorkoutDraft`) remain untouched.

## Architecture Decisions

| # | Choice | Alternatives | Rationale |
|---|--------|-------------|-----------|
| D1 | DRAFT `domain` = `REGISTROS` at capture time | PERSONAL, nullable migration | Domain enum exists; `REGISTROS` is neutral placeholder. AI reclassifies during processing. No schema migration. |
| D2 | DRAFT `title` = `text.trim().slice(0, 80)` | Full text, hardcoded "Nuevo" | `Note.title` is required (not nullable). Deterministic truncation; AI overwrites `title` + `content` on processing. |
| D3 | Idempotency via CAS (`updateMany` with `status='DRAFT'` guard) | DB transaction, ROW-level lock | `prisma.note.updateMany({where:{id,status:'DRAFT'},data:{...}})` — if count=0, already processed. Embedding write gated by same CAS. |
| D4 | Auth via `cookies()` + `verifySession()` (notes-family pattern) | `req.cookies.get` (capture route style) | Consistency with existing `[id]/route.ts`. Both new routes follow this. |
| D5 | `GET /api/notes?status=DRAFT` in same `route.ts` as `POST` | Separate file for GET | Same resource (`/api/notes`), same file. Follows Next.js route conventions. |
| D6 | AI failure → HTTP 502 (AI_FAILED) or 504 (AI_TIMEOUT) per spec | 200 with `{ok:false}` | Spec SHALL (scenario "AI failure keeps note as DRAFT" requires 502/504). Spec wins over design convenience. |
| D7 | Lib split: `createNoteWithRelations` (CREATE) + `enrichDraftNote` (UPDATE with CAS) | Single function with conditional | Current capture route CREATEs; processing endpoint UPDATEs. Two functions prevent confusing the contract. |
| D8 | RecordType branching (REGISTROS+finanzas/habito/gimnasio) **DEFERRED** to follow-up | Full branching in processing endpoint | Existing `/api/capture` handles this for voice captures. New text-capture flow creates Notes only. DRAFT gym notes from `saveWorkoutDraft` will appear in Inbox but process as regular ACTIVE Notes. Amends inbox-processing spec: Inbox scope is note domains only for this slice. |
| D9 | InboxSection: `zf:draft` prepends single note via `GET /api/notes/[id]`, does NOT refetch list | Full-list refetch | Spec requires: "Inbox fetches and prepends that single note to the top of the list. The rest of the list is not re-rendered or refetched." |

## Data Flow

```
CaptureOverlay        /api/notes              /api/notes/[id]/process        Dashboard/InboxSection
    │                     │                           │                            │
    │─ POST {text} ──────→│                           │                            │
    │                     │─ prisma.note.create       │                            │
    │                     │  {status:DRAFT,            │                            │
    │                     │   domain:REGISTROS,        │                            │
    │                     │   title:text[0:80]}        │                            │
    │←─ 201 {id} ─────────│                           │                            │
    │  close overlay      │                           │                            │
    │                     │                           │                            │
    │─ zf:draft {noteId} ──────────────────────────────────────────────────────────→│
    │                     │                           │     fetch GET /api/notes/[id]
    │                     │                           │     prepend to cards state
    │                     │                           │                            │
    │                     │       User clicks "Procesar con IA"                     │
    │                     │                           │←─ POST ────────────────────│
    │                     │                           │                            │
    │                     │                           │─ findFirst(id,userId)      │
    │                     │                           │─ guard: status != DRAFT → 409
    │                     │                           │─ runCaptureChatCompletion() │
    │                     │                           │─ enrichDraftNote():         │
    │                     │                           │  updateMany(id,status=DRAFT │
    │                     │                           │    → ACTIVE,domain,title,   │
    │                     │                           │    content,tags,embedding)  │
    │                     │                           │  if CAS ok → relationships  │
    │                     │                           │                            │
    │                     │                           │──→ 200 {note} ─────────────→│ toast, remove card
    │                     │                           │                            │
    │                     │                           │──→ 502/504 {error,noteId,  │
    │                     │                           │     keptStatus:'DRAFT'} ───→│ red warning, "Reintentar"
```

## File Changes & Line Forecast

| File | Action | ΔLines | Description |
|------|--------|--------|-------------|
| `lib/parse-capture.ts` | **Create** | +250 | Exports: `ParsedCapture` type, `runCaptureChatCompletion()`, `createEmbedding()`, `createNoteWithRelations()` (CREATE), `enrichDraftNote()` (UPDATE+CAS), `findSimilarNotes()`, `createRelationships()`. Extracted from capture route. |
| `app/api/capture/route.ts` | **Modify** | -120 | Replace inline functions with lib imports. Existing behavior preserved. RecordType branching (`saveTransaction`/`saveHabitLog`/`saveWorkoutDraft`) stays inline. |
| `app/api/notes/route.ts` | **Create** | +70 | `POST`: auth → validate text → `prisma.note.create({status:'DRAFT',domain:'REGISTROS',title:text[0:80],content:text})` → 201. `GET`: auth → `prisma.note.findMany({where:{userId,status:query.status??'DRAFT'},orderBy:{createdAt:'desc'}})` → 200. |
| `app/api/notes/[id]/process/route.ts` | **Create** | +80 | `POST`: auth → ownership check (404 if cross-user) → status guard (409 if !DRAFT) → `runCaptureChatCompletion()` → `enrichDraftNote()` → on CAS failure return 200 `{alreadyProcessed:true}`. AI error → 502/504. |
| `components/CaptureOverlay.tsx` | **Modify** | +20 | `submit()`: POST `/api/notes`; `zf:draft` payload `{noteId}`. Removes two-phase `pending:true|false` event. |
| `components/InboxSection.tsx` | **Create** | +160 | Fetches `GET /api/notes?status=DRAFT` on mount. `zf:draft` handler: fetch single note via `GET /api/notes/[id]`, prepend. Per-card state machine. "Procesar todo" sequential loop. Contract below. |
| `app/(app)/page.tsx` | **Modify** | +60 | Import InboxSection; remove old draft listener (lines 317–385); add inbox section above "TAREAS DE HOY". |
| `tests/e2e.spec.ts` | **Modify** | +50 | Test: capture → inbox card visible → click "Procesar con IA" → assert 200 → card removed. Test: AI failure → assert 502/504 → red card + "Reintentar". |

**Total forecast**: ~690 lines changed. Exceeds 400-line preflight budget.

### Chained-PR Recommendation

| PR | Scope | ΔLines | Contents |
|----|-------|--------|----------|
| PR1 | Lib extraction (pure refactor) | ~250 | `lib/parse-capture.ts` only; capture route consumes imports; zero behavior change. |
| PR2 | New routes | ~150 | `app/api/notes/route.ts` + `app/api/notes/[id]/process/route.ts`. Frontend untouched. |
| PR3 | Frontend + e2e | ~290 | `CaptureOverlay.tsx`, `InboxSection.tsx`, `page.tsx`, e2e test. Depends on PR2 routes. |

> Acknowledge: preflight configured single-pr + 400-line budget. This recommendation surfaces for user confirmation before sdd-tasks splits work units.

## Interfaces / Contracts

```typescript
// ── lib/parse-capture.ts ──

interface ParsedCapture {
  domain: 'ESPIRITUAL' | 'PERSONAL' | 'APRENDIZAJE' | 'PROYECTOS' | 'REGISTROS'
  cleanedTitle: string
  cleanedContent: string
  tags: string[]
  suggestedGoals?: string[]
  metadata: {
    dueDate: string | null
    isImportant: boolean
    recordType: 'gimnasio' | 'finanzas' | 'habito' | null
    recordData: {
      value: number | null
      name: string | null
      unit: string | null
      category: string | null
    }
  }
}

// Chat completion (was parseCapture in capture route)
export async function runCaptureChatCompletion(rawText: string, userId: string): Promise<ParsedCapture>

// CREATE path (used by /api/capture)
export async function createNoteWithRelations(userId: string, parsed: ParsedCapture): Promise<Note>

// UPDATE path (used by /api/notes/[id]/process). CAS-gated: embedding write inside updateMany.
export async function enrichDraftNote(noteId: string, userId: string, parsed: ParsedCapture): Promise<Note | null>
// returns null when CAS fails (already processed)

// ── POST /api/notes ──
// Request:  { text: string }
// Response 201: { id: string, title: string, status: 'DRAFT', createdAt: string }
// Response 400: { error: string }
// Response 401: { error: 'unauthenticated' }

// ── GET /api/notes?status=DRAFT ──
// Response 200: Note[]
// Response 401: { error: 'unauthenticated' }

// ── POST /api/notes/[id]/process ──
// Request:  empty body
// Response 200 (success): { note: { id, title, domain, status: 'ACTIVE' } }
// Response 200 (already processed): { alreadyProcessed: true }
// Response 502: { error: 'AI_FAILED', noteId: string, keptStatus: 'DRAFT' }
// Response 504: { error: 'AI_TIMEOUT', noteId: string, keptStatus: 'DRAFT' }
// Response 401: { error: 'unauthenticated' }
// Response 404: { error: 'not found' }
// Response 409: { error: 'not a draft' }

// ── zf:draft CustomEvent ──
// detail: { noteId: string }
```

### InboxSection Contract

| Rule | Detail |
|------|--------|
| Mount | `fetch GET /api/notes?status=DRAFT` → `setCards(data)` |
| `zf:draft` handler | `useEffect` registers listener. On event: if `cards.find(c=>c.id===e.detail.noteId)`, return (noop). Else `fetch GET /api/notes/[id]` → `setCards(prev => [note, ...prev])`. Dependency array: `[cards]`. Does NOT call `setState` synchronously — only inside the async fetch `.then()`. |
| Empty state | When `cards.length === 0`, renders "Inbox vacío" text. |
| Per-card states | `idle` → (click) → `loading` (spinner, button disabled) → `success` (toast + remove card) / `error` (red warning, "Reintentar" button). |
| `data-testid` | `data-testid="inbox-card"` per card, `data-testid="process-button"` on the action button, `data-testid="inbox-empty"` on empty state. |
| TypeScript | Strict mode, zero `any`, zero synchronous `setState` inside `useEffect`. |
| "Procesar todo" | Iterates cards[] sequentially (for-of + await). On per-card failure, continues to next. On success, removes from local state. |

## Idempotency Mechanism

```
enrichDraftNote(noteId, userId, parsed):
  1. embedding = await createEmbedding(parsed.cleanedContent, userId)
  2. result = await prisma.note.updateMany({
       where: { id: noteId, status: 'DRAFT', userId },
       data: { status: 'ACTIVE', domain: parsed.domain, title: parsed.cleanedTitle,
               content: parsed.cleanedContent, tags: parsed.tags,
               suggestedGoals: parsed.suggestedGoals ?? [] }
     })
  3. if result.count === 0 → return null  // CAS failed, already processed
  4. await prisma.$executeRaw`UPDATE "Note" SET embedding=${embedding}::vector WHERE id=${noteId}`
  5. similar = await findSimilarNotes(userId, noteId, embedding)
  6. await createRelationships(userId, noteId, similar)
  7. return await prisma.note.findUnique({ where: { id: noteId } })
```

Race: two concurrent process requests. First wins CAS (DRAFT→ACTIVE), second sees count=0 → returns null → route handler returns 200 `{alreadyProcessed:true}`. Embedding write is after CAS so the loser never writes.

## Deferred

- **RecordType branching in processing endpoint**: For this slice, `enrichDraftNote` always produces an ACTIVE Note. The existing `/api/capture` route's `saveTransaction`/`saveHabitLog`/`saveWorkoutDraft` paths are untouched. DRAFT gym notes created by `saveWorkoutDraft` will appear in Inbox but process as regular Notes. Amends inbox-processing spec delta to note-only scope.
- **Voice capture via new flow**: `POST /api/notes` is text-only. Voice stays on existing `/api/capture`.

## Testing Strategy

| Layer | What | How |
|-------|------|-----|
| E2E | capture → inbox → process → active | Type text → submit → assert overlay closed, `[data-testid="inbox-card"]` visible → click `[data-testid="process-button"]` → assert toast → assert card removed |
| E2E | AI failure preserves data | Intercept process fetch → return 502 → assert red warning card + "Reintentar" |
| Type check | `tsc --noEmit` | All new files + modified pass strict |
