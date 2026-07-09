# Test Report: Refactor Note → Note + Task

**Fase**: brain-test (Fase 6)
**Fecha**: 2026-07-09
**Sesión**: `refactor-note-task-split-2026-07-08`

---

## 1. Verificaciones estáticas

| Comando | Resultado |
|---|---|
| `pnpm prisma validate` | ✅ Schema válido |
| `pnpm prisma format --check` | ✅ Formateado correctamente |
| `pnpm tsc --noEmit` | ❌ 25+ errores (solo en tests) |

**Errores de `tsc --noEmit`**: todos están en `tests/`, ninguno en el código de producción (`app/`, `lib/`, `components/`).

---

## 2. Inventario de tests

### 2.1 Tests existentes

| Archivo | Compila | Runtime | Tests | Escenarios cubiertos |
|---|---|---|---|---|
| `tests/unit/smoke.test.ts` | ✅ | ✅ 3/3 | Smoke de mocks, hubs, tipos | Mocks funcionan, alias `@/` resuelven |
| `tests/unit/hubs.test.ts` | ✅ | ✅ 27/27 | Selects y funciones de hubs | NOTE_SELECT_NEW sin embedding/legacy, TASK_SELECT 10 campos, constants |
| `tests/unit/focus.test.ts` | ⚠️ (2 err) | ✅ 5/5 | POST /api/tasks/[id]/focus | Auth 401, happy path, DONE→409, race P2002→409, not found |
| `tests/unit/accept-goal.test.ts` | ❌ (6 err) | ❌ 0/6 | POST /api/notes/[id]/accept-goal | Auth (2), validación (2), happy path, 409 taskExists |
| `tests/unit/complete.test.ts` | ❌ (5 err) | ❌ 0/5 | POST /api/tasks/[id]/complete | Auth (2), OPEN→DONE, 409 already_done, otro user |
| `tests/unit/unfocus.test.ts` | ❌ (5 err) | ❌ 0/5 | POST /api/tasks/[id]/unfocus | Auth (2), happy path, 409 not_focused (2) |
| `tests/e2e.spec.ts` | ⚠️ | ⚠️ (requiere DB) | E2E reescritos (528 líneas) | Sin verificar |

**Totales**: 6 test files unitarios, 1 E2E. 35 tests pasan, 17 fallan (runtime) + 25+ errores de compilación.

### 2.2 Tests requeridos por spec (tasks.md §5) NO existentes

| Archivo esperado | Estado | Escenarios faltantes |
|---|---|---|
| `lib/parse-capture.test.ts` | ❌ No existe | EnrichDraftNote, isExecutable, RAW SQL `noteStatus='ACTIVE'` |
| `app/api/dashboard/route.test.ts` | ❌ No existe | 0 tasks → null/vacías, con focus → focusTask, maintenanceTasks, resurgenceNote |
| `prisma/backfill.test.ts` | ❌ No existe | 6 casos del mapping §1.6: IN_PROGRESS, DONE, ACTIVE+dueDate, ACTIVE sin nada, DRAFT, ACTIVE+isImportant |
| `tests/snapshots/api-dashboard.test.ts` | ❌ No existe | Snapshot del shape de GET /api/dashboard |
| `tests/snapshots/api-notes-id.test.ts` | ❌ No existe | Snapshot del shape de GET /api/notes/[id] |
| `app/api/notes/[id]/process/route.test.ts` | ❌ No existe | Ejecutable, no-ejecutable, AI-fail, REGISTROS-transaccional |

---

## 3. Análisis de fallos

### 3.1 Causa raíz: divergencia en API de `test-setup.ts`

Los tests `accept-goal.test.ts`, `complete.test.ts` y `unfocus.test.ts` importan helpers que no existen en `tests/helpers/test-setup.ts`:

| Lo que importan (inexistente) | Lo que existe en test-setup |
|---|---|
| `setupAuthMocks` | No existe. Debe mockearse manualmente con `mockAuthCookie(cookies)` + `mockValidSession(verifySession)` |
| `createMockRequest` | No existe. Sustituir por `new Request(...)` |
| `createParams` | `params(id)` (misma firma) |
| `getResponseJson` | `json(res)` |
| `getPrismaMock` | No existe. Debe importarse `{ prisma } from '@/lib/prisma'` |
| `mockNote` | `makeNote(overrides)` |
| `mockTask` | `makeTask(overrides)` |

### 3.2 Error de tipo en `focus.test.ts`

`prisma.$transaction` mock acepta `(fn: Function, options?) → Promise<T>`. Las líneas 67 y 92 pasan `(ops: any[])` en lugar de una función callback. Vitest runtime lo tolera pero `tsc --noEmit` lo rechaza.

**Fix**: cambiar `async (ops: any[]) => { ... }` por `async (fn: any) => fn()` o usar `mockImplementation(async (fn: Function) => fn())`.

### 3.3 Test de integración (E2E)

`tests/e2e.spec.ts` (528 líneas) no se ejecutó. Requiere base de datos real. Fuera de scope de esta fase (ver §6 del protocolo: "NO ejecutes Playwright/E2E").

---

## 4. Gap vs spec

| Categoría | Spec (tasks.md §5) | Realidad | Gap |
|---|---|---|---|
| **Unit tests** | 7 archivos, 17+ escenarios | 4 archivos funcionales, 7 escenarios cubiertos | 3 archivos faltan, 10 escenarios sin cubrir |
| **Snapshot tests** | 2 archivos | 0 | 2 archivos faltan |
| **E2E tests** | 1 archivo reescrito con factorías | 1 archivo (sin verificar) | ⚠️ No verificado (necesita DB) |
| **Test factories** | T-09 implementado | `tests/helpers/factories.ts` existe | ✅ |
| **Backfill tests** | 6 casos mapping | 0 | 6 escenarios sin cubrir |

**Cobertura estimada**: ~40% de los escenarios requeridos tienen tests funcionales. El 60% restante son tests que o no existen o no compilan.

---

## 5. Issues de testabilidad

1. **`getPrismaMock` no existe ni debería existir**: los nuevos tests de `focus.test.ts` y `smoke.test.ts` mockean prisma directamente con `vi.mock('@/lib/prisma', ...)`. Los 3 tests rotos (`accept-goal`, `complete`, `unfocus`) deberían seguir el mismo patrón en lugar de depender de un helper central inexistente.

2. **Testing de `/api/dashboard`**: el endpoint hace 4-5 queries en `Promise.all`. Para testearlo sin DB, hay que mockear `prisma.task.updateMany`, `prisma.habit.findMany`, etc. Es viable pero verboso (≈80 líneas de mocks por test).

3. **Testing de `backfill`**: el script usa `$executeRawUnsafe` y `$queryRaw`. Mockear raw SQL es frágil. Recomendación: testear la lógica de mapping (función pura extraíble) y dejar la ejecución SQL para smoke manual en staging.

---

## 6. Resumen

- **Código de producción**: sin errores de compilación. Schema válido y formateado.
- **Tests compilando**: 3/6 unitarios (smoke, hubs, focus).
- **Tests pasando**: 35/52 (los 17 fallos son todos del mismo bug: imports rotos a `test-setup.ts`).
- **Tests faltantes**: 6 archivos requeridos por spec §5 no existen.
- **Bloqueante para brain-verify**: los tests rotos (`accept-goal`, `complete`, `unfocus`) necesitan corrección de imports. Los tests faltantes (`parse-capture`, `dashboard`, `backfill`, `process`, snapshots) no están implementados.

---

## Result Contract

- **Fase**: brain-test (Fase 6)
- **Status**: `done`
- **Artifact**: `docs/sdd/active/refactor-note-task-split/test-report.md`
- **Próxima fase**: `brain-verify`
- **Riesgos**:
  1. **3 test files no compilan** — imports rotos a helpers inexistentes en `test-setup.ts`. Fix: adaptar imports al patrón de `focus.test.ts` (mock directo de prisma/auth/cookies).
  2. **6 archivos de test requeridos no existen** — `parse-capture`, `dashboard`, `backfill`, `process`, 2 snapshots. Sin ellos, regresiones en backfill y dashboard no se detectan automáticamente.
  3. **focus.test.ts** tiene 2 errores de tipo en `$transaction` mock — compila en vitest pero no en `tsc --noEmit`.
