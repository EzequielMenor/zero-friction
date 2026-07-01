# Design: Modo Claro (Sepia) para Monograph

## 1. Objetivo

Añadir un modo claro "sepia/papel cálido" a Monograph (Zero-Friction OS), conmutable manualmente desde `/settings`. El modo claro debe ser suave a la vista (no blanco puro), preservar la identidad bronze/dorado de la marca, y no introducir dependencias externas.

## 2. Decisiones de diseño (validadas con el usuario)

| Decisión | Elección |
|---|---|
| Tipo de toggle | Manual, en `/settings` |
| Alcance del refactor | Completo — todos los hex hardcodeados migran a tokens semánticos |
| Paleta modo claro | Sepia/papel cálido (`#F5EFE6` / `#FAF6EE` / bronce intacto) |
| Mecánica de tema | ThemeProvider propio (sin `next-themes` ni otras deps) |

## 3. Sistema de tokens

### 3.1 CSS variables

Definidas en `app/globals.css`:

```css
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
  /* DARK (graphite — actual) */
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

### 3.2 Mapeo a Tailwind v4

En el mismo `globals.css`, `@theme inline` referencia las CSS vars para que Tailwind genere las utilidades automáticamente:

```css
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
```

Resultado: `bg-bg`, `bg-surface`, `text-fg`, `border-border-subtle`, etc. funcionan en cualquier componente y cambian solas según la clase `.dark` esté en `<html>` o no.

### 3.3 Tabla de migración hex → token

Para el refactor masivo:

| Hex actual | Token nuevo |
|---|---|
| `bg-graphite` | `bg-bg` |
| `bg-graphite-card` | `bg-surface` |
| `border-graphite-border` | `border-border` |
| `bg-[#000000]` | `bg-bg` |
| `text-[#E3E2E2]` | `text-fg` |
| `text-[#A1A1AA]` | `text-fg-muted` |
| `text-[#7A7A7A]` | `text-fg-subtle` |
| `text-[#5A5A5A]` | `text-fg-faint` |
| `border-[#2A2A2D]` | `border-border-subtle` |
| `text-[#A68966]` / `bg-[#A68966]` / `border-[#A68966]/N` | `text-accent` / `bg-accent` / `border-accent/N` |
| `selection:bg-[#A68966] selection:text-black` | `selection:bg-accent selection:text-accent-fg` |
| `text-[#4ade80]` | `text-success` |
| `text-[#f87171]` | `text-error` |

**Excepción**: SVGs inline con `fill="#A68966"` o `stroke="#A68966"` se mantienen como están — el bronce es idéntico en ambos modos.

## 4. Arquitectura de componentes

### 4.1 `components/ThemeProvider.tsx` (nuevo)

Client Component que provee el contexto de tema y expone `useTheme()`.

**Responsabilidades**:
1. Exporta `themeScript` (string) — script inline que se inyecta en `<head>` antes del primer paint. Lee `localStorage('theme')` y aplica la clase `dark` en `<html>`. Sin esto hay FOUC.
2. Componente `ThemeProvider` — envuelve la app, mantiene el estado `theme`, expone `setTheme(t)` y `toggleTheme()`.
3. Hook `useTheme()` — devuelve `{ theme, setTheme, toggleTheme }`.

**Default = dark** (preserva comportamiento actual). Lógica del script inline:

| `localStorage('theme')` | Resultado |
|---|---|
| `'dark'` o `null` (sin entrada) | añadir clase `.dark` → modo dark |
| `'light'` | NO añadir clase `.dark` → modo light |

El usuario que ya tenía la app en dark antes de esta feature sigue viéndola en dark automáticamente, sin necesitar tocar nada.

### 4.2 `app/layout.tsx` (modificado)

- Quitar `dark` hardcodeado de `<html>`.
- Inyectar `<script dangerouslySetInnerHTML={{ __html: themeScript }} />` en `<head>`.
- Envolver children en `<ThemeProvider>`.
- Body: cambiar `bg-graphite text-[#A1A1AA]` → `bg-bg text-fg-muted`.

### 4.3 `app/(app)/settings/page.tsx` (modificado)

Nueva sección "Apariencia" en la parte superior de la página:

```
APARIENCIA
┌─────────────┬─────────────┐
│   Oscuro    │    Claro    │
└─────────────┴─────────────┘
```

Segmented control con dos botones. Al click llama `useTheme().setTheme('dark' | 'light')`. El cambio es inmediato y persistente.

### 4.4 Refactor de componentes existentes

Aplicar la tabla §3.3 sistemáticamente. Archivos afectados (estimación por grep previo):

| Archivo | Hex hardcodeados |
|---|---|
| `components/NavMenu.tsx` | ~10 |
| `components/CaptureOverlay.tsx` | ~3 |
| `app/(app)/page.tsx` | ~2 |
| `components/InboxSection.tsx` | varios |
| `components/NotePanel.tsx` | ~2 |
| `app/(app)/hubs/[domain]/HubContent.tsx` | 1 |
| `app/(app)/hubs/registros/finanzas/page.tsx` | 10 |
| `app/(app)/hubs/registros/fuerza/page.tsx` | 5 |
| `app/(app)/hubs/registros/habitos/page.tsx` | 2 |
| `app/(app)/calendar/page.tsx` | 1 |
| `app/(app)/hubs/mente/page.tsx` | (revisar) |
| `app/(auth)/login/page.tsx` | 1 |
| `app/(auth)/signup/page.tsx` | 1 |

## 5. Persistencia

- **Storage**: `localStorage` con clave `'theme'` y valores `'dark'` o `'light'`.
- **No DB**: es un setting personal del dispositivo. No se sincroniza entre dispositivos. Si en el futuro se quiere sync, se añade columna `theme` en `User` y se hidrata en el server (out of scope).
- **No `prefers-color-scheme`**: el usuario pidió toggle manual puro, sin detección automática del sistema.

## 6. Plan de implementación por fases

### Fase 1 — Cimientos (1 commit)
- `app/globals.css`: añadir `:root` + `.dark` + `@theme inline`
- Crear `components/ThemeProvider.tsx`
- `app/layout.tsx`: quitar `dark` hardcoded, inyectar script, envolver en `ThemeProvider`, body con tokens semánticos

**Verificación**: `pnpm build` OK. Visual: app idéntica a antes (default dark).

### Fase 2 — Settings UI (1 commit)
- `app/(app)/settings/page.tsx`: añadir sección "Apariencia" con toggle segmentado

**Verificación**: ir a `/settings`, alternar, refrescar, mantener estado.

### Fase 3 — Refactor por capas (varios commits, uno por archivo grande)
Orden: más visible → menos visible.
1. `components/NavMenu.tsx`
2. `components/CaptureOverlay.tsx`
3. `app/(app)/page.tsx`
4. `components/InboxSection.tsx`, `components/NotePanel.tsx`
5. `app/(app)/hubs/[domain]/HubContent.tsx`
6. `app/(app)/hubs/registros/{finanzas,fuerza,habitos}/page.tsx`
7. `app/(app)/calendar/page.tsx`, `app/(app)/hubs/mente/page.tsx`
8. `app/(auth)/login/page.tsx`, `app/(auth)/signup/page.tsx`

**Verificación por commit**: toggle dark/light, mirar la página tocada, no debe quedar hex residual visible.

### Fase 4 — Polish (1 commit)
- `pnpm build` final
- Lint
- Smoke test manual en ambos modos: dashboard, settings, un hub, auth.

## 7. Riesgos y mitigaciones

| Riesgo | Mitigación |
|---|---|
| FOUC (flash de light al cargar dark) | Script inline anti-FOUC en `<head>` |
| Dejar un hex suelto que rompa en light | Refactor por archivo + verificación visual; `grep -r "bg-\[#\|text-\[#\|border-\[#"` al final debe dar 0 hits |
| `<select><option>` no respeta colores | Aceptable — opciones nativas del navegador son legibles en ambos modos |
| SVGs con colores hardcoded | Solo tocar SVGs que NO usan el accent; el bronce es igual en ambos modos |
| `bg-gradient-to-b from-graphite-card to-graphite` en dashboard | Reemplazar por `from-surface to-bg` (los tokens funcionan en gradientes) |
| Tailwind purge y `@theme inline` | Verificar con `pnpm build` que las clases custom se incluyen |

## 8. Testing

- **Build**: `pnpm build` debe pasar sin warnings nuevos.
- **Lint**: `pnpm lint` debe pasar.
- **Smoke manual**: alternar tema, navegar dashboard / settings / un hub / login. Sin hex residual visible en light.
- **Verificación de cobertura**: `grep -rE 'bg-\[#|text-\[#|border-\[#' app components --include='*.tsx' --include='*.ts'` debe retornar 0 al final (excluyendo SVGs y comentarios).

## 9. Out of scope

- Sync multi-device del setting
- `prefers-color-scheme` automático
- Temas adicionales (alto contraste, etc.)
- Transición animada entre temas (CSS transitions pueden añadirse después si se desea)