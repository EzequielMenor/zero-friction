# Hubs, Domains and the Mente Graph

The five "life domains" are the organising axis of the product. Each gets its own deep-work screen ("Hub"); Today aggregates across them; Mente shows them as a force-directed graph of similarity.

> Read this when adding a domain, modifying the Today dashboard, building a new hub screen, or touching the d3-force canvas.

---

## 1. The five domains

Defined exactly once, in `lib/hubs.ts`:

```ts
export const HUBS = [
  { slug: 'espiritual',  enum: 'ESPIRITUAL',   icon: 'espiritual',  label: 'Espiritual'  },
  { slug: 'personal',    enum: 'PERSONAL',     icon: 'personal',    label: 'Personal'    },
  { slug: 'aprendizaje', enum: 'APRENDIZAJE',  icon: 'aprendizaje', label: 'Aprendizaje' },
  { slug: 'proyectos',   enum: 'PROYECTOS',    icon: 'proyectos',   label: 'Proyectos'   },
  { slug: 'registros',   enum: 'REGISTROS',    icon: 'registros',   label: 'Registros'   },
] as const
```

The Postgres enum is in `prisma/schema.prisma` (`enum Domain { ESPIRITUAL PERSONAL APRENDIZAJE PROYECTOS REGISTROS }`). `HUBS` is the only file you should need to edit to add a sixth domain — and even then, the additions are far-reaching (see §7).

### What each domain is for (product framing)

- **Espiritual** — Bible study notes, JW Library summaries, meeting notes. Hub is a Markdown-leaning editor with LLM-extracted tags and a "Convert goal" CTA that promotes a goal into the PROYECTOS domain.
- **Personal** — Journal, ideas, free-form reflections. Tag-fuzzy, no due dates.
- **Aprendizaje** — Reusable technical notes, programming cheats, AI/ML docs. Has an "External links" panel for cross-domain items that pgvector discovered.
- **Proyectos** — Actionable tasks. The only domain rendered prominently on Today (Focus, Today, Maintenance rows).
- **Registros** — Time-series style records. Has its own folder with three sub-hubs (Fuerza / Finanzas / Hábitos) covered in `openwiki/registros.md`.

---

## 2. The generic Hub screen

`/hubs/<slug>` is served by `app/(app)/hubs/[domain]/page.tsx`. It is a **server component**:

```ts
export default async function HubPage({ params }) {
  const { domain } = await params
  if (!(SUPPORTED_SLUGS as readonly string[]).includes(domain)) {
    redirect('/')
  }
  return <HubContent slug={domain} />
}
```

`SUPPORTED_SLUGS` is the slug array from `lib/hubs.ts`. Any unknown slug redirects to `/`.

`HubContent` (`app/(app)/hubs/[domain]/HubContent.tsx`) is the **client component** rendering the list. It:

- Fetches notes via `GET /api/hubs/[domain]` filtered to that single domain.
- Renders them as cards (`NoteCard`) with the status badge (`Borrador / Activa / En curso / Hecha`), relativeTime formatting (`Intl.RelativeTimeFormat('es-AR')`), and a domain icon (`domainMeta(domain).icon`).
- Opens a `NotePanel` (`components/NotePanel.tsx`) when a card is clicked; the panel handles editing, archive, and goal acceptance.

The "External links" panel from the spec (Aprendizaje) is rendered inline by `HubContent` for any note that has incoming relationships from other domains. Implementation detail: a second `GET /api/notes/[id]` call (or a batch variant) returns the relationships; the panel collapses by default.

> Each domain gets **its own** domain page where this is helpful: `app/(app)/hubs/registros/{finanzas,fuerza,habitos}/page.tsx` and `app/(app)/hubs/mente/page.tsx` are NOT routed through `[domain]/page.tsx` because they don't fit the "list of notes" shape.

### Single source of truth

Everywhere a domain appears — `NavMenu`, the hubs API, the dynamic route — uses `lib/hubs.ts::HUBS` / `toDomainEnum(slug)` / `domainMeta(domain)`. Don't hardcode slugs.

---

## 3. The NotePanel (`components/NotePanel.tsx`)

A client-side editor + viewer. Responsibilities:

- View a note's title, content, tags, status, dueDate, suggestedGoals.
- Edit inline (optimistic save, debounced).
- For ESPIRITUAL notes: show `suggestedGoals` and a "Aceptar como Meta" button that POSTs to `/api/notes/[id]/accept-goal` — this duplicates the goal as a fresh `Note` in the `PROYECTOS` domain.
- Open the reflection thread (`POST /api/notes/[id]/reflection`) which appends to the content (chronological).
- Archive / delete via `DELETE /api/notes/[id]`.

The panel is portal-style — it overlays the hub but keeps the rest of the surface visible to preserve the "isolation of context" described in the spec.

---

## 4. Today dashboard (`app/(app)/page.tsx`)

A client component that fetches `/api/today` on load and again on each SSE `note-processed`. Built from six sections (each becomes a card):

| Section | Source data | Route segment |
|---|---|---|
| **Focus widget** | Single `PROYECTOS` note with `status: IN_PROGRESS` | `/` |
| **Hoy** (today tasks) | `PROYECTOS` notes due today (`status: ACTIVE \| IN_PROGRESS`) | `/` |
| **Consola de mantenimiento** | `PROYECTOS` notes with `dueDate < today` OR `(dueDate null AND isImportant)` | `/` |
| **Hábitos** | All `Habit`s; each row has a "Completar [Habit]" button | `/` |
| **Resurgimiento** | One random `ESPIRITUAL` or `PERSONAL` note older than 180 days | `/` |
| **Validación de suscripción** | Today-qualified `Subscription` (matching day-of-month) without a `Transaction` today | `/` |

The "Maintenance" + "Today" + "Focus" widgets only show data from the PROYECTOS domain — that's the entire reason PROYECTOS exists in the model. Other domains show up via Hub views, never on Today, by design.

### Buttons in Mantenimiento

Each maintenance row offers four one-tap moves:

- `[Hoy]` → set `dueDate = now (midnight)`
- `[Mañana]` → set `dueDate = now + 24h`
- `[Al Backlog]` → set `dueDate = null`, keep `status: ACTIVE`
- `[Dejar aquí]` → leave alone for now

These map to `PATCH /api/notes/[id]`. The notes component handles the visual transition; the API persists.

The route: see `app/api/today/route.ts`. Single Prisma query per section, run in parallel with `Promise.all`. Time math is done with the server's local timezone (`ponytail` — per-user tz would require client reporting).

---

## 5. Mente — the semantic graph (`app/(app)/hubs/mente/page.tsx`)

A full-screen `<canvas>` powered by `d3-force`. Source data is `GET /api/graph`:

```ts
{ nodes: [{ id, title, domain }], links: [{ source, target, similarity }] }
```

`POST /api/graph` does not exist — all data is GET. The route reads `Note` + `NoteRelationship` and shapes them for the simulation.

### Simulation

A `forceSimulation<GraphNode, GraphLink>` with:

- `forceLink` — link distance scales by similarity (closer nodes are more related).
- `forceManyBody` — repulsion.
- `forceCollide` — radius based on neighbour count to avoid overlap.
- `forceCenter` + `forceX`/`forceY` — keeps the cloud inside the viewport.

### Rendering

Each node is a dot filled with its domain colour:

```ts
const DOMAIN_COLORS = {
  ESPIRITUAL:  '#D4A843',
  PERSONAL:    '#A78BDB',
  APRENDIZAJE: '#60A5FA',
  PROYECTOS:   '#34D399',
  REGISTROS:   '#FB923C',
}
```

(These hex values are intentional for the canvas — they pre-date the CSS-variable system and live here because `<canvas>` doesn't read CSS vars. If you change them, also update the chip/icon backgrounds in `HubContent.tsx`.)

Interactions: drag a node (saves new `x,y` to the simulation local state), scroll-zoom (a custom transform matrix), hover highlights neighbours, click → open the `NotePanel`.

> Ponytail: forces/positions are recomputed each render; if you move to a server-side layout you'll need to persist `x,y` on `Note` (or a `GraphNodeState` table).

---

## 6. Calendar (`app/(app)/calendar/page.tsx`)

Month view of due tasks. Reuses `lib/hubs.ts` constants. Pulls from `/api/calendar`, which returns `Note[]` with `dueDate` populated for any domain (calendar is non-domain-scoped).

---

## 7. Adding a new domain

> Big change. Plan before starting.

You will need to touch:

1. `prisma/schema.prisma` → add to `enum Domain`. Then `pnpm exec prisma migrate dev --name add_<name>_domain`.
2. `lib/hubs.ts` → add a row to `HUBS` array.
3. `components/icons.tsx` → add an icon path under `iconPaths`.
4. `app/(app)/hubs/mente/page.tsx` → add a colour in `DOMAIN_COLORS`.
5. Capture prompt — `lib/parse-capture.ts::SYSTEM_PROMPT` — add the new domain to the enum list and to the prompt text.
6. `RESPONSE_SCHEMA` in `parse-capture.ts` — extend the `domain` enum.
7. `app/api/hubs/[domain]/route.ts` — should automatically work because it filters by `Domain` enum.
8. `app/(app)/page.tsx` — Today is `PROYECTOS`-only; if the new domain should appear on Today, add a new section.
9. `components/NavMenu.tsx` — auto-iterates `HUBS`, no edit needed.
10. `zero-friction-spec.md` — update the spec; this is the source of truth for product semantics.

The cost of renaming a domain (and not creating a new one) is roughly half that.

---

## Source map

| Path | Why it matters |
|------|---------------|
| `lib/hubs.ts` | Domain slug ↔ enum — single source of truth |
| `app/(app)/hubs/[domain]/page.tsx` | Server entry, slug validation |
| `app/(app)/hubs/[domain]/HubContent.tsx` | List + cards + relations panel |
| `components/NotePanel.tsx` | Side editor, goal acceptance, reflections |
| `app/(app)/page.tsx` | Today dashboard (six sections) |
| `app/(app)/hubs/mente/page.tsx` | d3-force canvas |
| `app/api/today/route.ts` | Today payload |
| `app/api/graph/route.ts` | Nodes + links payload |
| `app/api/hubs/[domain]/route.ts` | Single-hub notes feed |
| `app/api/calendar/route.ts` | Calendar payload |
| `components/icons.tsx` | Hub icons |
