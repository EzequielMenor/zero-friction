# UI, Theme and Tokens

The app is a Next.js 16 client-heavy PWA styled with Tailwind v4 and a small set of semantic CSS variables. Two themes exist: **light (default, sepia)** and **dark (graphite)**, persisted in `localStorage`.

> Read this when adding new UI, choosing a Tailwind class, fixing a flash of wrong theme (FOUC), or adding a new shared animation/keyframe.

---

## 1. Theme tokens — the spine

`app/globals.css` is the single source of truth for tokens. Two sets:

```css
:root {                              /* LIGHT (sepia/papel cálido) — default */
  --bg:              #F5EFE6;
  --surface:         #FAF6EE;
  --surface-elevated:#FFFCF5;
  --border:          #E5DDD0;
  --border-subtle:   #D8CFC0;
  --fg:              #2A2520;
  --fg-muted:        #6B635A;
  --fg-subtle:       #857A6E;
  --fg-faint:        #9A8E80;
  --accent:          #A68966;
  --accent-fg:       #FFFFFF;
  --success:         #16a34a;
  --error:           #dc2626;
}

.dark {                              /* DARK (graphite — original) */
  --bg:              #0B0B0C;
  --surface:         #121214;
  --surface-elevated:#18181B;
  --border:          #1C1C1F;
  --border-subtle:   #2A2A2D;
  --fg:              #E3E2E2;
  --fg-muted:        #A1A1AA;
  --fg-subtle:       #7A7A7A;
  --fg-faint:        #5A5A5A;
  --accent:          #A68966;
  --accent-fg:       #000000;
  --success:         #4ade80;
  --error:           #f87171;
}
```

Light is the default (:root). Dark is opt-in via `.dark` on `<html>`.

The **Tailwind v4 inline bridge** turns each variable into a Tailwind colour:

```css
@theme inline {
  --color-bg:              var(--bg);
  --color-surface:         var(--surface);
  --color-surface-elevated:var(--surface-elevated);
  --color-border:          var(--border);
  /* ... */
}
```

This means you write things like `bg-bg`, `text-fg-muted`, `border-border-subtle`, `bg-accent text-accent-fg` — and Tailwind emits them per-token at build time. Importantly, the `inline` mode keeps the utility bound to the *current* CSS-variable value, so toggling `.dark` swaps colours without rebuilding.

### Watch out: hex literals

Some places deliberately **don't** go through tokens:

- **`app/(app)/hubs/mente/page.tsx`**: domain colours for the `<canvas>` are hex literals (`#D4A843`, `#A78BDB`, …). Canvas can't read CSS vars. If you change a domain colour, update both `globals.css` (chip backgrounds if you add them via `bg-…` utilities) and `DOMAIN_COLORS` here.
- The faint noise overlay (`opacity-0.03`) uses an inline SVG data URL — leave it as-is.

The most recent commits in `git log` repeatedly say "fix(theme): hex residuals" — stay off hardcoded colours in JSX wherever a token exists.

---

## 2. ThemeProvider and anti-FOUC

`components/ThemeProvider.tsx` ships:

- `themeScript` — a literal string injected in `<head>` *before* first paint. It runs synchronously, reads `localStorage.getItem('theme')`, and adds the `.dark` class to `<html>` unless the stored value is `'light'`. Default = dark, preserves historical behaviour for existing users (note the `// default = dark preserva comportamiento para usuarios existentes` comment).
- `ThemeProvider` — React context with `theme`, `setTheme`, `toggleTheme`. Reads `localStorage` lazily on the client, listens for cross-tab `storage` events.
- `useTheme` — hook.

```ts
setTheme('dark')   // → localStorage 'theme' = 'dark', <html class="dark">…
setTheme('light')  // → localStorage 'theme' = 'light', no .dark class
toggleTheme()
```

### Why the FOUC script matters

Without the inline script, the page paints with the default `:root` (light) theme, then React hydrates and the `useState(getStoredTheme)` swaps to dark — visible flash. The script closes that gap by setting `.dark` before paint.

If you add a new theme:

1. Add the `.whatever` CSS class to `globals.css` with the new token set.
2. Update `themeScript` to set that class from `localStorage`.
3. Update `ThemeProvider` and `useTheme` types (`'dark' | 'light' | …`).
4. Update the Apariencia toggle on `/settings`.

---

## 3. Shared animations and keyframes

`globals.css` defines utility classes for the recurring animations. Names follow `animate-<keyframe>`:

- `animate-fade-in` / `animate-fade-out` — 200–250ms.
- `animate-slide-out` — moves + fades; used to remove dismissed toasts.
- `animate-pulse-border` — the "input is listening" border for the capture textarea.
- `animate-pulse-dot` — the tiny status dot in the DRAFT placeholder.
- `animate-scale-in` — overlay entry.

If you need a new shared animation, add the `@keyframes` block + the utility class here. Don't inline `@keyframes` in components — keep them deduplicated.

There's also a `.noise-bg` class for the gentle paper-grain overlay (faint SVG noise). Apply sparingly — fixed positioning + pointer-events-none.

---

## 4. Layouts and chrome

The app presents itself with:

- **Desktop sidebar** — fixed left, 220px wide, in `components/NavMenu.tsx`. Items: Today, Calendar, the five hubs, Mente, Ajustes.
- **Mobile bottom bar** — same items, horizontally scrollable.
- **Capture FAB / overlay** — always mounted in `app/layout.tsx`, hidden on `/login` and `/signup`.
- **Wordmark header** on auth pages — `app/(auth)/layout.tsx` puts a "Monograph" header above the form.

The sidebar offset (`md:ml-[220px]`) lives in `app/(app)/layout.tsx`. The auth layout has no offset. The root layout (`app/layout.tsx`) is the only place that mounts `NavMenu`, `CaptureOverlay`, and `ServiceWorkerRegistrar`.

---

## 5. Typography

Two fonts loaded via `next/font/google` in `app/layout.tsx`:

- **Inter** — body. Variable `--font-inter`.
- **Playfair Display** — headings (`font-serif`).

Use `font-sans` for body copy and `font-serif` for cards/headings. Tokens are CSS variables wired up by Tailwind's font utilities — don't import fonts manually.

There are also subtle class names like `tracking-[0.2em] uppercase text-[11px]` for the wordmark and section headers — keep them consistent (search the codebase before changing).

---

## 6. Icons — inline SVG

`components/icons.tsx` ships a Lucide-style icon set:

- One entry per hub domain (`espiritual`, `personal`, `aprendizaje`, `proyectos`, `registros`, `mente`) plus generic `CalendarIcon`, `HubIcon`, `SettingsIcon`, `FlameIcon`.

All icons:

- viewBox `0 0 24 24`, stroke-width 2, round caps/joins.
- Inlined as React components — no icon-package dependency.
- Rendered with `currentColor`, so a parent `text-accent` recolours them automatically.

> Ponytail: "inline SVG icons, no icon lib dependency". Adding icons = adding an entry in `iconPaths`. Keep the visual language (stroke-based, no fills) consistent.

---

## 7. UI components worth knowing

| Component | File | Responsibility |
|-----------|------|---------------|
| `CaptureOverlay` | `components/CaptureOverlay.tsx` | Capture FAB + modal (see `openwiki/capture-and-ai.md`) |
| `NavMenu` | `components/NavMenu.tsx` | Sidebar + bottom bar |
| `NotePanel` | `components/NotePanel.tsx` | Inline editor + goal acceptance + reflections |
| `InboxSection` | `components/InboxSection.tsx` | The maintenance + important list on Today |
| `Toast` | `components/Toast.tsx` | Lightweight top-right toast queue |
| `ThemeProvider` | `components/ThemeProvider.tsx` | Theme context + anti-FOUC script |
| `ServiceWorkerRegistrar` | `components/pwa/ServiceWorkerRegistrar.tsx` | Registers `/sw.js` in production only |
| `icons` | `components/icons.tsx` | Inline SVG icon set |

Ponytails sprinkled across these files call out a "no-X-lib" stance (no state lib, no portal lib, no chart lib, no date lib, no icon lib). Keep the dep surface small until something hurts.

---

## 8. Adding UI safely

- **New Tailwind colour** → only if there's a token for it. Add to `globals.css` (both `:root` and `.dark`), then to `@theme inline`.
- **New component** → `components/*.tsx`, default to client component only if it needs state/effects. Server-first.
- **New page** → place in `app/(app)/…` if it needs the auth gate and the sidebar, or `app/(auth)/…` for self-contained ones. There's no `app/(public)/…` group.
- **New animation** → add the keyframe + utility to `globals.css`.
- **A11y** → every interactive card uses `<button>` or `<Link>`. Modal overlays need `aria-modal`, focus trap is currently done with `tabIndex` (ponytail — full focus trap is the documented upgrade).

---

## Source map

| Path | Why it matters |
|------|---------------|
| `app/globals.css` | Tokens, theme variants, keyframes, `.noise-bg` |
| `app/layout.tsx` | Root layout, font variables, anti-FOUC script, mounts chrome |
| `components/ThemeProvider.tsx` | Theme context + `themeScript` |
| `components/NavMenu.tsx` | Desktop sidebar + mobile bottom bar |
| `components/icons.tsx` | Inline-SVG icon set |
| `components/CaptureOverlay.tsx` | Capture FAB + overlay |
| `components/InboxSection.tsx` | Today maintenance + important lists |
| `components/NotePanel.tsx` | Inline note editor |
| `components/Toast.tsx` | Toast queue |
| `components/pwa/ServiceWorkerRegistrar.tsx` | Production-only SW registration |
| `app/(app)/layout.tsx` | Sidebar offset + content max-width |
| `app/(auth)/layout.tsx` | Centred auth layout + wordmark |
