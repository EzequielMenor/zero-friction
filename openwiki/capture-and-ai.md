# Capture and AI Pipeline

The zero-friction promise lives in this flow: user types or speaks → Whisper (optional) → LLM classifies → embedding written → similar notes linked → SSE event → UI morphs the placeholder. Every step has a comment explaining a deliberate shortcut.

> Read this when changing prompt wording, response schema, embedding behaviour, the capture overlay UX, or the SSE draft-morphing pipeline.

---

## 1. The end-to-end capture flow

```
┌──────────────┐                ┌─────────────────────┐                ┌────────────────────┐
│ CaptureOverlay│── multipart ─▶│ POST /api/capture   │── chat.compl ─▶│ OpenAI-compatible  │
│ (text / audio)│                │ (or /process on     │                │ provider           │
│               │                │  existing DRAFT)    │                │ (per-user config)  │
└──────────────┘                └─────────────────────┘                └────────────────────┘
        │                                  │                                       │
        │   search-as-you-type             │   embedding.write                    │
        ▼                                  ▼                                       ▼
   GET /api/search                prisma.note + raw SQL                    text-embedding-3-small
                                  (vector via $executeRaw)                  (default)
        │                                  │
        │                                  ▼
        │                       prisma.noteRelationship
        │                       (similarity via cosine distance)
        │                                  │
        │                                  ▼
        │                       emitNoteProcessed() ─▶ GET /api/events SSE ─▶ CaptureOverlay morphs
        ▼
  Suggest existing note on Enter to avoid duplicates
```

Two entry points both produce the same `ParsedCapture` shape:

- **`POST /api/capture`** (`app/api/capture/route.ts`) — the *create* path. No upstream note exists; we create one (or a Transaction/HabitLog/Workout) and persist its embedding + relations.
- **`POST /api/notes/[id]/process`** (`app/api/notes/[id]/process/route.ts`) — the *enrich* path. A note already exists with `status: 'DRAFT'` (e.g., from a previous failed parse). We CAS-update to `ACTIVE`.

Both call functions in `lib/parse-capture.ts`.

---

## 2. The Capture Overlay (`components/CaptureOverlay.tsx`)

A self-contained client component — no state lib, no portal lib, no date lib. Triggered by:

- Floating circular button at bottom centre on mobile.
- `Cmd+K` (mac) or `Ctrl+K` (Windows/Linux), or `Opt/Alt + Space` on desktop.

Hidden on `/login` and `/signup` (uses `usePathname()`).

### Local NLP — chip detection

Before the network call, the overlay detects Spanish-language date words (`hoy`, `mañana`, `pasado mañana`, weekday names, `esta semana`, `la semana que viene`, `el mes que viene`) and the regex `\b\d{1,2}\s+de\s+(enero|febrero|…)\b`. Anything matching becomes a "chip" — a visual confirmation that the date made it into the text. Marking a chip is purely client-side; the LLM does the actual due-date extraction.

> Ponytail: a real NLP / date library is "overkill until we need multilingual date math or ranges".

### Dynamic auto-send countdown (`Spec §3.2`)

After voice transcription lands in the textarea, a circular countdown starts and the text is auto-sent when it reaches zero:

- `duration = clamp(round(words * 0.8), 3s, 10s)`
- 100ms tick interval for the progress ring.
- Tapping the textarea, screen, or "Cancelar" cancels the countdown and reverts to manual mode ("Escape Hatch").

### Voice capture

Uses `MediaRecorder` natively, no library. Audio blob is POSTed as `multipart/form-data` with field name `audio`. The server returns transcribed text; that text lands in the textarea, kicks off the countdown (§2), and then submits.

The server endpoint also supports `?transcribeOnly=true` — returns `{ text }` without invoking the LLM parse or touching the DB. The overlay uses this so voice → text is separable from "send to be classified".

### Search-as-you-type

While typing, the overlay runs `GET /api/search?q=…` against the server's case-insensitive `title` / `content` `contains` (Postgres `ILIKE`). `q.length < 2` returns empty. The 8 most recent hits are listed below the textarea. Pressing `Enter` with a hit chosen duplicates-as-reference rather than as a new note (the implementation chooses to save anyway when nothing else is selected — see the file for the current behaviour).

### Submission

Submits `multipart/form-data` with either `text` or `audio`:

```ts
const fd = new FormData()
if (text) fd.append('text', text)
else if (audioBlob) fd.append('audio', audioBlob, 'voice.webm')
fetch('/api/capture', { method: 'POST', body: fd, credentials: 'include' })
```

After 2xx, the overlay closes and `emitNoteProcessed` from `/api/events` (consumed via `EventSource`) triggers the Today list / hub list to refresh.

---

## 3. The LLM stage

### Prompt and JSON schema

`lib/parse-capture.ts` exports `SYSTEM_PROMPT` and `USER_PROMPT(rawText)`. The system prompt asks the model to:

1. Clean transcription errors and strip control metadata (`!`, dates, commands).
2. Classify into one of: `ESPIRITUAL | PERSONAL | APRENDIZAJE | PROYECTOS | REGISTROS`.
3. Extract metadata: `dueDate` (ISO `YYYY-MM-DD` or `null`), `isImportant` (`boolean`).
4. If domain is `REGISTROS`, classify as `gimnasio | finanzas | habito`.
5. Extract structured data per type — e.g. for `finanzas`, `value` / `name` / `category`.
6. Extract 2–4 short tags.
7. If `ESPIRITUAL`, propose 1–2 concrete actionable goals based on the study content.
8. Return **only** valid JSON matching `RESPONSE_SCHEMA`.

The schema is also exported as a constant for callers that want to validate model output before parsing.

### Model resolution

`getLlmForUser(userId)` in `lib/llm.ts` returns `{ client, model, embeddingModel }`:

```
LLMConfig table → user override
env vars (LLM_API_KEY, LLM_BASE_URL, LLM_MODEL, EMBEDDING_MODEL) → fallback
hard-coded defaults (gpt-4o-mini, text-embedding-3-small) → final fallback
```

Important: the OpenAI client is built **inside the function**, not at module scope. The OpenAI SDK throws when constructed without an API key, which would break `next build` with empty env vars. Per the ponytail in `lib/llm.ts`, this is the "no eager construction" pattern.

### Whisper

`getWhisperForUser(userId)` returns a separate OpenAI client — Whisper uses the API key from `LLMConfig.llmApiKey` (or `WHISPER_API_KEY` / `LLM_API_KEY`). The base URL defaults to `https://api.openai.com/v1` because most non-OpenAI providers do not proxy Whisper. The model defaults to `whisper-1` (read from `WHISPER_MODEL`).

### Temperature & timeout

- `temperature: 0.1` for deterministic routing.
- Callers may pass an `AbortSignal` (e.g. for a 15s capture timeout). The signal is forwarded to the OpenAI SDK.

---

## 4. Persistence path (`lib/parse-capture.ts`)

`createNoteWithRelations(userId, parsed)` is the create path:

1. `prisma.note.create({...})` with the cleaned title, content, domain, dueDate, isImportant, tags, suggestedGoals.
2. `createEmbedding(content, userId)` — calls `/v1/embeddings`.
3. **Raw SQL UPDATE**: Prisma can't write the `vector(1536)` type, so:
   ```ts
   await prisma.$executeRaw`
     UPDATE "Note"
     SET embedding = ${embedding}::vector
     WHERE id = ${note.id}
   `
   ```
4. `findSimilarNotes(userId, note.id, embedding)` — pgvector cosine distance via `<=>` operator. Selects the 3 most similar existing notes.
5. If any are returned, `createRelationships(...)` upserts `NoteRelationship` rows.

### Why raw SQL everywhere?

`Unsupported("vector(1536)")?` lets Prisma model the column but every read/write goes through `prisma.$queryRaw` / `$executeRaw`. Search the codebase for `::vector` to find all sites.

### Similarity search

```ts
SELECT id, 1 - (embedding <=> ${embedding}::vector) as similarity
FROM "Note"
WHERE "userId" = ${userId} AND id != ${noteId}
ORDER BY embedding <=> ${embedding}::vector
LIMIT 3
```

Score `1 - cosine_distance` ∈ `[0, 1]`. Higher is more similar. There's no threshold for "auto-link" — the top 3 always become relationships unless filtered later.

### The DRAFT → ACTIVE race

`enrichDraftNote(noteId, userId, parsed)` is used by `POST /api/notes/[id]/process`. Two concurrent requests could both try to write the same DRAFT. Guarded with CAS:

```ts
const result = await prisma.note.updateMany({
  where: { id: noteId, userId, status: 'DRAFT' },
  data: { status: 'ACTIVE', /* ... */ },
})
if (result.count === 0) return null      // lost the race — already ACTIVE
```

The embedding write is also gated `AND status = 'ACTIVE'` so a stale loser can't overwrite a fresh winner's vector.

Embeddings are generated *before* the CAS, so if the CAS loses we waste an embed call but no DB write. If we cared, we'd move embedding generation after the CAS.

---

## 5. Registros branches

If the LLM classifies the capture as `REGISTROS`, `app/api/capture/route.ts` switches on `recordType`:

- `finanzas` → `createTransactionFromParsed` (creates a `Transaction` with category fallback `'VARIOS'`)
- `habito` → `createOrToggleHabitLogFromParsed` (find-or-create `Habit`, then toggle today's `HabitLog.completed`)
- `gimnasio` → `createWorkoutFromParsed` (upsert today's `Workout`, add a single `WorkoutSet`)
- `null` / unknown → fall back to creating a Note

Each branch is its own function in `lib/parse-capture.ts`. None of them store embeddings (those are note-only). None emit `note-processed` events (Today doesn't show transactions).

---

## 6. SSE draft-morphing

Two producer sites call `emitNoteProcessed(...)`:

- `app/api/capture/route.ts` (after `createNoteWithRelations` succeeds — same-process emit is fine).
- `app/api/notes/[id]/process/route.ts` (after `enrichDraftNote` returns a non-null updated note).

The event payload:

```ts
interface NoteProcessedEvent {
  noteId: string
  domain: string
  status: 'ok' | 'promoted' | 'already_processed'
  // 'promoted' = DRAFT → NEEDS_REVIEW when AI falls back (rare path).
  // 'ok' = processed and persisted.
}
```

The browser opens `new EventSource('/api/events')` and listens for `note-processed`. The Today page uses this to morph the placeholder ("Procesando...") into the final record without polling.

### Listener on the client

`components/InboxSection.tsx` and `app/(app)/page.tsx` open an `EventSource` on mount and close it via `AbortController` / `eventSource.close()` on cleanup. The patch is minimal: on `note-processed` they refetch the affected resource.

---

## 7. Error and failure semantics

| Stage | Failure behaviour |
|-------|------------------|
| Whisper | Returns 500 with the underlying error captured by caller; overlay shows an "errorMessage". |
| Chat completion | Returns `422` "Failed to process content" and the overlay surfaces it. The note is *not* saved — there is no retry queue. |
| Embedding / similarity | Not awaited from outside the create path; failures bubble to the route which returns 500. (Trace-level ponytail: there's no per-step retry.) |
| SSE | Disconnect is silent; on reconnect the client re-fetches the hub list to re-sync. |
| Persistence race (DRAFT → ACTIVE) | Returns `null` to caller; the second request becomes a no-op. The user perceives this as a clean idempotent send. |

---

## 8. Adding a new capture-side feature

If you need to:

- **Change prompt wording**: edit `SYSTEM_PROMPT` in `lib/parse-capture.ts` (used by both create and process paths). Keep `RESPONSE_SCHEMA` in sync.
- **Add a new field**: add to `RESPONSE_SCHEMA`, `ParsedCapture`, the note/transaction creation call, and the Prisma schema (then a migration).
- **Support a new record type**: add a branch in `lib/parse-capture.ts` (e.g. `createSleepLogFromParsed`) and dispatch in `app/api/capture/route.ts`.
- **Change embedding model**: edit `lib/llm.ts::getLlmForUser` defaults or update the `LLMConfig.embeddingModel` row. Remember, vector dimension is hardcoded in `prisma/schema.prisma` (`Unsupported("vector(1536)")`); changing models means a migration to drop + recreate the column.
- **Tune the countdown**: edit `MIN_COUNTDOWN_S`, `MAX_COUNTDOWN_S`, `TICK_MS`, or `calcCountdownDuration` in `components/CaptureOverlay.tsx`.

---

## Source map

| Path | Why it matters |
|------|---------------|
| `components/CaptureOverlay.tsx` | The overlay, voice recording, chip detection, countdown |
| `app/api/capture/route.ts` | The create-path entry point |
| `app/api/notes/[id]/process/route.ts` | The enrich-path entry point |
| `lib/parse-capture.ts` | Prompt, schema, embedding, relationship helpers, REGISTROS branches, DRAFT race guard |
| `lib/llm.ts` | Per-user LLM client resolution |
| `lib/draft-events.ts` | Bus the SSE stream listens on |
| `app/api/events/route.ts` | The SSE stream |
| `app/api/search/route.ts` | Case-insensitive title/content search |
