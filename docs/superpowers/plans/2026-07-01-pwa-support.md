# PWA Support Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Make the app installable as a PWA on macOS (Chrome/Edge) and iOS (Safari). Spec (§7) calls for it explicitly.

**Current state:**
- `public/` has only default Next.js SVGs (file.svg, globe.svg, next.svg, vercel.svg, window.svg) — **zero PWA icon assets**
- `app/layout.tsx` has basic `Metadata` with title/description — no manifest link, no theme-color, no apple-touch-icon
- `next.config.ts` is empty — no security headers, no SW headers
- No `manifest.json` or `manifest.ts`
- No service worker (`public/sw.js` or any registration)
- No `apple-mobile-web-app-capable` meta tag in layout

**Architecture:** Next.js 16.2.9 App Router. Official PWA guidance in docs is minimal (manifest + push notifications guide; offline support deferred to community tools like Serwist). No `next-pwa` package exists for this version — the old `@serwist/next` is the community standard for offline support but requires webpack config.

---

## Proposed Approach

### Web App Manifest — via Next.js MetadataRoute

Next.js 16 supports `app/manifest.ts` natively — a Route Handler returning `MetadataRoute.Manifest`. Use this instead of a static JSON file.

### Service Worker — Minimal on-demand cache

No offline-first strategy (overkill for a personal app that requires auth). Instead:
- **Minimal SW** that caches app shell assets (CSS, fonts, icons) on first load
- **Network-first** for all API routes and pages (no stale data)
- Registered from a small inline script in layout or a `<Script>` component

This gives the "installed app" feel (loads shell from cache on repeat visits) without the complexity of full offline support.

### Icon Assets — Honest Gap

`public/` has zero PWA icons. The plan MUST flag this: icons need to be generated. Options:
1. **Generate from the app's existing SVG** — use a tool like `pwa-asset-generator` or a favicon generator service.
2. **Use a simple script** — generate 192x192 and 512x512 PNGs from a solid-color square with initials.
3. **Manual** — create and place files manually.

The plan will scope icon generation as a step with a placeholder approach (generate from a simple source) and call out that a designer could replace them later.

### Registration — Inline script in layout

No external deps. A `'use client'` component or a `<script>` tag that checks `'serviceWorker' in navigator` and registers `/sw.js`.

---

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `app/manifest.ts` | Create | Web app manifest via `MetadataRoute.Manifest` |
| `public/sw.js` | Create | Minimal service worker (network-first, cache shell) |
| `components/pwa/ServiceWorkerRegistrar.tsx` | Create | Client component to register SW + add iOS meta tags |
| `app/layout.tsx` | Modify | Add `themeColor`, `appleWebApp` metadata; mount SW registrar |
| `next.config.ts` | Modify | Add security headers (Content-Type, Cache-Control for sw.js) |
| `public/icon-192x192.png` | Generate | PWA icon (192x192) |
| `public/icon-512x512.png` | Generate | PWA icon (512x512) |
| `public/apple-icon-180x180.png` | Generate | Apple touch icon (180x180) |

---

## Implementation Tasks

### Task 1: Web App Manifest (`app/manifest.ts`)
- [ ] Create `app/manifest.ts`:
  - `name`: "Monograph | Zero-Friction OS"
  - `short_name`: "Monograph"
  - `description`: existing description
  - `start_url`: `/`
  - `display`: `standalone`
  - `background_color`: `#1C1C1E` (graphite dark)
  - `theme_color`: `#A68966` (gold accent)
  - `icons`: 192x192 and 512x512 PNGs

### Task 2: PWA Icons (`public/icon-*.png`)
- [ ] Generate 192x192 and 512x512 PNG icons from a simple source
  - Option A: `npx pwa-asset-generator` on an SVG source
  - Option B: create a minimal solid-color PNG with initials via a script
  - Option C: manual creation
- [ ] Generate `public/apple-icon-180x180.png` for iOS
- [ ] Add `sizes: 'any'` favicon fallback in manifest

### Task 3: Minimal Service Worker (`public/sw.js`)
- [ ] Create `public/sw.js`:
  - Install event: pre-cache app shell (CSS variables, fonts, manifest)
  - Fetch event: network-first, fall back to cache for navigation requests
  - Activate event: clean old caches
- For a personal app, this is enough. Skip offline data sync, skip background sync.

### Task 4: Registration + Meta Tags (`components/pwa/ServiceWorkerRegistrar.tsx` + `app/layout.tsx`)
- [ ] Create a small client component:
  - On mount, check `'serviceWorker' in navigator`
  - Register `/sw.js` with `{ scope: '/' }`
  - Add `<meta name="apple-mobile-web-app-capable" content="yes">` (dynamically, or add to layout metadata)
- [ ] Modify `app/layout.tsx`:
  - Add `themeColor: '#A68966'` to metadata export
  - Add `appleWebApp: { capable: true, title: 'Monograph' }` to metadata
  - Mount `<ServiceWorkerRegistrar />` in body (after `<CaptureOverlay />`)

### Task 5: Security Headers (`next.config.ts`)
- [ ] Add `async headers()` to config:
  - Global: `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`
  - For `/sw.js`: `Content-Type: application/javascript; charset=utf-8`, `Cache-Control: no-cache, no-store, must-revalidate`, `Content-Security-Policy: default-src 'self'`

---

## Non-goals / Out of Scope

- ❌ Push notifications (separate concern, spec doesn't require them)
- ❌ Offline data access (auth + data require network anyway)
- ❌ Background sync
- ❌ `beforeinstallprompt` custom UI (iOS doesn't support it; let the browser handle it)
- ❌ `@serwist/next` or any PWA-specific dependency
- ❌ Splash screen customization (iOS uses manifest icons automatically)

## Effort: Small (~1 session, ~100-120 lines total + icon generation)

| Task | Lines/Files | Complexity |
|---|---|---|
| Manifest | ~25 | Low |
| Icons | 3 files | Low (tooling) |
| Service worker | ~50 | Low |
| Registrar component | ~20 | Low |
| Layout + config mods | ~15 | Trivial |
| **Total** | **~110 lines + 3 PNGs** | |

## Self-Review

- ✅ Web app manifest created via Next.js native `app/manifest.ts` (no config plugins)
- ✅ Minimal SW with network-first strategy (no stale data, shell loads from cache)
- ✅ iOS meta tags for full-screen experience (`apple-mobile-web-app-capable`)
- ✅ Apple touch icon for iOS home screen
- ✅ Security headers for SW serving
- ✅ No new npm dependencies
- ⚠️ Icons need to be generated — plan calls this out as a concrete step with tooling options
- ❌ No offline data — acceptable for auth-gated personal app
