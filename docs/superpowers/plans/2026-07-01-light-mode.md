# Light Mode (Sepia) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add manual dark/light theme toggle to Monograph (Zero-Friction OS), with sepia/papel cálido light palette, and full refactor of hardcoded hex colors to semantic tokens.

**Architecture:** CSS variables defined in `globals.css` (`:root` for light, `.dark` for dark) + Tailwind v4 `@theme inline` mapping to semantic tokens (`bg-bg`, `text-fg`, etc.) + custom `ThemeProvider` Client Component with anti-FOUC inline script. Persistence via `localStorage('theme')`. No external dependencies.

**Tech Stack:** Next.js 16 (App Router), React 19, Tailwind CSS 4, TypeScript 5.

**Spec:** `docs/superpowers/specs/2026-07-01-light-mode-design.md`

## Global Constraints

- Idioma del código y comentarios: español de España (cortos, concisos)
- Sin dependencias nuevas — implementación propia, sin `next-themes`
- Default = dark (preserva comportamiento actual para usuarios existentes)
- `localStorage('theme')` con valores `'dark'` o `'light'`
- Script anti-FOUC obligatorio en `<head>` antes del primer paint
- No tocar SVGs con `fill="#A68966"` o `stroke="#A68966"` (bronce idéntico en ambos modos)
- Commits frecuentes con conventional commits
- Al terminar la implementación completa: `grep -rE 'bg-\[#|text-\[#|border-\[#' app components --include='*.tsx' --include='*.ts'` debe dar 0 hits

---

## File Structure

**Crear:**
- `components/ThemeProvider.tsx` — Provider con contexto, hook `useTheme()`, script anti-FOUC

**Modificar:**
- `app/globals.css` — añadir `:root`, `.dark`, `@theme inline`
- `app/layout.tsx` — quitar `dark` hardcoded, inyectar script, envolver con `ThemeProvider`, body con tokens
- `app/(app)/settings/page.tsx` — nueva sección "Apariencia"
- `components/NavMenu.tsx` — refactor hex → tokens
- `components/CaptureOverlay.tsx` — refactor hex → tokens
- `components/InboxSection.tsx` — refactor hex → tokens
- `components/NotePanel.tsx` — refactor hex → tokens
- `components/Toast.tsx` — refactor hex → tokens (si tiene)
- `app/(app)/page.tsx` — refactor hex → tokens
- `app/(app)/calendar/page.tsx` — refactor hex → tokens
- `app/(app)/hubs/[domain]/HubContent.tsx` — refactor hex → tokens
- `app/(app)/hubs/mente/page.tsx` — refactor hex → tokens
- `app/(app)/hubs/registros/finanzas/page.tsx` — refactor hex → tokens
- `app/(app)/hubs/registros/fuerza/page.tsx` — refactor hex → tokens
- `app/(app)/hubs/registros/habitos/page.tsx` — refactor hex → tokens
- `app/(auth)/login/page.tsx` — refactor hex → tokens
- `app/(auth)/signup/page.tsx` — refactor hex → tokens

**Sin tocar:**
- `tailwind.config.ts` — Tailwind v4 lee `@theme` desde CSS, no necesita config

---

## Task 1: CSS Variables y tokens semánticos

**Files:**
- Modify: `app/globals.css`

**Interfaces:**
- Produce: tokens semánticos `bg-bg`, `bg-surface`, `bg-surface-elevated`, `border-border`, `border-border-subtle`, `text-fg`, `text-fg-muted`, `text-fg-subtle`, `text-fg-faint`, `text-accent`, `bg-accent`, `border-accent`, `text-accent-fg`, `text-success`, `text-error`

- [ ] **Step 1: Sustituir `app/globals.css` por el siguiente contenido completo**

```css
@import "tailwindcss";

/* ──────────────────────────────────────────────────────────────
 * Theme tokens — cambia aquí las paletas para que se apliquen en
 * toda la app. Modo light por defecto (:root), modo dark bajo .dark.
 * ────────────────────────────────────────────────────────────── */

:root {
  /* LIGHT (sepia/papel cálido) — default */
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

.dark {
  /* DARK (graphite — original) */
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

/* Mapeo a Tailwind v4 — `inline` hace que las utilidades se generen
 * dinámicamente desde las CSS vars, así cambian solas al togglear tema. */
@theme inline {
  --color-bg:              var(--bg);
  --color-surface:         var(--surface);
  --color-surface-elevated:var(--surface-elevated);
  --color-border:          var(--border);
  --color-border-subtle:   var(--border-subtle);
  --color-fg:              var(--fg);
  --color-fg-muted:        var(--fg-muted);
  --color-fg-subtle:       var(--fg-subtle);
  --color-fg-faint:        var(--fg-faint);
  --color-accent:          var(--accent);
  --color-accent-fg:       var(--accent-fg);
  --color-success:         var(--success);
  --color-error:           var(--error);
}

/* Keyframes compartidos — deduplicados de bloques <style> inline */
@keyframes fade-in { from { opacity: 0 } to { opacity: 1 } }
@keyframes fade-out { from { opacity: 1 } to { opacity: 0 } }
@keyframes slide-out { from { opacity: 1; transform: translateX(0) } to { opacity: 0; transform: translateX(16px) } }
@keyframes pulse-border {
  0%, 100% { border-color: rgba(166, 137, 102, 0.3); }
  50% { border-color: rgba(166, 137, 102, 0.6); }
}
@keyframes pulse-dot {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.3; }
}
@keyframes scale-in {
  from { transform: scale(0.95); opacity: 0; }
  to { transform: scale(1); opacity: 1; }
}

.animate-fade-in { animation: fade-in 200ms ease-out forwards }
.animate-fade-out { animation: fade-out 250ms ease-in forwards }
.animate-slide-out { animation: slide-out 200ms ease-in forwards }
.animate-pulse-border { animation: pulse-border 2s ease-in-out infinite }
.animate-pulse-dot { animation: pulse-dot 1s ease-in-out infinite }
.animate-scale-in { animation: scale-in 150ms ease-out forwards }

.noise-bg {
  position: fixed;
  top: 0; left: 0; width: 100vw; height: 100vh;
  pointer-events: none;
  z-index: 0;
  opacity: 0.03;
  background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noiseFilter'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.65' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noiseFilter)'/%3E%3C/svg%3E");
}
```

- [ ] **Step 2: Verificar que `globals.css` no tiene errores de sintaxis**

Run: `pnpm build`
Expected: build OK. Aún no hay toggle visual, la app debe verse igual (porque `.dark` se aplica por el default actual en `layout.tsx`).

- [ ] **Step 3: Commit**

```bash
git add app/globals.css
git commit -m "feat(theme): css variables + tailwind v4 @theme inline mapping

Define light (sepia) and dark (graphite) palettes as CSS vars. Map to
Tailwind tokens via @theme inline. No visual change yet — default theme
still hardcoded to dark in layout.tsx (next task).

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 2: Crear ThemeProvider con anti-FOUC

**Files:**
- Create: `components/ThemeProvider.tsx`

**Interfaces:**
- Produces: `<ThemeProvider>` (componente Client), `useTheme()` (hook), `themeScript` (string para inyección inline)

- [ ] **Step 1: Crear `components/ThemeProvider.tsx`**

```tsx
'use client'

import { createContext, useContext, useEffect, useState } from 'react'

export type Theme = 'dark' | 'light'

interface ThemeContextValue {
  theme: Theme
  setTheme: (t: Theme) => void
  toggleTheme: () => void
}

const ThemeContext = createContext<ThemeContextValue>({
  theme: 'dark',
  setTheme: () => {},
  toggleTheme: () => {},
})

/**
 * Script inline que se inyecta en <head> antes del primer paint.
 * Lee localStorage y aplica la clase .dark. Sin esto hay FOUC.
 *
 * Lógica:
 *   - localStorage('theme') === 'light' → no añade .dark → light
 *   - cualquier otro caso (null, 'dark') → añade .dark → dark
 *   Default = dark preserva comportamiento para usuarios existentes.
 */
export const themeScript = `
(function() {
  try {
    var t = localStorage.getItem('theme');
    if (t !== 'light') document.documentElement.classList.add('dark');
  } catch (e) {}
})();
`

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<Theme>('dark')

  // En cliente, sincroniza estado con lo que aplicó el script inline
  useEffect(() => {
    const stored = localStorage.getItem('theme') as Theme | null
    if (stored === 'light' || stored === 'dark') setThemeState(stored)
  }, [])

  function setTheme(t: Theme) {
    setThemeState(t)
    localStorage.setItem('theme', t)
    document.documentElement.classList.toggle('dark', t === 'dark')
  }

  function toggleTheme() {
    setTheme(theme === 'dark' ? 'light' : 'dark')
  }

  return (
    <ThemeContext.Provider value={{ theme, setTheme, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  )
}

export function useTheme() {
  return useContext(ThemeContext)
}
```

- [ ] **Step 2: Verificar typecheck**

Run: `pnpm lint`
Expected: OK (puede que haya warnings de `no-unused-vars` mientras no se use — ignorar por ahora, se usa en siguiente task).

- [ ] **Step 3: Commit**

```bash
git add components/ThemeProvider.tsx
git commit -m "feat(theme): ThemeProvider with anti-FOUC script and useTheme hook

Provider Client Component con contexto, persistencia en localStorage y
export del themeScript para inyección inline en <head>. Sin uso todavía
— se conecta en siguiente task.

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 3: Conectar ThemeProvider en layout

**Files:**
- Modify: `app/layout.tsx`

**Interfaces:**
- Consumes: `ThemeProvider`, `themeScript` from `components/ThemeProvider.tsx`

- [ ] **Step 1: Sustituir `app/layout.tsx` entero por**

```tsx
import type { Metadata, Viewport } from "next";
import { Inter, Playfair_Display } from 'next/font/google';
import "./globals.css";
import CaptureOverlay from '@/components/CaptureOverlay';
import NavMenu from '@/components/NavMenu';
import ServiceWorkerRegistrar from '@/components/pwa/ServiceWorkerRegistrar';
import { ThemeProvider, themeScript } from '@/components/ThemeProvider';

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
  display: 'swap',
});

const playfair = Playfair_Display({
  subsets: ['latin'],
  variable: '--font-playfair',
  display: 'swap',
});

export const metadata: Metadata = {
  title: "Monograph | Zero-Friction OS",
  description: "Sistema operativo personal basado en captura sin fricción.",
  applicationName: "Monograph",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "Monograph",
    statusBarStyle: "black-translucent",
  },
  icons: {
    icon: [
      { url: "/icon-192x192.png", sizes: "192x192", type: "image/png" },
      { url: "/icon-512x512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [
      { url: "/apple-icon-180x180.png", sizes: "180x180", type: "image/png" },
    ],
  },
};

export const viewport: Viewport = {
  themeColor: "#A68966",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="es"
      className={`${inter.variable} ${playfair.variable} antialiased`}
    >
      <head>
        {/* Anti-FOUC: aplica clase .dark antes del primer paint */}
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="min-h-screen bg-bg text-fg-muted font-sans selection:bg-accent selection:text-accent-fg flex flex-col relative">
        <ThemeProvider>
          {/* Noise texture */}
          <div
            className="fixed inset-0 pointer-events-none z-0 opacity-[0.03]"
            style={{ backgroundImage: 'url("data:image/svg+xml,%3Csvg viewBox=\'0 0 200 200\' xmlns=\'http://www.w3.org/2000/svg\'%3E%3Cfilter id=\'noiseFilter\'%3E%3CfeTurbulence type=\'fractalNoise\' baseFrequency=\'0.65\' numOctaves=\'3\' stitchTiles=\'stitch\'/%3E%3C/filter%3E%3Crect width=\'100%25\' height=\'100%25\' filter=\'url(%23noiseFilter)\'/%3E%3C/svg%3E")' }}
          />

          {/* Sidebar nav (desktop) + Bottom bar (mobile) */}
          <NavMenu />

          {/* Route group content — (auth) has no offset; (app) adds its own ml-[220px] */}
          {children}

          {/* Capture Overlay — floating trigger */}
          <CaptureOverlay />

          {/* PWA service worker — solo se registra en producción */}
          <ServiceWorkerRegistrar />
        </ThemeProvider>
      </body>
    </html>
  );
}
```

- [ ] **Step 2: Verificar build**

Run: `pnpm build`
Expected: OK. La app debe verse EXACTAMENTE igual (default = dark por script anti-FOUC).

- [ ] **Step 3: Smoke test**

Run: `pnpm dev`, abrir `http://localhost:3000`.
- Login con tu cuenta
- Verificar visualmente: app idéntica a antes (modo dark graphite)
- DevTools → Application → Local Storage → `http://localhost:3000` → debe haber clave `theme` = `dark`

- [ ] **Step 4: Commit**

```bash
git add app/layout.tsx
git commit -m "feat(theme): wire ThemeProvider in root layout

- Quita 'dark' hardcoded de <html>
- Inyecta themeScript anti-FOUC en <head>
- Envuelve children con ThemeProvider
- Body usa tokens semánticos (bg-bg, text-fg-muted)

Default dark preserva comportamiento. App visualmente idéntica.

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 4: Toggle "Apariencia" en Settings

**Files:**
- Modify: `app/(app)/settings/page.tsx`

**Interfaces:**
- Consumes: `useTheme()` from `components/ThemeProvider.tsx`

- [ ] **Step 1: Añadir imports**

Al inicio del archivo `app/(app)/settings/page.tsx`, después del import existente de `Toast`:

```tsx
import { useTheme } from '@/components/ThemeProvider'
```

- [ ] **Step 2: Usar el hook en el componente**

Localiza la línea `export default function SettingsPage() {` y añade el hook justo después de abrir la función:

```tsx
export default function SettingsPage() {
  const { theme, setTheme } = useTheme()
  const [provider, setProvider] = useState<ProviderName>(CUSTOM_PROVIDER)
  // ... resto del state existente
```

- [ ] **Step 3: Insertar sección "Apariencia" al principio del JSX**

Localiza el bloque `<> ... <p className="text-[10px] tracking-[0.2em] text-accent uppercase font-semibold">AJUSTES</p>` y añade ANTES la nueva sección:

```tsx
return (
  <>
    {/* Apariencia */}
    <p className="text-[10px] tracking-[0.2em] text-accent uppercase font-semibold">APARIENCIA</p>
    <h1 className="font-serif text-3xl text-fg mt-1">Tema</h1>
    <p className="text-sm text-fg-faint mt-1">
      Cambia entre modo oscuro (graphite) y modo claro (sepia).
    </p>
    <div className="mt-4 inline-flex border border-border">
      <button
        onClick={() => setTheme('dark')}
        className={`text-[10px] uppercase tracking-wider px-5 py-2.5 transition-colors ${
          theme === 'dark'
            ? 'bg-accent text-accent-fg font-semibold'
            : 'text-fg-subtle hover:text-accent'
        }`}
      >
        Oscuro
      </button>
      <button
        onClick={() => setTheme('light')}
        className={`text-[10px] uppercase tracking-wider px-5 py-2.5 border-l border-border transition-colors ${
          theme === 'light'
            ? 'bg-accent text-accent-fg font-semibold'
            : 'text-fg-subtle hover:text-accent'
        }`}
      >
        Claro
      </button>
    </div>

    {/* Resto de la página */}
    <p className="text-[10px] tracking-[0.2em] text-accent uppercase font-semibold mt-12">AJUSTES</p>
```

- [ ] **Step 4: Verificar build**

Run: `pnpm build`
Expected: OK.

- [ ] **Step 5: Smoke test**

Run: `pnpm dev`.
- Login → ir a `/settings`
- Verificar que aparece la sección "APARIENCIA" arriba del todo
- Click en "Claro" → toda la app cambia a sepia (incluyendo esta página)
- Refrescar (F5) → modo claro se mantiene (no debe haber flash de dark)
- Click en "Oscuro" → vuelve a graphite
- Refrescar → modo oscuro se mantiene
- DevTools → Application → Local Storage → `theme` cambia según el botón

- [ ] **Step 6: Commit**

```bash
git add app/(app)/settings/page.tsx
git commit -m "feat(settings): add Apariencia section with dark/light toggle

Segmented control que llama useTheme().setTheme(). Persistencia
inmediata en localStorage. Testeado: toggle funciona y refrescar
mantiene el estado sin FOUC.

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Tasks 5-11: Refactor de componentes (hex → tokens)

> **Estrategia**: cada componente es una task independiente. Usa la tabla de mapeo del spec para hacer find/replace. Después de cada task verifica con grep que el archivo ya no tiene hex hardcodeados.

### Tabla de mapeo (aplicar a todos los archivos)

| Buscar (regex en comillas) | Reemplazar |
|---|---|
| `bg-\[#0B0B0C\]` | `bg-bg` |
| `bg-graphite\b` (sin prefijo `-card` ni `-border`) | `bg-bg` |
| `bg-graphite-card` | `bg-surface` |
| `border-graphite-border` | `border-border` |
| `bg-\[#000000\]` | `bg-bg` |
| `text-\[#E3E2E2\]` | `text-fg` |
| `text-\[#A1A1AA\]` | `text-fg-muted` |
| `text-\[#7A7A7A\]` | `text-fg-subtle` |
| `text-\[#5A5A5A\]` | `text-fg-faint` |
| `border-\[#2A2A2D\]` | `border-border-subtle` |
| `text-\[#A68966\]` | `text-accent` |
| `bg-\[#A68966\]` | `bg-accent` |
| `border-\[#A68966\]/(\d+)` | `border-accent/$1` |
| `text-\[#4ade80\]` | `text-success` |
| `text-\[#f87171\]` | `text-error` |
| `from-graphite-card` | `from-surface` |
| `to-graphite\b` (sin prefijo `-card`) | `to-bg` |

**Importante**:
- SVGs inline con `fill="#A68966"` o `stroke="#A68966"` se DEJAN como están.
- Si encuentras un hex que NO está en la tabla,停下来 y agrégalo al spec antes de continuar.

### Task 5: Refactor `components/NavMenu.tsx`

**Files:**
- Modify: `components/NavMenu.tsx`

- [ ] **Step 1: Aplicar la tabla de mapeo con find/replace en todo el archivo**

Usa el editor (multi-cursor) o comandos sed. Ejemplos con sed (opcional, el editor es más seguro):

```bash
sed -i '' 's/text-\[#A68966\]/text-accent/g; s/border-\[#A68966\]\/40/border-accent\/40/g; s/text-\[#5A5A5A\]/text-fg-faint/g; s/text-\[#7A7A7A\]/text-fg-subtle/g; s/bg-graphite-card/bg-surface/g; s/bg-graphite\b/bg-bg/g; s/border-graphite-border/border-border/g' components/NavMenu.tsx
```

- [ ] **Step 2: Verificar que no quedan hex hardcodeados en este archivo**

Run: `grep -E 'bg-\[#|text-\[#|border-\[#|bg-graphite|border-graphite' components/NavMenu.tsx`
Expected: 0 hits.

- [ ] **Step 3: Smoke test**

Toggle en `/settings` → ir a `/` y verificar que sidebar (Today, Calendario, Hubs, Mente, Ajustes) y bottom bar móvil se ven correctos en ambos modos.

- [ ] **Step 4: Commit**

```bash
git add components/NavMenu.tsx
git commit -m "refactor(theme): NavMenu uses semantic tokens

Sidebar y bottom bar mobile. Hex hardcodeados migrados a tokens
semánticos. Verificado: sin hex residual en el archivo.

Co-Authored-By: Claude <noreply@anthropic.com>"
```

### Task 6: Refactor `components/CaptureOverlay.tsx`

- [ ] **Step 1: Aplicar tabla de mapeo**

- [ ] **Step 2: Verificar con grep**

Run: `grep -E 'bg-\[#|text-\[#|border-\[#|bg-graphite|border-graphite' components/CaptureOverlay.tsx`
Expected: 0 hits.

- [ ] **Step 3: Smoke test**

Toggle theme → abrir overlay con ⌘K (o el atajo que uses) → verificar fondo, inputs, botones en ambos modos.

- [ ] **Step 4: Commit**

```bash
git add components/CaptureOverlay.tsx
git commit -m "refactor(theme): CaptureOverlay uses semantic tokens

Co-Authored-By: Claude <noreply@anthropic.com>"
```

### Task 7: Refactor `app/(app)/page.tsx` (Dashboard)

- [ ] **Step 1: Aplicar tabla de mapeo**

Nota: este archivo tiene SVGs inline (`CheckIcon`, `StarIcon`, `FocusIcon`). Los `fill="#A68966"` y `stroke="#A68966"` se quedan. Solo migrar las clases Tailwind.

- [ ] **Step 2: Caso especial `from-graphite-card to-graphite`**

Localizar la línea con `bg-gradient-to-b from-graphite-card to-graphite` (en el widget ENFOQUE) y sustituir por:

```tsx
className="border border-border border-t border-t-accent/40 bg-gradient-to-b from-surface to-bg min-h-[120px] px-6 py-5 relative"
```

- [ ] **Step 3: Verificar con grep**

Run: `grep -E 'bg-\[#|text-\[#|border-\[#|bg-graphite|border-graphite' 'app/(app)/page.tsx'`
Expected: 0 hits.

- [ ] **Step 4: Smoke test**

Dashboard completo en ambos modos: header HOY, ENFOQUE, INBOX, TAREAS DE HOY, HÁBITOS, SUBSCRIPCIÓN, DEL PASADO. Verificar hábito circular (`border-[#2A2A2D]`) → `border-border-subtle`.

- [ ] **Step 5: Commit**

```bash
git add 'app/(app)/page.tsx'
git commit -m "refactor(theme): Dashboard uses semantic tokens

Dashboard principal (HOY, ENFOQUE, TAREAS, HÁBITOS, MANTENIMIENTO,
SUBSCRIPCIÓN, RESURGENCIA). Incluye gradient from-surface to-bg
en widget de enfoque. SVGs inline sin tocar (bronce idéntico).

Co-Authored-By: Claude <noreply@anthropic.com>"
```

### Task 8: Refactor `components/InboxSection.tsx` + `components/NotePanel.tsx`

- [ ] **Step 1: Aplicar tabla a `InboxSection.tsx`**

- [ ] **Step 2: Aplicar tabla a `NotePanel.tsx`**

- [ ] **Step 3: Verificar con grep**

```bash
grep -E 'bg-\[#|text-\[#|border-\[#|bg-graphite|border-graphite' components/InboxSection.tsx components/NotePanel.tsx
```
Expected: 0 hits.

- [ ] **Step 4: Smoke test**

Dashboard → sección INBOX con items DRAFT. Abrir un item → ver NotePanel. Toggle en ambos modos.

- [ ] **Step 5: Commit**

```bash
git add components/InboxSection.tsx components/NotePanel.tsx
git commit -m "refactor(theme): InboxSection + NotePanel use semantic tokens

Co-Authored-By: Claude <noreply@anthropic.com>"
```

### Task 9: Refactor Hub genérico + registros (finanzas/fuerza/hábitos)

**Files:**
- Modify: `app/(app)/hubs/[domain]/HubContent.tsx`
- Modify: `app/(app)/hubs/registros/finanzas/page.tsx`
- Modify: `app/(app)/hubs/registros/fuerza/page.tsx`
- Modify: `app/(app)/hubs/registros/habitos/page.tsx`

- [ ] **Step 1: Aplicar tabla a los 4 archivos**

- [ ] **Step 2: Verificar con grep**

```bash
grep -E 'bg-\[#|text-\[#|border-\[#|bg-graphite|border-graphite' \
  'app/(app)/hubs/[domain]/HubContent.tsx' \
  'app/(app)/hubs/registros/finanzas/page.tsx' \
  'app/(app)/hubs/registros/fuerza/page.tsx' \
  'app/(app)/hubs/registros/habitos/page.tsx'
```
Expected: 0 hits.

- [ ] **Step 3: Smoke test**

Navegar a cada hub (un dominio cualquiera, Finanzas, Fuerza, Hábitos). Verificar en ambos modos.

- [ ] **Step 4: Commit**

```bash
git add 'app/(app)/hubs/[domain]/HubContent.tsx' \
        'app/(app)/hubs/registros/finanzas/page.tsx' \
        'app/(app)/hubs/registros/fuerza/page.tsx' \
        'app/(app)/hubs/registros/habitos/page.tsx'
git commit -m "refactor(theme): Hub generic + finanzas/fuerza/habitos use semantic tokens

Co-Authored-By: Claude <noreply@anthropic.com>"
```

### Task 10: Refactor Calendar + Mente

**Files:**
- Modify: `app/(app)/calendar/page.tsx`
- Modify: `app/(app)/hubs/mente/page.tsx`

- [ ] **Step 1: Aplicar tabla a los 2 archivos**

- [ ] **Step 2: Verificar con grep**

```bash
grep -E 'bg-\[#|text-\[#|border-\[#|bg-graphite|border-graphite' \
  'app/(app)/calendar/page.tsx' \
  'app/(app)/hubs/mente/page.tsx'
```
Expected: 0 hits.

- [ ] **Step 3: Smoke test**

Ir a `/calendar` y `/hubs/mente` (graph neural view). Toggle en ambos modos.

- [ ] **Step 4: Commit**

```bash
git add 'app/(app)/calendar/page.tsx' 'app/(app)/hubs/mente/page.tsx'
git commit -m "refactor(theme): Calendar + Mente use semantic tokens

Co-Authored-By: Claude <noreply@anthropic.com>"
```

### Task 11: Refactor páginas de auth (login/signup)

**Files:**
- Modify: `app/(auth)/login/page.tsx`
- Modify: `app/(auth)/signup/page.tsx`

- [ ] **Step 1: Aplicar tabla a los 2 archivos**

- [ ] **Step 2: Verificar con grep**

```bash
grep -E 'bg-\[#|text-\[#|border-\[#|bg-graphite|border-graphite' \
  'app/(auth)/login/page.tsx' \
  'app/(auth)/signup/page.tsx'
```
Expected: 0 hits.

- [ ] **Step 3: Smoke test**

Cerrar sesión (o en ventana incógnito) → ir a `/login`. Verificar formulario en ambos modos.

- [ ] **Step 4: Commit**

```bash
git add 'app/(auth)/login/page.tsx' 'app/(auth)/signup/page.tsx'
git commit -m "refactor(theme): auth pages (login/signup) use semantic tokens

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 12: Verificación final + polish

- [ ] **Step 1: Verificación global de cobertura (hex residual)**

```bash
grep -rE 'bg-\[#|text-\[#|border-\[#|bg-graphite|border-graphite' \
  app components \
  --include='*.tsx' --include='*.ts'
```

Expected: 0 hits.

Si quedan hits, son SVGs (no toques) o un caso que se te escapó. Cualquier hit en clases Tailwind es bug → arreglar antes de mergear.

- [ ] **Step 2: Build final**

```bash
pnpm build
```
Expected: build OK, sin warnings nuevos.

- [ ] **Step 3: Lint final**

```bash
pnpm lint
```
Expected: OK.

- [ ] **Step 4: Smoke test E2E completo (manual)**

Checklist — para cada uno, verificar dark Y light:

- [ ] `/login` (sin sesión)
- [ ] `/signup` (sin sesión)
- [ ] `/` dashboard (HOY, ENFOQUE, INBOX con DRAFTs, TAREAS DE HOY, HÁBITOS, Consola de Mantenimiento si hay atrasadas, SUBSCRIPCIÓN si hay, DEL PASADO si hay)
- [ ] `/calendar`
- [ ] `/hubs/mente` (graph view)
- [ ] Un hub cualquiera
- [ ] `/hubs/registros/finanzas`
- [ ] `/hubs/registros/fuerza`
- [ ] `/hubs/registros/habitos`
- [ ] `/settings` (verificar toggle funcional)
- [ ] Abrir CaptureOverlay con ⌘K (o el atajo configurado)
- [ ] Abrir NotePanel desde un item del inbox

Para cada uno:
- [ ] No hay flash al cargar (FOUC)
- [ ] Todos los textos legibles (contraste OK)
- [ ] Los bordes se ven (no desaparecen en light)
- [ ] El accent bronze se ve en headings y CTAs
- [ ] Inputs/selects son usables

- [ ] **Step 5: Commit final (si hubo polish)**

```bash
git add -A
git commit -m "chore(theme): final verification + smoke test pass

All hex hardcoded migrated. Build/lint clean. E2E smoke OK in both modes.
No FOUC. Ready to merge.

Co-Authored-By: Claude <noreply@anthropic.com>"
```

(si no hay cambios, este commit se omite)

---

## Resumen

| # | Task | Commits | LOC aprox |
|---|---|---|---|
| 1 | CSS vars + tokens | 1 | +50 |
| 2 | ThemeProvider | 1 | +60 |
| 3 | Wire en layout | 1 | +20 |
| 4 | Settings toggle | 1 | +30 |
| 5 | NavMenu refactor | 1 | refactor |
| 6 | CaptureOverlay refactor | 1 | refactor |
| 7 | Dashboard refactor | 1 | refactor |
| 8 | InboxSection + NotePanel refactor | 1 | refactor |
| 9 | Hubs + registros refactor | 1 | refactor |
| 10 | Calendar + Mente refactor | 1 | refactor |
| 11 | Auth pages refactor | 1 | refactor |
| 12 | Verificación final | 0-1 | — |
| **Total** | **12 tasks** | **11-12 commits** | **~400 LOC** |