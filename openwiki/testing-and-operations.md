# Testing, Build, Deploy and Operations

How the app is built (`prisma generate && next build`), how the local dev loop works, how E2E tests run, and what to do for safe operations.

> Read this before running `pnpm build` the first time, before writing a test, before deploying, or before adding a CI step.

---

## 1. Scripts (`package.json`)

| Script | What it does |
|--------|--------------|
| `pnpm dev` | `next dev` — local hot-reload on `:3000`. |
| `pnpm build` | `prisma generate && next build` — generation step must come first or `next build` fails to type-check routes that reference `@prisma/client`. |
| `pnpm start` | `next start` — production server (after `build`). |
| `pnpm lint` | `eslint` — flat config in `eslint.config.mjs`. |
| `pnpm exec playwright test` | E2E tests (`tests/e2e.spec.ts`). Config in `playwright.config.ts`. |

There are two lock files in the repo (`pnpm-lock.yaml` *and* `package-lock.json`). The repo is configured as a pnpm workspace (`pnpm-workspace.yaml`); the lockfile you should commit is `pnpm-lock.yaml`. Treat the `package-lock.json` as leftover unless you know why it's there.

The `@playwright/test` runner is dev-only.

---

## 2. Environment variables

The repo includes a `.env` and a `.env.local`. **Don't read those files** — they contain secrets. Use `.env.example` (if present) and the comments below to understand shape.

| Variable | Used by | Notes |
|----------|---------|-------|
| `DATABASE_URL` | `lib/prisma.ts` | Postgres connection string. Supabase pooler works (TLS skip is configured in `lib/prisma.ts`). |
| `JWT_SECRET` | `lib/auth.ts` | HS256 signing key for the cookie JWT. Must be set in production. |
| `REGISTRATION_SECRET` | `app/api/auth/signup/route.ts` | Invite code required at signup. Single-user app — keep this locked down. |
| `LLM_API_KEY` | `lib/llm.ts` | Default OpenAI-compatible API key. Per-user `LLMConfig.llmApiKey` overrides. |
| `LLM_BASE_URL` | `lib/llm.ts` | Default base URL (`https://api.openai.com/v1`). |
| `LLM_MODEL` | `lib/llm.ts` | Default chat model (`gpt-4o-mini`). |
| `EMBEDDING_MODEL` | `lib/llm.ts` | Default embedding model (`text-embedding-3-small`). |
| `WHISPER_API_KEY` | `lib/llm.ts` | Whisper key (falls back to `LLM_API_KEY`). |
| `WHISPER_BASE_URL` | `lib/llm.ts` | Whisper base URL (`https://api.openai.com/v1`). Most non-OpenAI providers don't proxy Whisper. |
| `WHISPER_MODEL` | `lib/llm.ts` | Default Whisper model (`whisper-1`). |

The settings page (`/settings`) lets users override every `LLM_*` value per-user; `WHISPER_*` currently doesn't have per-user overrides.

---

## 3. Database setup

Required Postgres features:

- The `pgvector` extension **must be enabled**. Most cloud providers (Supabase, Neon) enable it on the dashboard.
- The `Note.embedding` column is `vector(1536)` by default. Changing models means a manual migration to drop and recreate the column.

Local Supabase dev tips:

- `supabase/.temp/` contains a development payload — leave it alone.
- `prisma/verify-connection.js` is a one-shot connection check; not part of the build pipeline.

### Creating a migration

```bash
pnpm exec prisma migrate dev --name <feature>
```

This generates SQL, applies it locally, and regenerates `@prisma/client`. The new file lands in `prisma/migrations/<timestamp>_<feature>/`. Commit both the SQL and the updated `migration_lock.toml`.

### Deploying a migration

```bash
pnpm exec prisma migrate deploy
```

Runs migrations against the configured `DATABASE_URL` without generating a client (the build step already does that).

---

## 4. Building

```bash
pnpm build
```

The script chains `prisma generate && next build`. Two failure modes to expect:

- **Missing `JWT_SECRET`** → `lib/auth.ts` throws at module load.
- **Missing `DATABASE_URL`** → `lib/prisma.ts` throws when the pool is constructed.
- **Migrations not applied** → runtime errors the first time a route hits Prisma.

`next.config.ts` is conservative on purpose: standard security headers plus a dedicated `Cache-Control: no-cache, no-store, must-revalidate` and a strict `default-src 'self'` CSP for `/sw.js`. Move this CSP up to the site-wide rule once you're on a custom domain.

---

## 5. Testing

### Playwright config (`playwright.config.ts`)

- Tests live in `tests/`.
- `fullyParallel: false`, `workers: 1` — serial, like a smoke suite.
- `retries: 2` in CI, `0` locally.
- Default base URL is `http://localhost:3000`; override with `BASE_URL`.
- Loads `.env` with `dotenv`.

### `tests/e2e.spec.ts`

A single end-to-end script that:

1. Registers a fresh user (`test-user-<timestamp>@test.com`, password `Password123!`, invite code `zero-friction-private-2026`).
2. Seeds the user's data directly in Postgres via `prisma.*`: a focus task, a today task, a habit, a Spiritual note, a Personal note, a Transaction on a fresh Account.
3. Reloads the Today dashboard and asserts each widget (`ENFOQUE`, `TAREAS DE HOY`, `HÁBITOS DE HOY`).
4. Visits `/hubs/espiritual` and asserts domain isolation.
5. Visits `/hubs/mente` and asserts a `<canvas>` is present.

Screenshots are saved into a hard-coded directory under `~/.gemini/antigravity-cli/brain/...` — that's a personal-tooling detail. Treat the test as a smoke suite that exercises signup → seed → Today → Hubs → Mente end-to-end.

### What the test is and isn't

- It runs as a single user, single tenant — that's the intended posture.
- It doesn't exercise LLM calls (would be flaky + costly).
- It doesn't exercise the SSE stream (timing).
- It writes to the live database. Run against a non-prod DB.

### Adding a test

- Stay in `tests/`. Name new files `*.spec.ts`.
- Reuse the same `registerUser` helper or factor it into the suite's `before` / `beforeEach`.

---

## 6. PWA — the production-only service worker

- Mounted by `components/pwa/ServiceWorkerRegistrar.tsx` at the root layout level.
- Registration code path runs **only when `process.env.NODE_ENV === 'production'`**, per the code comment and the build chain (`register` is a no-op in dev).
- Service worker source lives where the manifest expects: `/sw.js` (served by Vercel). `next.config.ts` gives it explicit `Cache-Control: no-cache` and a strict CSP so a stale SW never disables itself silently.

`app/manifest.ts` builds the web manifest. Icons referenced as `/icon-192x192.png`, `/icon-512x512.png`, `/apple-icon-180x180.png` — keep these in `/public/` so Next serves them under stable names.

---

## 7. Common operations

### First-time setup (development)

```bash
pnpm install
pnpm exec prisma migrate dev    # creates + applies migrations
pnpm dev
```

### Restart the SSE / draft-morph pipeline

The single-process bus (`lib/draft-events.ts`) is in-process. If you change the emitter or the SSE stream, restart `next dev`. On multi-instance or serverless deploys the upgrade path is documented in the file's comment ("migrate to a `pending_notifications` table + SSE poll loop").

### Adding an env var

1. Add to `.env` and `.env.local` — but **don't** commit secrets.
2. Add a comment to this file (the var table above).
3. Read it lazily inside an async function (don't crash `next build`).

### Toggling the LLM provider

The Settings page lists providers; choosing one fills in `llmBaseUrl`. Save and the form re-queries `/api/settings/models` for available chat + embedding models.

### Inspecting embeddings

```sql
SELECT id, title, embedding IS NOT NULL AS has_embed FROM "Note" WHERE "userId" = $1 ORDER BY "updatedAt" DESC LIMIT 20;
```

A note without an embedding means its raw-SQL `UPDATE … SET embedding = $1::vector` path never ran (capture failure, or pre-pgvector-import data).

### Common gotchas

- A new capture field requires three changes: `RESPONSE_SCHEMA`, `ParsedCapture`, and the relevant `prisma.note.create({ ... })` body. Search for `parsed.metadata` to find all sites.
- Adding a column to the `Note` model? Add it to `lib/hubs.ts::NOTE_SELECT` to keep the hub list projections lean.
- Renaming a domain: half the work of adding a new one. Read `openwiki/hubs-and-domains.md` §7 before deciding.

---

## Source map

| Path | Why it matters |
|------|---------------|
| `package.json` | `dev`, `build`, `start`, `lint` |
| `next.config.ts` | Security headers, `/sw.js` policy |
| `playwright.config.ts` | Playwright config |
| `tests/e2e.spec.ts` | Single end-to-end smoke test |
| `prisma/verify-connection.js` | One-shot DB probe |
| `prisma/migrations/` | Chronological schema versions |
| `prisma/schema.prisma` | Source of truth for models |
| `app/manifest.ts` | PWA manifest |
| `components/pwa/ServiceWorkerRegistrar.tsx` | Production SW registration |
| `lib/draft-events.ts` | Single-process `EventEmitter` for SSE |
| `lib/auth.ts` | JWT verify (used in the proxy) |
| `lib/prisma.ts` | Prisma + pg pool |
| `lib/llm.ts` | Per-user provider resolution |
