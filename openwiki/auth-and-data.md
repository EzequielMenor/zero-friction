# Authentication and Data Model

How users are authenticated, how the gate is enforced at three layers, and how the Prisma schema is organised.

> Read this when changing login/signup, adding or modifying a Prisma model, running migrations, or threading a new foreign-key relationship between models.

---

## 1. Authentication — three-layer model

The app uses one cookie (`auth_token`) that holds a signed JWT (`jose`, HS256, 1-year TTL). Three independent checks exist on purpose:

```
                ┌─────────────────────────────────────────────────┐
HTTP request ──▶│ proxy.ts (Next 16 proxy, formerly middleware)  │  Layer 1: redirect-or-pass
                └──────────────┬──────────────────────────────────┘
                               │ (if protected)
                               ▼
                ┌─────────────────────────────────────────────────┐
                │ API route / server component                    │  Layer 2: verify session, 401
                └──────────────┬──────────────────────────────────┘
                               │
                               ▼
                ┌─────────────────────────────────────────────────┐
                │ Prisma query (where: { userId: session.userId })│  Layer 3: row-level scoping
                └─────────────────────────────────────────────────┘
```

- **Layer 1 — `proxy.ts`**. Runs on every non-static request. Whitelist: `/login`, `/signup`, `/api/auth/login`, `/api/auth/signup`, `/api/auth/logout`. `/api/auth/me` is special-cased: pass-through but the route returns 401 if there is no token (so the JSON contract doesn't get replaced with an HTML redirect). Everything else with a missing/invalid cookie → redirect to `/login?redirect=<original>`.
- **Layer 2 — API handlers**. Each handler reads `AUTH_COOKIE` itself and calls `verifySession` from `lib/auth.ts`. Returns `401 Unauthorized` directly. Server components use `await cookies()` and `verifySession` (e.g. `app/api/today/route.ts`, `app/api/graph/route.ts`).
- **Layer 3 — data scoping**. Every Prisma query uses `where: { userId: session.userId }` (or `habit: { userId }` for indirect joins). There is no role model — there is exactly one user at a time, but the per-row filter is the load-bearing safety net.

Cookie options (`lib/auth.ts::cookieOptions()`):

```ts
{
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax',
  path: '/',
  maxAge: 60 * 60 * 24 * 365,    // 1 year
}
```

### Signup is invite-gated

`POST /api/auth/signup` requires:

- `email` (string)
- `password` (string, ≥ 8 chars)
- `secretCode` — must equal `process.env.REGISTRATION_SECRET`

Hash with `bcryptjs` (cost 10). On success, set the auth cookie and return the new user record.

Login (`POST /api/auth/login`) defends against timing-based user enumeration with a dummy bcrypt-compare on unknown emails (`// Constant-time-ish: still hash even on miss to avoid trivial user-enumeration timing`).

Logout (`POST /api/auth/logout`) clears the cookie. The frontend also calls it from the Ajustes page.

### `proxy.ts` quirks (Next 16)

- File must be named **`proxy.ts`** and the exported function **`proxy(...)`** — both were renamed from the old `middleware.ts`/`middleware(...)`. Older docs you may find online are wrong for this version.
- The `matcher` regex excludes `_next/static` and `_next/image` so static assets don't pay the verification cost. It still matches API routes.

---

## 2. The Prisma schema

Single source of truth: `prisma/schema.prisma`. Datasource is PostgreSQL with no explicit `url` set in the file (the URL comes from `DATABASE_URL`, used by `lib/prisma.ts`).

### Models at a glance

| Model | Purpose | Notable indices / uniques |
|-------|---------|---------------------------|
| `User` | One row per account | `email @unique` |
| `Note` | Domain-tagged text record (ESPIRITUAL/PERSONAL/APRENDIZAJE/PROYECTOS/REGISTROS) | `embedding Unsupported("vector(1536)")?` (raw SQL only) |
| `NoteRelationship` | Source/target similarity link between Notes | `@@unique([sourceNoteId, targetNoteId])` |
| `Workout` | One row per user-day | `@@unique([userId, date])` |
| `WorkoutSet` | One row per set inside a workout | — |
| `Account` | Bank/wallet | `currency @default("EUR")` |
| `Transaction` | Money movement, may link Subscription + Account | — |
| `Subscription` | Recurring expense to validate | — |
| `Habit` | A habit definition | — |
| `HabitLog` | Per-day boolean | `@@unique([habitId, date])` |
| `CoachAdvice` | One AI-generated tip per user | `@unique userId` |
| `LLMConfig` | One per-user LLM key/URL/model config | `@unique userId`, `llmApiKey String?` |

### Cascade rules

Every `relation(fields: [X], references: [Y], onDelete: Cascade)` from a child model → its parent. Deleting a `User` removes all their data.

### Enums

- `Domain` — five life domains, see `openwiki/hubs-and-domains.md`.
- `NoteStatus` — `DRAFT | NEEDS_REVIEW | ACTIVE | IN_PROGRESS | DONE`. The DRAFT state is the placeholder created during capture; `enrichDraftNote` (`lib/parse-capture.ts`) moves it to ACTIVE in a CAS-gated update.

### pgvector — vector(1536)

`Note.embedding` is `Unsupported("vector(1536)")?`. Prisma models the column but cannot read or write it. Every interaction uses raw SQL:

```ts
await prisma.$executeRaw`
  UPDATE "Note" SET embedding = ${embedding}::vector WHERE id = ${note.id}
`

// Find 3 most similar notes for a user:
SELECT id, 1 - (embedding <=> ${embedding}::vector) AS similarity
FROM "Note"
WHERE "userId" = ${userId} AND id != ${noteId}
ORDER BY embedding <=> ${embedding}::vector
LIMIT 3
```

Two consequences to keep in mind:

- **Schema-side dimension** is fixed at 1536 — the default for `text-embedding-3-small`. Changing models means a migration to alter the column type, e.g. `ALTER TABLE "Note" ALTER COLUMN embedding TYPE vector(3076)`.
- **`Unsupported` means no Prisma `select`.** You can't `prisma.note.findUnique({ select: { embedding: true } })` and get back a vector — you'd have to do `prisma.$queryRaw` and parse the result yourself if needed.

---

## 3. Migrations

Chronological list in `prisma/migrations/`:

```
001_initial/
20260630172514_add_suggested_goals_to_note/   # Note.suggestedGoals: String[]
20260630174500_add_coach_advice/              # CoachAdvice model
20260701061145_add_account_model/             # Account model + Transaction.accountId
20260701072709_add_user_llm_config/           # LLMConfig model (per-user overrides)
```

The names imply each migration's intent; read the SQL inside each folder before assuming (Prisma appends auto-generated statements).

`migration_lock.toml` pins `provider = "postgresql"`. Don't change it.

### Migration commands

- **Local dev** — `pnpm exec prisma migrate dev --name <feature>` (creates + applies).
- **Deploy** — `pnpm exec prisma migrate deploy` (apply only, no client regen).

`pnpm build` runs `prisma generate && next build`, so the client is always in sync with the schema in production deploys.

---

## 4. Adding a model (or column)

Recipe:

1. Edit `prisma/schema.prisma`. Add relations on both sides (Prisma requires this for two-sided relations).
2. `pnpm exec prisma migrate dev --name <feature>` to create the migration.
3. If using a new cross-table join: update the relevant domain page (`/hubs/...`) and the API route it depends on.
4. If the new column is rendered in the UI: extend `lib/hubs.ts::NOTE_SELECT` (the canonical note projection used by Today and Hubs) so over-fetching stays minimal.
5. If the new column is rendered in `NotePanel`, update `components/NotePanel.tsx`.
6. If your change touches the LLM prompt output, update `RESPONSE_SCHEMA` in `lib/parse-capture.ts` too.

Cascade & index checklist:

- Should deleting the parent drop this row? If yes, `onDelete: Cascade`. If not, `SetNull` (e.g. `Transaction.subscriptionId` is `SetNull` so deleting the subscription keeps the historical transaction).
- Composite uniqueness? Use `@@unique([a, b])`. Prevents 90% of "double insert" bugs.

---

## 5. Per-user LLM configuration

`LLMConfig` lets each user bring their own OpenAI-compatible provider (OpenAI, DeepSeek, OpenRouter, Groq, Together, Minimax, OpenCode Zen/Go, Mistral, local Ollama). The settings page (`app/(app)/settings/page.tsx`) lists provider presets and lets the user save:

- `llmBaseUrl` (string)
- `llmApiKey` (string, **never returned in cleartext** — masked as `••••••••` on every read)
- `llmModel` (chat model — auto-discovered via `POST /api/settings/models`)
- `embeddingModel` (embedding model — auto-discovered same way)

The post handler treats `••••••••` as "leave the stored key alone", so the UI can re-save the rest of the form without losing the existing key.

`lib/llm.ts::getLlmForUser` first reads the user's row, then falls back to env vars (`LLM_API_KEY`, `LLM_BASE_URL`, `LLM_MODEL`, `EMBEDDING_MODEL`), then defaults (`gpt-4o-mini`, `text-embedding-3-small`). The OpenAI client is built lazily inside the function so an absent key never breaks `next build`.

### `POST /api/settings/test`

The settings page has a "Probar" button that hits `POST /api/settings/test` with the form values. The route pings the provider with a small chat completion and reports `{ ok, message }` for the UI toast.

---

## 6. The DRAFT — and why it exists

A captured note first lands as `Note.status = DRAFT`. It's visible in the hub and Today (`InboxSection`) as a "Procesando..." placeholder. Background AI work may be slow or fail; the user shouldn't wait synchronously and shouldn't see missing data.

- The create path (`POST /api/capture`) writes the note with `status: DRAFT` *only when the AI call fails* (rare — usually the create path goes all the way to `ACTIVE`).
- More commonly, DRAFTs come from explicit draft entry — when an upstream pipeline needs the row id before processing finishes.

`enrichDraftNote` (`lib/parse-capture.ts`) implements a CAS update with `updateMany({ where: { id, userId, status: 'DRAFT' }})`. If two enrich requests race, exactly one wins; the loser returns `null` to its caller.

After success, `emitNoteProcessed(...)` notifies the open `EventSource('/api/events')` on the user's browser so the placeholder morphs into the final record without a refresh.

---

## Source map

| Path | Why it matters |
|------|---------------|
| `lib/auth.ts` | JWT sign/verify, bcrypt, cookie options |
| `lib/prisma.ts` | Prisma client singleton, pg pool, Supabase-friendly `ssl` |
| `proxy.ts` | Next 16 proxy (formerly middleware) — auth gate |
| `app/api/auth/login/route.ts` | Login, constant-time-ish bcrypt on unknown email |
| `app/api/auth/signup/route.ts` | Signup, invite-code check |
| `app/api/auth/logout/route.ts` | Logout, cookie clear |
| `app/api/auth/me/route.ts` | Session probe (returns user or 401) |
| `prisma/schema.prisma` | All models |
| `prisma/migrations/` | Chronological schema versions |
| `app/api/settings/route.ts` | LLMConfig GET / POST (masked) |
| `app/(app)/settings/page.tsx` | Provider chooser + LLMConfig form |
| `lib/llm.ts` | Per-user LLM client resolution |
