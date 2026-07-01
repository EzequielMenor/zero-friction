# Tareas vs Notas Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Diferenciar visual y funcionalmente tareas vs notas en toda la app, sin romper el modelo de datos unificado, para resolver los bugs reportados por el usuario al probar el MVP.

**Architecture:** Helper compartido `isTask()` en `lib/notes.ts` calcula accionabilidad desde metadatos del Note. Editor y listas usan el predicado para decidir campos y visuales. El endpoint `/api/today` pasa a cross-domain, agregando tareas de todos los dominios. Sin migración de datos.

**Tech Stack:** Next.js 15+ App Router, TypeScript, Prisma, React 19, Tailwind v4. Tests con `node --test --experimental-strip-types` (Node 22 nativo, sin nuevas deps).

---

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `lib/notes.ts` | Create | Predicado `isTask()` puro + tipos |
| `lib/notes.test.ts` | Create | Tests del predicado con `node:test` |
| `package.json` | Modify | Script `test:notes` para correr los tests |
| `app/api/today/route.ts` | Modify | Queries `focusTask/todayTasks/maintenanceTasks` sin filtro de dominio |
| `components/NotePanel.tsx` | Modify | Usar `isTask()` para campos, label Eliminar, confirm, placeholders |
| `app/(app)/hubs/[domain]/HubContent.tsx` | Modify | `NoteCard` con checkbox + badge Tarea/Nota cuando aplica |

---

## Global Constraints

- Sin nuevas dependencias (Ponytail mode: mínima huella).
- Sin migración de Prisma: el modelo `Note` no cambia.
- Idioma: español de España. Comentarios cortos en código.
- Commits conventional con scope (e.g. `feat(notes): ...`, `fix(today): ...`).
- No tocar archivos fuera de los listados arriba.
- Branch actual: `feat/light-mode`.

---

### Task 1: Predicado `isTask()` con tests

**Files:**
- Create: `lib/notes.ts`
- Create: `lib/notes.test.ts`
- Modify: `package.json` (añadir script `test:notes`)

**Interfaces:**
- Produces: `export function isTask(n: TaskLikeNote): boolean` — Tasks 2, 3 y 4 importan esta función.

- [ ] **Step 1: Crear `lib/notes.test.ts` (TDD: test primero)**

Crear el archivo con los casos. Aún no existe la implementación, los tests deben fallar.

```ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isTask } from './notes.ts'

test('isTask: true si dueDate está definido', () => {
  assert.equal(
    isTask({ dueDate: '2026-07-01', isImportant: false, status: 'ACTIVE' }),
    true
  )
})

test('isTask: true si isImportant es true', () => {
  assert.equal(
    isTask({ dueDate: null, isImportant: true, status: 'ACTIVE' }),
    true
  )
})

test('isTask: true si status es ACTIVE', () => {
  assert.equal(
    isTask({ dueDate: null, isImportant: false, status: 'ACTIVE' }),
    true
  )
})

test('isTask: true si status es IN_PROGRESS', () => {
  assert.equal(
    isTask({ dueDate: null, isImportant: false, status: 'IN_PROGRESS' }),
    true
  )
})

test('isTask: false si status es DRAFT sin fecha ni importancia', () => {
  assert.equal(
    isTask({ dueDate: null, isImportant: false, status: 'DRAFT' }),
    false
  )
})

test('isTask: false si status es DONE sin fecha ni importancia', () => {
  assert.equal(
    isTask({ dueDate: null, isImportant: false, status: 'DONE' }),
    false
  )
})

test('isTask: false si status es NEEDS_REVIEW sin fecha ni importancia', () => {
  assert.equal(
    isTask({ dueDate: null, isImportant: false, status: 'NEEDS_REVIEW' }),
    false
  )
})

test('isTask: acepta Date además de string ISO en dueDate', () => {
  assert.equal(
    isTask({ dueDate: new Date('2026-07-01'), isImportant: false, status: 'DRAFT' }),
    true
  )
})
```

- [ ] **Step 2: Verificar que el test falla (no existe la implementación)**

Run:
```bash
node --experimental-strip-types --test lib/notes.test.ts
```

Expected: FAIL con "Cannot find module './notes.ts'" o similar.

- [ ] **Step 3: Crear `lib/notes.ts` con la implementación mínima**

```ts
// Predicado puro: ¿este Note es una tarea (accionable) o una nota (reflexión)?
// Usado por el editor, las listas de hubs y el endpoint /api/today.

export type TaskLikeNote = {
  dueDate: string | Date | null
  isImportant: boolean
  status: string
}

export function isTask(n: TaskLikeNote): boolean {
  if (n.dueDate) return true
  if (n.isImportant) return true
  if (n.status === 'ACTIVE' || n.status === 'IN_PROGRESS') return true
  return false
}
```

- [ ] **Step 4: Verificar que el test pasa**

Run:
```bash
node --experimental-strip-types --test lib/notes.test.ts
```

Expected: PASS, 8 tests ok, 0 failures.

- [ ] **Step 5: Añadir script `test:notes` en `package.json`**

Modificar `package.json`, sección `scripts`. Añadir:

```json
"test:notes": "node --experimental-strip-types --test lib/notes.test.ts"
```

- [ ] **Step 6: Commit**

```bash
git add lib/notes.ts lib/notes.test.ts package.json
git commit -m "feat(notes): predicado isTask() con tests nativos de Node"
```

---

### Task 2: `/api/today` cross-domain

**Files:**
- Modify: `app/api/today/route.ts`

**Interfaces:**
- Consumes: `isTask` no se usa directamente aquí (es lógica en BD, no en JS). Las queries Prisma reproducen la misma lógica en WHERE clauses.

- [ ] **Step 1: Modificar las queries de tareas en `app/api/today/route.ts`**

Localizar las queries `focusTask`, `todayTasks` y `maintenanceTasks` (líneas ~32-64 del archivo actual). Reemplazar `domain: 'PROYECTOS'` por nada en cada una.

Definir al inicio del handler (después de calcular `startOfToday`/`startOfTomorrow`):

```ts
// ponytail: lógica equivalente a isTask() pero expresada en WHERE Prisma.
// Cross-domain: cualquier Note accionable del usuario, sin importar su dominio.
const taskWhereBase = {
  userId: session.userId,
  status: { in: ['ACTIVE', 'IN_PROGRESS'] as const },
}
```

Reemplazar `focusTask`:

```ts
prisma.note.findFirst({
  where: { ...taskWhereBase, status: 'IN_PROGRESS' },
  orderBy: [{ isImportant: 'desc' }, { updatedAt: 'desc' }],
  select: NOTE_SELECT,
}),
```

Reemplazar `todayTasks`:

```ts
prisma.note.findMany({
  where: {
    ...taskWhereBase,
    dueDate: { gte: startOfToday, lt: startOfTomorrow },
  },
  orderBy: [{ isImportant: 'desc' }, { createdAt: 'asc' }],
  select: NOTE_SELECT,
}),
```

Reemplazar `maintenanceTasks`:

```ts
prisma.note.findMany({
  where: {
    ...taskWhereBase,
    OR: [
      { dueDate: { lt: startOfToday } },
      { dueDate: null, isImportant: true },
    ],
  },
  orderBy: [{ dueDate: 'asc' }, { isImportant: 'desc' }, { createdAt: 'asc' }],
  select: NOTE_SELECT,
}),
```

NO tocar:
- `habits` query
- `dueSubscription` IIFE
- `resurgenceNote` IIFE
- La sección "Enrich habits with completedToday flag"
- El `NextResponse.json` final

- [ ] **Step 2: Verificar tipos y lint**

Run:
```bash
npx tsc --noEmit
npm run lint
```

Expected: 0 errores.

- [ ] **Step 3: Smoke test manual**

Arrancar el dev server (`npm run dev`) en otra terminal. Loguearse con un usuario. En la base de datos (vía `npx prisma studio` o `psql`), crear un Note:

```sql
INSERT INTO "Note" (id, "userId", title, content, domain, status, "isImportant", tags, "suggestedGoals", "createdAt", "updatedAt")
VALUES ('test-task-personal-1', '<userId>', 'Llamar dentista', 'Llamar al dentista el lunes', 'PERSONAL', 'ACTIVE', true, '{}', '{}', NOW(), NOW());
```

Sustituir `<userId>` por el ID real (visible en `/api/auth/me`).

Visitar `/` (Today). Expected: la tarea aparece en la lista "TAREAS DE HOY" con el checkbox y el badge "★ Importante".

Limpiar el item de prueba:
```sql
DELETE FROM "Note" WHERE id = 'test-task-personal-1';
```

- [ ] **Step 4: Commit**

```bash
git add app/api/today/route.ts
git commit -m "fix(today): queries cross-domain — tareas de todos los dominios aparecen en el dashboard"
```

---

### Task 3: `NotePanel` usa `isTask()` para campos y labels

**Files:**
- Modify: `components/NotePanel.tsx`

**Interfaces:**
- Consumes: `import { isTask } from '@/lib/notes'`

- [ ] **Step 1: Importar `isTask`**

Al inicio del archivo, junto a los otros imports:

```ts
import { isTask } from '@/lib/notes'
```

- [ ] **Step 2: Reemplazar el confirm dialog (línea 146)**

Localizar:

```ts
if (!window.confirm('¿Estás seguro de que querés eliminar esta nota? Esta acción no se puede deshacer.')) return
```

Reemplazar por:

```ts
const entity = isTask(note) ? 'esta tarea' : 'esta nota'
if (!window.confirm(`¿Estás seguro de que querés eliminar ${entity}? Esta acción no se puede deshacer.`)) return
```

- [ ] **Step 3: Reemplazar el label del botón Eliminar (línea 390)**

Localizar:

```tsx
Eliminar Nota
```

Reemplazar por:

```tsx
Eliminar {isTask(note) ? 'Tarea' : 'Nota'}
```

- [ ] **Step 4: Reemplazar el `&&` por dominio (línea 295)**

Localizar:

```tsx
{(domain === 'PROYECTOS' || domain === 'PERSONAL') && (
```

(Abre el bloque con los campos Estado, Fecha Límite e Importante. Es el único `&&` por dominio en el archivo — los otros usos del patrón son ternarios `?:` en label/placeholder, manejados en los steps 5-7.)

Reemplazar por:

```tsx
{isTask({ dueDate, isImportant, status }) && (
```

- [ ] **Step 5: Reemplazar el placeholder del título (línea 276)**

Localizar:

```tsx
placeholder={domain === 'PROYECTOS' || domain === 'PERSONAL' ? 'Nombre de la tarea' : 'Título de la nota'}
```

Reemplazar por:

```tsx
placeholder="Título (opcional)"
```

- [ ] **Step 6: Reemplazar el label del campo contenido (línea 463)**

Localizar:

```tsx
{(domain === 'PROYECTOS' || domain === 'PERSONAL') ? 'Descripción' : 'Contenido'}
```

Reemplazar por:

```tsx
Contenido
```

- [ ] **Step 7: Reemplazar el placeholder del contenido (línea 468)**

Localizar:

```tsx
placeholder={domain === 'PROYECTOS' || domain === 'PERSONAL' ? 'Escribí la descripción o sub-tareas…' : 'Escribí el contenido de la nota…'}
```

Reemplazar por:

```tsx
placeholder="Escribí el contenido…"
```

- [ ] **Step 8: Verificar tipos y lint**

Run:
```bash
npx tsc --noEmit
npm run lint
```

Expected: 0 errores.

- [ ] **Step 9: Verificación visual manual**

Arrancar dev server, abrir cualquier item accionable (uno con fecha o marcado importante). Expected: aparecen los campos Estado, Fecha Límite, Importante. El botón Eliminar dice "Eliminar Tarea".

Abrir un item NO accionable (una reflexión sin fecha, no importante, status DRAFT/DONE/NEEDS_REVIEW). Expected: aparecen solo los campos básicos. El botón Eliminar dice "Eliminar Nota".

- [ ] **Step 10: Commit**

```bash
git add components/NotePanel.tsx
git commit -m "refactor(notes): NotePanel usa isTask() en lugar de filtrar por dominio"
```

---

### Task 4: `NoteCard` en `HubContent` diferencia tareas vs notas

**Files:**
- Modify: `app/(app)/hubs/[domain]/HubContent.tsx`

**Interfaces:**
- Consumes: `import { isTask } from '@/lib/notes'`

- [ ] **Step 1: Importar `isTask`**

Al inicio del archivo, junto a los otros imports:

```ts
import { isTask } from '@/lib/notes'
```

- [ ] **Step 2: Reemplazar el componente `NoteCard` completo**

Localizar la definición completa de `function NoteCard({...})` y reemplazar por:

```tsx
function NoteCard({
  note,
  onOpen,
  onToggleTask,
}: {
  note: NoteItem
  onOpen: (n: NoteItem) => void
  onToggleTask: (n: NoteItem) => void
}) {
  const task = isTask(note)
  const isDone = note.status === 'DONE'

  return (
    <div className="border border-border bg-surface hover:border-accent/30 transition-colors group">
      <div className="flex items-start gap-3 px-5 py-4">
        {/* Checkbox — solo si es tarea */}
        {task && (
          <button
            onClick={(e) => {
              e.stopPropagation()
              onToggleTask(note)
            }}
            className="flex-shrink-0 w-5 h-5 border mt-1 focus:outline-none focus:ring-1 focus:ring-accent transition-all duration-150"
            style={{
              borderColor: '#A68966',
              backgroundColor: isDone ? '#A68966' : 'transparent',
            }}
            aria-label={isDone ? `Desmarcar ${note.title}` : `Completar ${note.title}`}
          >
            {isDone && (
              <svg viewBox="0 0 12 12" className="w-full h-full">
                <polyline
                  points="2,6 5,9 10,3"
                  fill="none"
                  stroke="black"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            )}
          </button>
        )}

        {/* Cuerpo — abre el editor */}
        <button
          onClick={() => onOpen(note)}
          className="flex-1 min-w-0 text-left"
        >
          <h3
            className={`font-serif text-lg leading-snug group-hover:text-accent/80 transition-colors ${
              isDone ? 'line-through text-fg-faint' : 'text-fg'
            }`}
          >
            {note.title || 'Sin título'}
          </h3>
          {note.content && (
            <p className="text-fg-faint text-xs mt-1 line-clamp-2 leading-relaxed">
              {note.content.replace(/\n/g, ' ')}
            </p>
          )}
        </button>

        <div className="flex-shrink-0 text-fg-faint group-hover:text-accent transition-colors mt-0.5">
          <svg viewBox="0 0 12 12" className="w-3 h-3">
            <polyline
              points="2,1 10,1 10,9"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <line
              x1="10"
              y1="1"
              x2="2"
              y2="9"
              stroke="currentColor"
              strokeWidth="1.2"
              strokeLinecap="round"
            />
          </svg>
        </div>
      </div>

      <div className="flex items-center gap-2 px-5 pb-3 text-[10px] text-fg-faint">
        <span
          className={`text-[9px] uppercase tracking-wider border px-1.5 py-0.5 ${
            task
              ? 'border-accent/40 text-accent'
              : 'border-border text-fg-faint'
          }`}
        >
          {task ? 'Tarea' : 'Nota'}
        </span>
        {task && note.dueDate && (
          <span>
            📅{' '}
            {new Date(note.dueDate).toLocaleDateString('es-AR', {
              day: '2-digit',
              month: '2-digit',
            })}
          </span>
        )}
        <span>Actualizada {relativeTime(note.updatedAt)}</span>
        {note.isImportant && <span className="text-accent">★</span>}
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Añadir handler `handleToggleTask` en `HubContent`**

Localizar el bloque donde están las otras funciones (después de `load()`). Añadir:

```tsx
async function handleToggleTask(note: NoteItem) {
  const next = note.status === 'DONE' ? 'ACTIVE' : 'DONE'
  // Optimistic update
  if (data) {
    setData({
      ...data,
      notes: data.notes.map((n) =>
        n.id === note.id ? { ...n, status: next as NoteStatus } : n
      ),
    })
  }
  try {
    const res = await fetch(`/api/notes/${note.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: next }),
    })
    if (!res.ok) throw new Error()
    // Refrescar para mantener relaciones (relationships pueden haber cambiado)
    await load()
  } catch {
    // Rollback
    if (data) {
      setData({
        ...data,
        notes: data.notes.map((n) =>
          n.id === note.id ? { ...n, status: note.status } : n
        ),
      })
    }
  }
}
```

- [ ] **Step 4: Pasar `onToggleTask` al componente `NoteCard`**

Localizar la línea donde se renderiza la lista de notes (alrededor de la línea 268):

```tsx
{filteredNotes.map((note) => (
  <NoteCard key={note.id} note={note} onOpen={setSelectedNote} />
))}
```

Reemplazar por:

```tsx
{filteredNotes.map((note) => (
  <NoteCard
    key={note.id}
    note={note}
    onOpen={setSelectedNote}
    onToggleTask={handleToggleTask}
  />
))}
```

- [ ] **Step 5: Verificar tipos y lint**

Run:
```bash
npx tsc --noEmit
npm run lint
```

Expected: 0 errores.

- [ ] **Step 6: Verificación visual manual**

Visitar `/hubs/personal`. Expected:
- Items con fecha → muestran checkbox a la izquierda, fecha destacada (📅 dd/mm) en la fila inferior, badge "Tarea" con borde accent.
- Items sin fecha ni importancia → sin checkbox, badge "Nota" neutro, sin fecha.
- Click en checkbox → marca como DONE (tachado), badge "Tarea" sigue visible.
- Click en el cuerpo → abre el editor.

Repetir en `/hubs/espiritual` y `/hubs/aprendizaje` para confirmar cross-domain.

- [ ] **Step 7: Commit**

```bash
git add app/\(app\)/hubs/\[domain\]/HubContent.tsx
git commit -m "feat(hubs): NoteCard diferencia tareas vs notas con checkbox interactivo"
```

---

## Verification Global (post-implementación)

1. **Tests pasan:** `npm run test:notes` → 8/8 PASS.
2. **Tipos OK:** `npx tsc --noEmit` → 0 errores.
3. **Lint OK:** `npm run lint` → 0 errores.
4. **Smoke test E2E manual:**
   - Crear un Note en `PERSONAL` con `dueDate` hoy e `isImportant=true` → aparece en `/` (Today).
   - El mismo item se ve como tarea (con checkbox) en `/hubs/personal`.
   - Marcar como DONE desde el checkbox del hub → el item se tacha y desaparece de Today.
   - Abrir el editor del item → el botón Eliminar dice "Eliminar Tarea".
5. **Regresión:** los items NO accionables (reflexiones, notas sin fecha) siguen mostrándose igual en los hubs, sin checkbox, sin aparecer en Today.

---

## Out of Scope (no tocar en este plan)

- Editor rich-text / markdown (issue separado del backlog del usuario).
- Linking entre notas estilo Zettelkasten.
- Rediseño del modelo de Proyectos.
- Cambios en la IA de clasificación.
- Tests automatizados del endpoint `/api/today` o de los componentes UI (no hay infra; verificación manual).
