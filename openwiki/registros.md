# Registros — Fuerza / Finanzas / Hábitos

The `REGISTROS` domain is a time-series store with three specialised sub-views. Each has its own URL, its own API route, and its own Prisma-backed tables (Hevy CSV, financial cycles, daily habit logs).

> Read this when changing workout ingestion, the financial cycle math, the habit heatmap, or any of the three sub-API routes. Also read `openwiki/capture-and-ai.md` to understand the AI branch that writes into these tables.

---

## 1. Where everything lives

```
app/(app)/hubs/registros/
├── fuerza/page.tsx              # Hevy CSV import + 1RM + AI Coach
├── finanzas/page.tsx            # Cycle around payroll, accounts, donut
└── habitos/page.tsx             # Streak (🔥) + monthly heatmap

app/api/registros/
├── fuerza/
│   ├── route.ts                 # GET sets / 1RM series / CoachAdvice
│   ├── import/route.ts          # POST a Hevy CSV (early-stop parser)
│   └── route.ts
├── finanzas/route.ts            # Cycles, totals, transactions
└── habitos/route.ts             # List + toggle today's log

app/api/subscriptions/[id]/route.ts  # Subscriptions CRUD (used by finanzas + today)
app/api/accounts/route.ts             # Account CRUD (finanzas)

prisma/schema.prisma
├── Workout (@@unique [userId, date])
├── WorkoutSet
├── Transaction (optional subscriptionId, optional accountId)
├── Subscription
├── Account
├── Habit
├── HabitLog (@@unique [habitId, date])
└── CoachAdvice (@@unique userId)
```

The capture flow LLM-routes into these tables when the parsed `recordType` is `gimnasio | finanzas | habito` (see `lib/parse-capture.ts`).

---

## 2. Fuerza — workouts (`/hubs/registros/fuerza`)

### Data model

- `Workout`: one per user per day (`@@unique([userId, date])`), with `title`, optional `duration`.
- `WorkoutSet`: rows with `exerciseName`, `weight`, `reps`, `setType`, optional `supersetId`.

### Hevy CSV importer

Spec §5.2.A says: *"the backend stops the moment it finds a workout whose date already exists in the DB"*. This is implemented as an **early-stop** read of the CSV in `app/api/registros/fuerza/import/route.ts`:

1. Read the user's most recent `Workout` (highest `date`).
2. Parse the CSV top-down (newest → oldest, per Hevy's export convention).
3. For each row, compare to the last-seen DB date. When a duplicate date is hit, **break** — don't read further.

> Ponytail / upgrade path: an actual early-exit stream parse would be `node:stream` from the request body; today the route buffers the entire CSV in memory. Fine for personal-scale imports; switch to streaming for thousand-row files.

### Charts

- **Volume over time** (sum of `weight × reps` per day).
- **Estimated 1-Rep Max** per main lift. The implementation uses the Epley formula `1RM ≈ weight × (1 + reps / 30)`; some lifts use Brzycki — see `app/(app)/hubs/registros/fuerza/page.tsx`.

> If you add a new chart, keep its source data behind a single GET handler so the page re-fetches in one shot.

### AI Coach

`GET /api/registros/fuerza` returns `CoachAdvice` (one per user; `@@unique([userId])`). The page calls an LLM analysis task to write the advice string periodically; the schema field is `CoachAdvice.content`. The cron policy ("análisis periódico") is not yet wired — there's a ponytail comment to that effect. Any new scheduler can write to `CoachAdvice.content` directly; the page reads it on each load.

### Capture branches

`createWorkoutFromParsed` in `lib/parse-capture.ts` upserts the day's `Workout` (or creates it) and adds a single `WorkoutSet` with `setType: 'normal'`, `reps: 1`. This is intentionally minimal — full workout entry happens via the CSV import, not via dictation.

---

## 3. Finanzas (`/hubs/registros/finanzas`)

### Data model

- `Account`: bank/wallet with `name`, `initialBalance`, `currency` (default `EUR`).
- `Transaction`: `amount` (negative = expense), `description`, `date`, `category`. Optional links to a `Subscription` (recurring paid expense) and/or an `Account` (which account the movement came from).
- `Subscription`: `name`, `amount`, `dayOfMonth`, links to all matching `Transaction`s.

### Cycle math (`Spec §5.2.B`)

The "mes financiero" is **not** calendar-month. It's the period between two consecutive "Nómina" transactions. Whenever the user records an income categorised as `NOMINA` (or whichever payroll category is in use), the previous cycle closes and a new one starts. Implementation note in `app/api/registros/finanzas/route.ts`:

> ponytail: cycle boundary detection treats the most recent Nómina transaction as `cycleStart`. The cycle is `cycleStart` → next Nómina (exclusive). For the first cycle, start = oldest Nómina; balance and totals are over that window.

### Visualisation

- Net balance for the current cycle = `sum(transactions in window).amount`.
- Donut chart (5 basic categories). See `app/(app)/hubs/registros/finanzas/page.tsx` for the layout; it uses inline SVG, no chart library — keep it that way unless you have a reason.
- Subscriptions panel: list + "validate today?" CTA (also surfaced on the Today dashboard as `dueSubscription`).

### Account tracking

`POST /api/accounts` creates a new account (validated `name`, `initialBalance` defaults to 0). The list endpoint `GET /api/accounts` returns `{ id, name, initialBalance, currentBalance, currency, createdAt }` where `currentBalance = initialBalance + sum(transactions.amount)`.

`Transaction` may be linked to an `Account` via `accountId`; per-user filtering always uses `userId` *and* the `Account` ownership.

### Capture branch

`createTransactionFromParsed` writes a single `Transaction` with `date = now`, `category` from parsed metadata (default `'VARIOS'`). It does not yet attempt to set `subscriptionId` (manual via UI) or `accountId` (planned).

---

## 4. Hábitos (`/hubs/registros/habitos`)

### Data model

- `Habit`: `name`, `frequency` (stored as a string; not yet an enum — see ponytail in `app/api/registros/habitos/route.ts`).
- `HabitLog`: per-day truth log — `@@unique([habitId, date])` with `completed: boolean`. Stored at midnight UTC-equivalent (server local).

### UI

- **Streak** — current consecutive-day run (`🔥 N`). Recomputed on each `/api/habits` GET.
- **Heatmap** — 7 × N grid (GitHub style) of `completed` per day. Density colour-coded.

### Toggle behaviour

The `POST /api/habits` endpoint (and `createOrToggleHabitLogFromParsed` from capture) implements **toggle, not set**:

- If today's `HabitLog` exists → flip `completed`.
- Otherwise create with `completed = true`.

A "mark not done" UI affordance is not yet present (you can only flip from done back to not-done via the same button). This is the documented "could be richer" path.

### Capture branch

`createOrToggleHabitLogFromParsed` finds-or-creates the `Habit` by name (case-sensitive `equals`), then toggles today's `HabitLog`. As soon as the LLM classifies a voice note as a habito, the daily check-in happens.

---

## 5. Today dashboard integrations

From `app/api/today/route.ts`:

- **Hábitos** — the dashboard lists all habits and a "Completar [name]" button. Hitting the button calls `POST /api/habits`.
- **Validación de suscripción** — picks a `Subscription` whose `dayOfMonth === today.dayOfMonth` and which has no `Transaction` today. The user sees "¿Te han cobrado hoy [name] ([amount]€)?" with `[Sí]` / `[No]`. Both actions write a `Transaction` (positive or negative) and link it via `subscriptionId`.

---

## 6. Cross-cutting concerns

- **Server-local timezone.** Day boundaries for `Workout`, `HabitLog`, and the subscription validation are computed in the server's TZ (`ponytail`). Per-user tz would need client reporting + storage.
- **Aggregations.** All "today" / "this cycle" / "this month" predicates run in SQL (`WHERE dueDate >= $startOfToday AND dueDate < $startOfTomorrow`). Don't post-filter in JS.
- **Money values.** `Float`, not decimal. The current dataset is personal-scale single-currency (EUR). Don't switch silently — this is financial data.
- **Indexes.** Most user-scoped queries already use the `userId` index implicitly via the foreign key. Sparse uniques to remember: `Workout @@unique([userId, date])`, `HabitLog @@unique([habitId, date])`, `NoteRelationship @@unique([sourceNoteId, targetNoteId])`.

---

## 7. Common changes and where they land

| Change | Edit |
|---|---|
| New workout chart | `app/(app)/hubs/registros/fuerza/page.tsx`, then add data to `app/api/registros/fuerza/route.ts` |
| New transaction category | `lib/parse-capture.ts::SYSTEM_PROMPT` (adds it for capture); UI list in `app/(app)/hubs/registros/finanzas/page.tsx` |
| Currency switch | `prisma/schema.prisma` → `Account.currency` is already `String`. Persist per-account, surface in UI. |
| Habit frequency enum | `prisma/schema.prisma` → change `frequency String` to enum; add migration; update capture prompt to set `daily/weekly/...`. |
| Rename "Nómina" trigger | `app/api/registros/finanzas/route.ts` — change the matching category string, update the cycle-boundary detector. |
| Coach schedule | Currently manual. Add a cron route (e.g. `app/api/cron/coach/route.ts`) that re-runs the analysis and upserts `CoachAdvice`. |

---

## Source map

| Path | Why it matters |
|------|---------------|
| `app/(app)/hubs/registros/fuerza/page.tsx` | Gym UI (charts, import, coach) |
| `app/(app)/hubs/registros/finanzas/page.tsx` | Cycle UI (donut, subs) |
| `app/(app)/hubs/registros/habitos/page.tsx` | Habit UI (streak + heatmap) |
| `app/api/registros/fuerza/route.ts` | Force data: sets, 1RM, coach |
| `app/api/registros/fuerza/import/route.ts` | Hevy CSV ingestion (early-stop) |
| `app/api/registros/finanzas/route.ts` | Cycle math + transaction list |
| `app/api/registros/habitos/route.ts` | Habit list + toggle |
| `app/api/subscriptions/[id]/route.ts` | Subscriptions CRUD |
| `app/api/accounts/route.ts` | Account CRUD + balance |
| `app/api/today/route.ts` | Includes `habits` + `dueSubscription` sections |
| `lib/parse-capture.ts` | `createWorkoutFromParsed`, `createTransactionFromParsed`, `createOrToggleHabitLogFromParsed` |
| `prisma/schema.prisma` | Workout, WorkoutSet, Transaction, Subscription, Account, Habit, HabitLog, CoachAdvice |
