# Summary: Responsive Audit — Layout

**Fecha:** 2026-07-09
**Estado:** done

## Archivos modificados

| Archivo | Cambios |
|---------|---------|
| `app/(app)/layout.tsx` | `px-6` → `px-4 md:px-6`, `pt-8` → `pt-4 md:pt-8` |
| `app/(app)/page.tsx` | Skeleton `w-64` → `w-full max-w-64`; greeting `text-4xl` → `text-3xl md:text-4xl`; suscripción prompt `flex` → `flex flex-col md:flex-row`, eliminado `ml-4` |

## Componentes sin cambios necesarios

- `app/layout.tsx` — ya responsivo
- `components/CaptureOverlay.tsx` — FAB y modal correctos
- `components/NavMenu.tsx` — mobile-first correcto

## Riesgo pendiente

Verificar FAB de CaptureOverlay + `pb-24` en iPhone SE real.
