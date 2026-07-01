# Real-time Draft Morphing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Eliminate the manual "Procesar con IA" button. After capture, the draft card should auto-morph into its final state (or disappear into the correct hub) once backend processing completes — no manual reload or click.

**Current behavior:**
- Capture creates a DRAFT note via `POST /api/notes`, client dispatches `zf:draft` CustomEvent
- `InboxSection` listens for `zf:draft`, fetches the new draft, renders it as a card
- User must click "Procesar con IA" per card → `POST /api/notes/[id]/process`
- On success (200), card is removed from Inbox. On error, error state shown with retry.
- **No server push at all.** No WebSocket, SSE, or polling anywhere in the codebase.

**Architecture:** Next.js API Routes (App Router), single-user personal app. Hosting likely serverless (Vercel/Neon).

---

## Approach Comparison

| Approach | Complexity | Serverless Viability | Latency | External Deps |
|---|---|---|---|---|
| **SSE (recommended)** | Medium | ✅ Works (HTTP stream) | ~instant | None |
| Polling | Low | ✅ Works | 3-10s delay | None |
| WebSocket | High | ❌ Poor on serverless | ~instant | WS server or service |

### Recommendation: SSE (Server-Sent Events)

**Rationale:**
- Next.js Route Handlers support streaming via `Response` / `ReadableStream`. This works on Vercel Pro+ (streaming supported), and the connection is standard HTTP — no upgrade handshake, no persistent infra.
- For a single-user app, SSE is simple: one open connection, the server pushes `event: note-processed` when processing finishes.
- No external infra needed: no Redis pub/sub, no Pusher, no WebSocket server. For a single-process deployment (or even serverless via Neon's LISTEN/NOTIFY), an in-memory EventEmitter handles it — but on serverless, each invocation is isolated, so we need a shared medium (DB or key-value store) to relay events between the process route and the SSE handler.

**SSE on serverless caveat:** On Vercel's serverless plan, the free tier has a 10s initial response timeout and doesn't support streaming responses well. Vercel Pro+ supports streaming via Edge Runtime. **Fallback:** if SSE proves unreliable in the target hosting environment, add 5-second polling as the fallback mechanism. Both can coexist: SSE for instant updates, polling as safety net.

**Implementation sketch:**
1. `app/api/events/route.ts` — GET handler that returns a `ReadableStream` SSE response. Keeps the connection open. When a `note-processed` event is received (via an in-process EventEmitter or a simple "pending notes" DB table), writes the event to the stream.
2. `lib/draft-events.ts` — lightweight event bus. In production (single process), a simple `EventEmitter` singleton. For multi-instance/serverless, the same bus backed by a small `pending_notifications` table (polled by the SSE handler).
3. `app/api/notes/[id]/process/route.ts` — after successful processing, emit `note-processed` event with `{ noteId, domain, status }`.
4. `components/InboxSection.tsx` — on mount, open `EventSource('/api/events')`. Listen for `note-processed` events. On match, morph the card (or just remove it), show success toast.

**Ponytail simplification:** SSE + EventEmitter singleton covers the common case (single-process deployment). If the app is deployed on serverless with multiple instances, replace EventEmitter with a `Notification` table polled by the SSE handler. Start simple.

---

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `lib/draft-events.ts` | Create | Lightweight event bus (EventEmitter singleton) |
| `app/api/events/route.ts` | Create | SSE endpoint — streams note-processed events |
| `app/api/notes/[id]/process/route.ts` | Modify | Emit `note-processed` event after successful processing |
| `components/InboxSection.tsx` | Modify | Replace manual button with EventSource auto-morph |
| `components/Toast.tsx` | Modify (maybe) | Toast already exists as showToast prop; may need small integration |

---

## Implementation Tasks

### Task 1: Event Bus (`lib/draft-events.ts`)
- [ ] Create `lib/draft-events.ts` with a typed EventEmitter singleton
- [ ] Export `emitNoteProcessed(noteId, domain)` and `onNoteProcessed(handler)`
- [ ] Export `offNoteProcessed(handler)` for cleanup

### Task 2: SSE Endpoint (`app/api/events/route.ts`)
- [ ] GET handler returns `Response` with `ReadableStream`
- [ ] Set headers: `Content-Type: text/event-stream`, `Cache-Control: no-cache`, `Connection: keep-alive`
- [ ] Subscribe to `onNoteProcessed`, write SSE-formatted events to stream
- [ ] On client disconnect (req.signal.aborted), clean up listener
- [ ] Send periodic keepalive comment (`: keepalive\n\n`) every 30s

### Task 3: Modify Process Route
- [ ] Import `emitNoteProcessed` from draft-events
- [ ] After successful processing (both REGISTROS and Note enrichment paths), emit event with `{ noteId, domain, status }`
- [ ] No behavioral change — just fire-and-forget the event

### Task 4: Modify InboxSection
- [ ] On mount, create `EventSource('/api/events')`
- [ ] Listen for `note-processed` events
- [ ] On match with a visible card: remove card from UI, show success toast
- [ ] Fallback: keep existing processCard logic as-is (so manual process still works if SSE fails)
- [ ] On unmount, close EventSource connection
- [ ] Keep "Procesar todo" button for bulk backfill; remove per-card "Procesar con IA" button

---

## Non-goals / Out of Scope

- ❌ Push notifications (separate concern)
- ❌ WebSocket server or external real-time service
- ❌ Morphing animation (CSS transition on card removal is sufficient)
- ❌ Offline-first queuing (drafts are always created online)
- ❌ Multi-device sync in this iteration

## Effort: Medium (~1 session, ~150-200 lines total)

| Task | Lines | Complexity |
|---|---|---|
| Event bus | ~30 | Low |
| SSE endpoint | ~60 | Medium |
| Process route mod | ~5 | Trivial |
| InboxSection mod | ~60 | Medium |
| **Total** | **~155** | |

## Self-Review

- ✅ Manual button removed (auto-morph on processing complete)
- ✅ Fallback: manual process still exists via "Procesar todo" bulk action
- ✅ SSE degrades to polling-like behavior if connection drops (EventSource auto-reconnects)
- ✅ No external dependencies
- ✅ Works on single-process dev and multi-instance prod (EventEmitter → DB-backed if needed)
- ✅ Ponytail: starts with in-memory EventEmitter; upgrade path to DB-backed is additive
