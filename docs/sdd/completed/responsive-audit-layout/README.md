# SDD: Responsive Audit — Layout Components
**Proyecto:** zero-friction
**Fecha:** 2026-07-09
**Alcance:** app/layout.tsx, app/(app)/layout.tsx, app/(app)/page.tsx, components/CaptureOverlay.tsx, components/NavMenu.tsx

---

## Auditoría previa

### Problemas encontrados

| Archivo | Línea | Clase problemática | Tipo | Detalle |
|---------|-------|-------------------|------|---------|
| `app/(app)/layout.tsx` | 9 | `px-6` | Padding estático | 24px en todas las pantallas — móvil funciona mejor con 16px |
| `app/(app)/layout.tsx` | 9 | `pt-8` | Padding estático | 32px top — excesivo en móvil |
| `app/(app)/page.tsx` | 106 | `w-64` | Ancho fijo | Skeleton con 256px fijo — overflow horizontal en móvil |
| `app/(app)/page.tsx` | 469 | `text-4xl` | Texto grande sin breakpoint | 36px en greeting — exagerado en iPhone SE |
| `app/(app)/page.tsx` | 657 | `flex items-center justify-between` + `ml-4` | Layout frágil en móvil | Suscripción prompt se aplasta enpantallas estrechas |

### Componentes SIN problemas
- **NavMenu.tsx** — usa `md:` para sidebar desktop y `overflow-x-auto` en bottom bar — mobile-first correcto
- **CaptureOverlay.tsx** — FAB con `md:` para posición desktop, modal con `w-full` → `md:max-w-lg` — bien diseñado
- **InboxSection.tsx** — sin anchos fijos ni paddings gigantes — OK

---

## Cambios aplicados

### `app/(app)/layout.tsx`
```diff
- <main className="max-w-[720px] mx-auto w-full flex-1 px-6 pb-24 pt-8">
+ <main className="max-w-[720px] mx-auto w-full flex-1 px-4 md:px-6 pb-24 pt-4 md:pt-8">
```
- `px-6` → `px-4 md:px-6`: 16px en móvil, 24px en desktop
- `pt-8` → `pt-4 md:pt-8`: 16px en móvil, 32px en desktop

### `app/(app)/page.tsx` — Skeleton
```diff
- <div className="h-8 w-64 bg-fg-faint/30 rounded" />
+ <div className="h-8 w-full max-w-64 bg-fg-faint/30 rounded" />
```
- `w-64` → `w-full max-w-64`: ocupa 100% en móvil, max 256px en desktop

### `app/(app)/page.tsx` — Greeting
```diff
- <h1 className="font-serif text-4xl text-fg mt-1">
+ <h1 className="font-serif text-3xl md:text-4xl text-fg mt-1">
```
- `text-4xl` → `text-3xl md:text-4xl`: 30px móvil, 36px desktop

### `app/(app)/page.tsx` — Suscripción prompt
```diff
- <div className="border border-border bg-surface px-4 py-3 flex items-center justify-between">
+ <div className="border border-border bg-surface px-4 py-3 flex flex-col md:flex-row items-start md:items-center gap-3">
```
- `flex items-center justify-between` → `flex flex-col md:flex-row items-start md:items-center gap-3`: stacking vertical en móvil, row en desktop
```diff
- <div className="flex items-center gap-2 ml-4 flex-shrink-0">
+ <div className="flex items-center gap-2 flex-shrink-0">
```
- Eliminado `ml-4` (margen innecesario que aplastaba en móvil)

---

## Verificación

- `pnpm tsc --noEmit` → errores preexistentes (Prisma schema drift, no relacionados con responsividad)
- `pnpm lint` → advertencias preexistentes (react-hooks, unused vars en otros archivos)
- **Ninguno de los errores/warnings pertenece a los archivos modificados**

---

## Result Contract

```json
{
  "status": "done",
  "summary": "Auditadas layout components: 5 problemas de responsividad corregidos (paddings, anchos fijos, texto grande, flex stack) sin tocar colores ni estética.",
  "artifact": [
    "app/(app)/layout.tsx",
    "app/(app)/page.tsx"
  ],
  "next": [],
  "risks": [
    "Verificar CaptureOverlay en iPhone SE real — el modal `px-6` funciona con 16px pero el FAB puede quedar algo bajo con `pb-24` del layout"
  ]
}
```
