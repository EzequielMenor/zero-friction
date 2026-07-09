# Zero-Friction — OpenWiki Quickstart

> **Monograph** is a personal "operating system" web app: capture anything (text or voice), let an LLM classify it into one of five life domains, store it as a vector-embedded note in PostgreSQL, and consume the result through a distraction-free UI.

This is the entry point for humans and agents working in the repository. Read this first, then follow the section links.

---

## What this project is

Zero-Friction (UI brand: **Monograph**) is a single-user productivity app whose goal is to *eliminate the friction of organising information*. The user only writes or speaks. All routing, tagging, due-date detection, and cross-domain linking happens in the background via an LLM + pgvector embeddings.

The full Spanish specification lives in `/zero-friction-spec.md` at the repo root — it is the canonical product doc.

### Key product ideas

- **Capture in < 2 seconds.** Floating overlay (`Cmd/Ctrl+K` on desktop, floating FAB on mobile), with voice transcription and a dynamic auto-send countdown.
- **Five life domains, one physical model.** Notes have exactly one `Domain` (ESPIRITUAL, PERSONAL, APRENDIZAJE, PROYECTOS, REGISTROS). Cross-domain links live in `NoteRelationship` and are shown in collapsible side-panels inside each hub.
- **"Today" as execution surface.** A dashboard (`app/(app)/page.tsx`) listing Focus + Today's tasks + Maintenance + Habits + Resurgence + Subscription validation. Data comes from `GET /api/dashboard`; the legacy `/api/today` route was removed when **Note was split into `Note` (knowledge) + `Task` (execution)**, so the Today rows are now `Task`s (1:1 with a Note) rather than bare notes.
- **"Hubs" as deep-work surfaces.** Each domain has an isolated hub view (`/hubs/[domain]`) where the sidebar and other-domain noise disappear.
- **"Mente" as a semantic graph.** A full-screen `d3-force` canvas drawing all notes + their typed relationships (`RELATED`, `SUPPORTS`, `CONTRADICTS`, `EXAMPLE_OF`, `CONTINUES`, `RELATED_PROJECT`, `REFERENCES`) at `/hubs/mente`.
- **Projects as semantic containers.** A `Project` is a user-owned, status-tagged bag of `Note`s (`IDEATION` → `ACTIVE` → `MAINTENANCE` → `ARCHIVED`). Notes get an optional `projectId`; tasks inherit it via the `Task → Note → Project` join. Badged on Today and Hub cards via `components/ProjectBadge.tsx`.
- **Registros subdomains.** Fuerza (gym CSV import), Finanzas (cycles around payroll), Hábitos (streak + heatmap) inside the Registros hub.

---

## Tech stack at a glance

| Layer | Choice | Where to look |
|-------|--------|---------------|
| Framework | **Next.js 16 App Router** (React 19) | `app/layout.tsx`, `next.config.ts` |
| Auth | JWT in HTTP-only cookie via `jose` + `bcryptjs` | `lib/auth.ts`, `proxy.ts` |
| ORM | **Prisma 7** + `@prisma/adapter-pg` driver-mode | `lib/prisma.ts`, `prisma/schema.prisma` |
| DB | **PostgreSQL with pgvector** (Supabase) | `prisma/schema.prisma` (`Unsupported("vector(1536)")?`) |
| AI | OpenAI SDK (`openai`) — per-user LLM + embedding keys | `lib/llm.ts` |
| Voice | MediaRecorder → OpenAI Whisper | `app/api/capture/route.ts` |
| Realtime | **Server-Sent Events** on `/api/events` (in-process `EventEmitter` bus) | `lib/draft-events.ts`, `app/api/events/route.ts` |
| Graph | `d3-force` simulation on `<canvas>` (Mente page) | `app/(app)/hubs/mente/page.tsx` |
| Styling | **Tailwind CSS v4** with CSS-variable tokens, light/dark via `.dark` class | `app/globals.css`, `components/ThemeProvider.tsx` |
| PWA | Manifest + service worker registered only in production | `app/manifest.ts`, `components/pwa/ServiceWorkerRegistrar.tsx` |
| Tests | **Playwright** (single-CRT spec running real DB seeds) | `tests/e2e.spec.ts`, `playwright.config.ts` |

> The Next.js version is **16.2.9** with the new `proxy.ts` (was `middleware.ts`); some APIs and conventions differ from training data. `AGENTS.md` carries a rule pointing to `node_modules/next/dist/docs/` before writing Next code.

---

## Repository layout

```
.
├── app/                          # Next.js App Router
│   ├── (app)/                    # Authenticated route group — sidebar lives in root layout
│   │   ├── page.tsx              # "Today" dashboard (fetches /api/dashboard)
│   │   ├── calendar/page.tsx
│   │   ├── settings/page.tsx
│   │   └── hubs/
│   │       ├── [domain]/         # Generic hub page (espiritual, personal, …)
│   │       ├── mente/            # d3-force graph canvas
│   │       └── registros/        # Fuerza / Finanzas / Hábitos
│   ├── (auth)/                   # Centred, no sidebar
│   │   ├── login/page.tsx
│   │   └── signup/page.tsx
│   ├── api/                      # Route handlers — auth, capture, notes, tasks, projects,
│   │                             # dashboard, calendar, graph, hubs, habits, registros,
│   │                             # accounts, subscriptions, search, settings, events (see architecture.md)
│   ├── globals.css               # CSS-variable token system
│   ├── layout.tsx                # Root layout — ThemeProvider + NavMenu + CaptureOverlay + SW registrar
│   └── manifest.ts               # PWA manifest
├── components/                   # CaptureOverlay, NavMenu, NotePanel, ProjectBadge,
│                                 # ThemeProvider, Toast, icons, pwa/
├── lib/
│   ├── auth, prisma, llm, hubs, draft-events, parse-capture
│   ├── projects.ts               # Pure logic — DAG of status transitions, mappers, ownership
│   ├── rate-limit.ts             # In-memory rate limiter (single-user assumption)
│   ├── types/                    # Single source of truth for NoteItem, TaskItem, ProjectItem, …
│   └── legacy/                   # Deprecated helpers (kept for back-compat — see enricht-draft-note.ts)
├── prisma/
│   ├── schema.prisma             # 14 models — see auth-and-data.md
│   ├── migrations/               # Chronologically-numbered migrations
│   └── backfill-notes-to-tasks.ts  # One-off Migration A companion
├── tests/
│   ├── e2e.spec.ts               # Playwright end-to-end suite
│   ├── helpers/                  # factories.ts, test-setup.ts (vitest)
│   └── unit/                     # vitest run for pure logic
├── proxy.ts                      # Next 16 proxy — auth gate
├── next.config.ts                # Security headers + SW content-type
├── playwright.config.ts
├── vitest.config.ts
├── prisma.config.ts
├── tailwind.config.ts            # Tailwind v4 reads tokens from globals.css via @theme inline
├── zero-friction-spec.md         # ← canonical product spec (Spanish)
├── docs/sdd/{active,completed}/  # Per-feature design + retrofit files (see testing-and-operations.md)
└── README.md                     # Now leads with the Note + Task model + ADR link
```

---

## Where to start, by task

| If you want to… | Read this |
|---|---|
| Understand the product in one sitting | `/zero-friction-spec.md` (full spec) |
| Add or change an API route | `openwiki/architecture.md`, then `openwiki/capture-and-ai.md` for the AI side |
| Modify how a captured note is parsed | `openwiki/capture-and-ai.md` (full prompt + schema reference) |
| Add a new domain / hub screen | `openwiki/hubs-and-domains.md` |
| Touch workouts, finances, habits | `openwiki/registros.md` |
| Change auth, schema, migrations | `openwiki/auth-and-data.md` |
| Change colours, theme, layout | `openwiki/ui-and-theme.md` |
| Run, test, or build the app | `openwiki/testing-and-operations.md` |

---

## Conventions observed in the codebase

These are non-obvious rules agents should respect before writing code.

- **"ponytail" comments are intentional shortcuts.** Throughout the source you'll see comments like `// ponytail: ... upgrade path: …`. These mark places where a simpler implementation was chosen on purpose and the planned upgrade is documented inline. Treat them as decisions to preserve, not TODOs to "fix".
- **Spanish UI strings.** All user-facing copy is `es-AR`. Locale hardcoded in date formatters.
- **Inline SVG icons.** There is no icon library; every icon lives in `components/icons.tsx`. Don't pull in an icon dependency without asking.
- **Tailwind v4 + CSS variables.** Colours aren't hex in JSX; they are CSS variables (`bg-bg`, `text-fg-muted`, `border-accent`) that flip on the `.dark` class. See `openwiki/ui-and-theme.md`.
- **Per-user LLM config + env fallback.** `lib/llm.ts` reads from `LLMConfig` DB table first, then falls back to env. API key on the wire is masked (`••••••••`) so the UI cannot leak secrets.
- **In-process SSE only.** The draft-morphing events bus is a single-process `EventEmitter`. If/when deploying multi-instance, swap to a polled `pending_notifications` table — this is the documented upgrade path in `lib/draft-events.ts`.
- **Auth gate is server-side.** Every API route reads the cookie with `AUTH_COOKIE` and verifies with `verifySession`. Don't bypass with client flags.
- **One DRAFT → ACTIVE race guard.** `POST /api/notes/[id]/process` (`app/api/notes/[id]/process/route.ts`) uses a CAS `updateMany` on `noteStatus = 'DRAFT'` so two concurrent `process` requests can't both succeed. On AI failure the same CAS promotes the note to `NEEDS_REVIEW` instead.
- **Task is unique to its Note.** `Task.noteId` is `UNIQUE` and `onDelete: Cascade`; the DB also enforces a partial unique (`Task_one_focus_per_user`) so at most one task per user may have `focusedAt != null`.
- **Project is informational.** `Note.projectId` is `SetNull` on Project delete — the Second Brain (Note + embeddings + relationships) survives a project deletion. Tasks have no `projectId`; the UI derives project via `Task → Note → Project`.
- **Rate-limited routes.** Sensitive POSTs (`/api/projects`) go through `lib/rate-limit.ts` (in-memory). On multi-instance deploys, swap to Redis or Vercel KV.

---

## How to run locally

```bash
pnpm install
pnpm dev                    # http://localhost:3000

# Generate Prisma client (build does this automatically):
pnpm exec prisma generate

# Migration (apply against $DATABASE_URL):
pnpm exec prisma migrate deploy

# E2E tests (require a running dev server + seeded DB):
pnpm exec playwright test
```

Required env (no live values are stored in this repo): `DATABASE_URL`, `JWT_SECRET`, `REGISTRATION_SECRET`, and any of `LLM_API_KEY` / `LLM_BASE_URL` / `LLM_MODEL` / `EMBEDDING_MODEL` / `WHISPER_*` if no per-user LLM config is set.

See `openwiki/testing-and-operations.md` for build, migration, and CI notes.
