# Architecture

How the codebase is wired together at the framework level: route layout, server/runtime boundaries, persistence layer, the auth gate, and PWA plumbing.

> Read `openwiki/quickstart.md` first. For the product spec, see `/zero-friction-spec.md` at the repo root.

---

## 1. Runtime model

This is a Next.js 16 App Router project. Two parallel concepts matter for every endpoint:

- **Route groups control layout, not URL.** `app/(app)/` and `app/(auth)/` share URL space with `app/api/`. The groups only choose a layout component.
- **"proxy.ts" replaces the old `middleware.ts`.** Next 16 renamed the file and the function. `proxy.ts` at the repo root is the single auth gate — see §5.

### Route tree (URLs)

```
/                                  Today dashboard               app/(app)/page.tsx
/calendar                          Calendar                     app/(app)/calendar/page.tsx
/settings                          Theme + LLM config           app/(app)/settings/page.tsx
/hubs/espiritual                   Generic Hub                  app/(app)/hubs/[domain]/page.tsx → HubContent.tsx
/hubs/personal                                                  "                     "
/hubs/aprendizaje                                               "                     "
/hubs/proyectos                                                 "                     "
/hubs/mente                       Semantic graph (canvas)      app/(app)/hubs/mente/page.tsx
/hubs/registros/finanzas          Finanzas (cycle, accounts)   app/(app)/hubs/registros/finanzas/page.tsx
/hubs/registros/fuerza            Gym (CSV import, charts)     app/(app)/hubs/registros/fuerza/page.tsx
/hubs/registros/habitos           Streaks + heatmap            app/(app)/hubs/registros/habitos/page.tsx
/login, /signup                    Centred auth pages          app/(auth)/login/page.tsx, signup/page.tsx

/api/auth/{login,signup,logout,me}
/api/capture                       Text or audio capture (create Note DRAFT + process inline)
/api/notes                         POST: structured create (Note [+ Task]); path /bulk not present
/api/notes/[id]                    GET / PATCH (drag dueDate/isImportant onto Task) / DELETE
/api/notes/[id]/process            Tri-phase process: LLM classify → Task or Note → DRAFT cleanup
/api/notes/[id]/accept-goal        Promote an ESPIRITUAL.suggestedGoals[] into PROYECTOS
/api/notes/[id]/reflection         Append a reflection to the Note content
/api/tasks/[id]                    PATCH Task (dueDate / isImportant)
/api/tasks/[id]/focus              POST: set focusedAt (clears previous focus for the same user)
/api/tasks/[id]/unfocus            POST: clear focusedAt
/api/tasks/[id]/complete           POST: mark Task OPEN → DONE (+ completedAt)
/api/projects                      GET (filter ?status=…); POST (rate-limited)
/api/projects/[id]                 GET / PATCH (CAS-gated transition) / DELETE (SetNull on Note)
/api/dashboard                     6-section Today payload (replaces /api/today)
/api/calendar                      Tasks-with-Note join for the calendar
/api/graph                         Nodes + relationships (incl. relationshipType + reason) for Mente
/api/hubs/[domain]                 Per-hub Note feed + relatedItems from NoteRelationship
/api/habits
/api/registros/{finanzas,fuerza,habitos}
/api/accounts                      CRUD bank-account records
/api/subscriptions/[id]            Subscriptions CRUD
/api/search?q=…                    Case-insensitive title/content search (now with project brief)
/api/settings                      Per-user LLM config (keys masked)
/api/settings/models, /api/settings/test  Model discovery + chat-ping
/api/events                        SSE stream — draft-morphing notifications
/api/debug                         (present but undocumented; debug-only)
```

### Layouts

- `app/layout.tsx` (root): font + classes, injects the anti-FOUC theme script, wraps everything in `ThemeProvider`, and renders three always-mounted components outside the route group: `NavMenu` (sidebar / bottom-bar), `CaptureOverlay` (capture FAB), `ServiceWorkerRegistrar`.
- `app/(app)/layout.tsx`: applies the `md:ml-[220px]` sidebar offset and constrains content to `max-w-[720px]`.
- `app/(auth)/layout.tsx`: centres the form, hides `NavMenu`, sticks a "Monograph" wordmark header.

---

## 2. Server / client boundaries

The app uses three patterns heavily; knowing which is which will save you time.

| Pattern | Where | Notes |
|--------|-------|-------|
| **Server component** | `app/(app)/hubs/[domain]/page.tsx`, `app/api/**/route.ts` | Read cookies via `cookies()` (Next 16 changed to async), redirect, query Prisma directly. |
| **Client component (`'use client'`)** | `app/(app)/page.tsx`, `app/(app)/settings/page.tsx`, `components/**`, `app/(app)/hubs/registros/**` | Do data fetching with `fetch(...)` + the `credentials: 'include'` cookie. |
| **Server route returning JSON** | All `/api/*/route.ts` | Auth = cookie read + `verifySession(token)`; return `NextResponse.json(...)`. |

Server components that need session currently both read the cookie via `await cookies()` (Next 16 API) and call `verifySession`. Don't import `lib/prisma` from a client component — it bundles `pg` and will break the build.

> **Next.js 16.** Per the `AGENTS.md` rule, the `node_modules/next/dist/docs/` directory ships version-specific docs. Always check there before changing `cookies()`, `headers()`, request APIs, or routing conventions.

---

## 3. Persistence: Prisma 7 + pgvector + raw SQL

`lib/prisma.ts` instantiates a single `PrismaClient` per Node process, using `@prisma/adapter-pg` against a `pg.Pool`. The Supabase pooler uses a self-signed cert on the connection endpoint, so `ssl.rejectUnauthorized = false` is set; encryption is still on.

Important quirks:

- **`Unsupported("vector(1536)")?`** on `Note.embedding`. Prisma doesn't model pgvector yet, so every vector read/write uses `prisma.$executeRaw` or `$queryRaw`. See `lib/parse-capture.ts:findSimilarNotes`, `createNoteWithRelations`, `enrichDraftNote`.
- **Dev hot-reload safe.** `globalThis.prisma` caches the client across HMR reloads.
- **Schema in `prisma/schema.prisma`.** Models: `User`, `Note`, `NoteRelationship`, `Workout`/`WorkoutSet`, `Transaction`, `Account`, `Subscription`, `Habit`/`HabitLog`, `CoachAdvice`, `LLMConfig`. See `openwiki/auth-and-data.md` for full coverage.

Migrations live in `prisma/migrations/<timestamp>_name/` and were generated chronologically:

```
001_initial/
20260630172514_add_suggested_goals_to_note
20260630174500_add_coach_advice
20260701061145_add_account_model
20260701072709_add_user_llm_config
20260708120000_split_note_task          # Migration A: Task table + noteStatus (additive)
20260708120100_drop_legacy_note_fields  # Migration B: drop status/dueDate/isImportant, add CHECK + partial unique
20260709120000_add_note_relationship_metadata  # NoteRelationship.relationshipType + reason
20260709130000_add_project              # Project table + Note.projectId (SetNull)
```

`pnpm build` runs `prisma generate && next build` so CI cannot ship a stale client.

### Helper modules

- `lib/prisma.ts` — singleton client.
- `lib/auth.ts` — JWT sign/verify, bcrypt hash/verify, cookie options.
- `lib/llm.ts` — `getLlmForUser(userId)` and `getWhisperForUser(userId)`. No eager construction (would crash `next build` if env vars are missing).
- `lib/hubs.ts` — single source of truth for the 5 domain slugs ↔ enum mapping; also exports the canonical Prisma `select` projections (`NOTE_SELECT_NEW`, `TASK_SELECT`, `NOTE_SELECT_WITH_TASK_FLAG`, `NOTE_SELECT_WITH_PROJECT`, `NOTE_SELECT_WITH_TASK_FLAG_PROJECT`, `PROJECT_SELECT`) so every route over-fetches identically and the schema changes are localized.
- `lib/projects.ts` — pure logic for `Project` (no I/O at module scope). Holds `PROJECT_TRANSITIONS` DAG, `validateTransition(from, to)`, `formatProjectItem`, `formatProjectBrief`, `findOwnProjectOrThrow` (cuid regex + ownership), `mapPrismaError` (P2002 / P2003 / P2025 → 409 / 400 / 404), and `logProjectEvent` for structured `console` logs.
- `lib/rate-limit.ts` — in-memory `Map`-based limiter: `rateLimit(key, limit, windowMs) → boolean`. Currently used by `/api/projects` (POST: 30 / minute; GET: 120 / minute). Ponytail: swap to Redis or Vercel KV for multi-instance.
- `lib/draft-events.ts` — in-process `EventEmitter` bus for "a DRAFT finished processing".
- `lib/parse-capture.ts` — the AI orchestration: chat completion, embedding, persistence, LLM reranker. See `openwiki/capture-and-ai.md`.
- `lib/types/*.ts` — single source of truth for `NoteItem`, `TaskItem`, `ProjectItem`, `ParsedCapture`, `ApiResponse<T>`, and the `InvalidProjectIdError` discriminated union. Re-exports the Prisma enums (`NoteStatus`, `TaskStatus`, `ProjectStatus`, `NoteRelationshipType`).
- `lib/legacy/enrich-draft-note.ts` — kept for back-compat; new code must NOT import it.

---

## 4. Realtime: Server-Sent Events on `/api/events`

Drafts are created locally with `status: 'DRAFT'` and shown immediately in the Today list. Background processing emits `note-processed` events when classification completes; the frontend `EventSource` listens and "morphs" the placeholder into the final record.

- `GET /api/events` (`app/api/events/route.ts`)
  - `runtime = 'nodejs'` (need `EventEmitter`)
  - `dynamic = 'force-dynamic'`
  - Sends `event: connected` immediately, then forwards `note-processed` events from `onNoteProcessed(handler)`
  - 25s SSE comment keepalive so proxies don't idle the connection
  - Cleans up via `req.signal` when the client disconnects
- Producer: `emitNoteProcessed(event)` calls in `app/api/notes/[id]/process/route.ts` and the create path of `app/api/capture/route.ts`.

> **Ponytail / upgrade path.** The bus is a single Node-process `EventEmitter`. Multi-instance serverless deployments will lose events across processes — the documented upgrade is to persist events to a `pending_notifications` table and have `/api/events` poll it. Keep the same event shape when swapping.

---

## 5. Auth gate

Authentication is JWT-in-cookie, validated at three layers:

1. **`proxy.ts` (formerly `middleware.ts`)** is the **outer** gate. It runs on every request that isn't `/_next/static`, `/_next/image`, or `favicon.ico`, and:
   - Always lets through `/login`, `/signup`, `/api/auth/login`, `/api/auth/signup`, `/api/auth/logout`.
   - Lets `/api/auth/me` through without redirecting (so the JSON contract is preserved; the route itself returns 401 if the token is invalid).
   - For everything else, reads the `auth_token` cookie, calls `verifySession`. Missing or invalid → `NextResponse.redirect(new URL('/login?redirect=' + pathname, ...))`.
2. **API routes** re-verify inside the handler (defence-in-depth — the proxy could be misconfigured). The pattern is in `lib/auth.ts::verifySession` plus the `AUTH_COOKIE = 'auth_token'` constant.
3. **Server components** read the session with `await cookies()` and call `verifySession` directly, e.g. `app/api/dashboard/route.ts` (the route that powers the Today page after the `/api/today` deletion).

Cookie options (`cookieOptions()` in `lib/auth.ts`): `httpOnly`, `secure` in production, `sameSite='lax'`, `path='/'`, `maxAge = 1 year`.

### Signup is invite-gated

`POST /api/auth/signup` requires `{ email, password, secretCode }`. The `secretCode` must equal `process.env.REGISTRATION_SECRET`. This is the "Pantalla de Contraseña Maestra" described in §7 of the spec — it's the application-level gate before user accounts exist.

---

## 6. PWA

A small but functional PWA shell:

- `app/manifest.ts` exports the manifest (name "Monograph", `appleWebApp.statusBarStyle: 'black-translucent'`, icons `icon-192x192.png` and `icon-512x512.png`).
- `components/pwa/ServiceWorkerRegistrar.tsx` registers `/sw.js` only when `process.env.NODE_ENV === 'production'` (dev would cache-bust everything).
- `next.config.ts` adds a strict CSP for `/sw.js` (`default-src 'self'`) and disables caching so the SW always picks up updates immediately.
- Global headers (`X-Content-Type-Options`, `X-Frame-Options: DENY`, `Referrer-Policy`) apply to every path. A comment in `next.config.ts` explicitly notes "ponytail: CSP estricta, HSTS puede venir cuando haya dominio propio" — that's a future upgrade.

---

## 7. The "single-user assumption"

Several ponytails in the codebase assume one human, one browser session, single-process deploy. Examples to know:

- `app/api/events/route.ts` reuses one global EventEmitter (per-process).
- `app/api/capture/route.ts` doesn't queue/rate-limit; it's serial per request.
- `tests/e2e.spec.ts` shares a single Chrome project and the suite uses one user per run.

These are intentional. Multi-tenant work would change the threat model and the SSE plumbing, but the per-user data scoping (`where: { userId: session.userId }`) is already correct.

---

## Source map (essential files only)

| Path | Why it matters |
|------|---------------|
| `app/layout.tsx` | Root layout — fonts, theme script, mounts NavMenu + CaptureOverlay + SW |
| `proxy.ts` | Auth gate (Next 16 "proxy" replaces "middleware") |
| `next.config.ts` | Security headers, SW CSP |
| `lib/prisma.ts` | Prisma client singleton + pg pool |
| `lib/auth.ts` | JWT sign/verify, cookie helpers, bcrypt |
| `lib/hubs.ts` | 5-domain slug ↔ enum table + canonical Prisma `select`s |
| `lib/projects.ts` | Project DAG, transition validation, ownership, Prisma error mapper |
| `lib/rate-limit.ts` | In-memory rate limiter |
| `lib/draft-events.ts` | In-process bus for SSE events |
| `lib/llm.ts` | Per-user LLM client construction |
| `lib/parse-capture.ts` | AI orchestration + embedding writeback + LLM reranker |
| `lib/types/*` | `NoteItem`, `TaskItem`, `ProjectItem`, error shapes |
| `prisma/schema.prisma` | Data model |
| `app/api/events/route.ts` | SSE stream |
| `app/api/dashboard/route.ts` | Today dashboard payload (six sections) |
