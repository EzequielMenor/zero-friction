# Design: Tareas vs Notas — diferenciación UX con modelo unificado

## 1. Objetivo

Resolver los síntomas reportados por el usuario al probar el MVP durante 5 minutos:

1. No hay diferenciación visual/funcional entre tareas y notas — el usuario siente que "todo es lo mismo".
2. El botón "Eliminar Nota" aparece hardcodeado incluso al editar una tarea.
3. Una tarea creada por la IA en el dominio `PERSONAL` no aparece en el dashboard `Today`, así que el usuario no entiende dónde está.
4. Las listas de los Hubs no distinguen tareas de reflexiones.

El modelo de datos se mantiene unificado (`Note` único). La separación tarea/nota se calcula en runtime a partir de los metadatos del item (`isTask()`).

## 2. Modelo Mental: Accionable vs Reflexión

Una `Note` es:

- **Tarea (accionable)** si cumple cualquiera de:
  - Tiene `dueDate` definido.
  - Tiene `isImportant = true`.
  - Tiene `status` en `ACTIVE` o `IN_PROGRESS`.
- **Nota (reflexión)** en cualquier otro caso (incluye `status = DRAFT`, `DONE`, `NEEDS_REVIEW`).

Este predicado es transversal al dominio. Un item en `ESPIRITUAL` con fecha es una tarea. Un item en `PROYECTOS` sin fecha y sin marcar importante es una nota.

El dashboard `Today` agrega **todas** las tareas (todos los dominios). Los Hubs siguen mostrando todo lo del dominio, sin filtrar por accionabilidad, pero la lista diferencia visualmente tareas vs notas.

## 3. Helper compartido: `lib/notes.ts`

Archivo nuevo.

```ts
export type TaskLikeNote = {
  dueDate: string | Date | null
  isImportant: boolean
  status: string
}

/**
 * ¿Este Note es una "tarea" (accionable) o una "nota" (reflexión)?
 * Predicado puro, sin dependencias, testeable.
 */
export function isTask(n: TaskLikeNote): boolean {
  if (n.dueDate) return true
  if (n.isImportant) return true
  if (n.status === 'ACTIVE' || n.status === 'IN_PROGRESS') return true
  return false
}
```

Decisiones:

- Tipo `TaskLikeNote` mínimo: solo los campos que el predicado necesita. Cualquier objeto con esa forma sirve.
- `status` `NEEDS_REVIEW` no cuenta como tarea (la spec lo reserva para "necesita intervención humana", no accionable).
- `status` `DONE` tampoco (ya está hecha).

## 4. Backend: `GET /api/today` cross-domain

Archivo: `app/api/today/route.ts`

Las queries `focusTask`, `todayTasks` y `maintenanceTasks` dejan de filtrar `domain: 'PROYECTOS'`. Pasan a ser cross-domain con la siguiente forma común:

```ts
const taskWhereBase = {
  userId: session.userId,
  status: { in: ['ACTIVE', 'IN_PROGRESS'] as const },
}
```

### 4.1 `focusTask`

Una sola tarea en `IN_PROGRESS`, orden por `isImportant desc, updatedAt desc`. Sin filtro de dominio.

```ts
prisma.note.findFirst({
  where: { ...taskWhereBase, status: 'IN_PROGRESS' },
  orderBy: [{ isImportant: 'desc' }, { updatedAt: 'desc' }],
  select: NOTE_SELECT,
})
```

### 4.2 `todayTasks`

Tareas con `dueDate` en el rango `[startOfToday, startOfTomorrow)`.

```ts
prisma.note.findMany({
  where: {
    ...taskWhereBase,
    dueDate: { gte: startOfToday, lt: startOfTomorrow },
  },
  orderBy: [{ isImportant: 'desc' }, { createdAt: 'asc' }],
  select: NOTE_SELECT,
})
```

### 4.3 `maintenanceTasks`

Tareas atrasadas (`dueDate < startOfToday`) + tareas sin fecha marcadas como importantes.

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
})
```

El resto del endpoint (hábitos, suscripciones, resurgir) **no cambia**.

### 4.4 Notas sobre datos existentes

No hay migración. Cualquier item existente que cumpla `isTask()` aparecerá automáticamente en `Today` aunque viva en `PERSONAL`, `ESPIRITUAL` o `APRENDIZAJE`. Los que no cumplan, se quedan en sus hubs como reflexiones, sin cambios.

## 5. Frontend: Editor `NotePanel`

Archivo: `components/NotePanel.tsx`

Cambios:

1. Importar `isTask` desde `@/lib/notes`.
2. Reemplazar todas las condiciones que dependían de `domain === 'PROYECTOS' || domain === 'PERSONAL'` por `isTask(note ?? draft ?? { dueDate: null, isImportant: false, status: 'DRAFT' })`.
3. **Botón Eliminar (línea 390):** cambiar literal `"Eliminar Nota"` a `Eliminar {isTask(note) ? 'Tarea' : 'Nota'}`.
4. **Confirm dialog (línea 146):** cambiar `'¿Estás seguro de que querés eliminar esta nota? ...'` por un mensaje que use el predicado para decir "esta tarea" o "esta nota".
5. **Placeholder del título (línea 276):** unificar a `"Título (opcional)"`. No diferenciar por dominio.
6. **Placeholder del contenido (línea 468):** unificar a `"Escribí el contenido..."`. No diferenciar por dominio.
7. **Label del campo contenido (línea 463):** unificar a `"Contenido"`.

## 6. Frontend: Lista `NoteCard` en `HubContent`

Archivo: `app/(app)/hubs/[domain]/HubContent.tsx`

El componente `NoteCard` recibe hoy un `note` y un callback `onOpen`. Cambios:

1. Importar `isTask` desde `@/lib/notes`.
2. Si `isTask(note)`:
   - Mostrar un checkbox a la izquierda.
   - Mostrar la fecha destacada (`dueDate`) si existe, con badge `📅 dd/mm`.
   - Badge `'Tarea'` en la fila de metadatos.
3. Si no es tarea:
   - Sin checkbox.
   - Sin fecha destacada.
   - Badge `'Nota'`.
4. Click en el checkbox: PATCH al endpoint `/api/notes/[id]` con `status: 'DONE'`, optimistic update local.
5. Click en el cuerpo: abre el editor (igual que hoy).

## 7. Datos y migración

Sin cambios en schema. Sin migración. Items existentes que ya cumplen `isTask()` se exponen correctamente sin tocar nada.

El item reportado por el usuario (una tarea en `PERSONAL`) aparecerá automáticamente en `Today` tras el cambio del endpoint. Se verá como tarea en el Hub Personal con checkbox visible. **No requiere acción manual del usuario más allá de verificar que el item tiene fecha o está marcado importante.**

## 8. Tests

### 8.1 Unit test del predicado `isTask`

Archivo: `lib/notes.test.ts`

```ts
import { isTask } from './notes'

describe('isTask', () => {
  it('true si dueDate está definido', () => {
    expect(isTask({ dueDate: '2026-07-01', isImportant: false, status: 'ACTIVE' })).toBe(true)
  })
  it('true si isImportant es true', () => {
    expect(isTask({ dueDate: null, isImportant: true, status: 'ACTIVE' })).toBe(true)
  })
  it('true si status es ACTIVE', () => {
    expect(isTask({ dueDate: null, isImportant: false, status: 'ACTIVE' })).toBe(true)
  })
  it('true si status es IN_PROGRESS', () => {
    expect(isTask({ dueDate: null, isImportant: false, status: 'IN_PROGRESS' })).toBe(true)
  })
  it('false si status es DRAFT sin fecha ni importancia', () => {
    expect(isTask({ dueDate: null, isImportant: false, status: 'DRAFT' })).toBe(false)
  })
  it('false si status es DONE sin fecha ni importancia', () => {
    expect(isTask({ dueDate: null, isImportant: false, status: 'DONE' })).toBe(false)
  })
  it('false si status es NEEDS_REVIEW sin fecha ni importancia', () => {
    expect(isTask({ dueDate: null, isImportant: false, status: 'NEEDS_REVIEW' })).toBe(false)
  })
})
```

### 8.2 Smoke test del endpoint `/api/today`

Manual: crear items en `PERSONAL` y `ESPIRITUAL` con `dueDate` hoy, verificar que aparecen en `/api/today`.

## 9. Archivos modificados / creados

**Creados:**

- `lib/notes.ts` — predicado `isTask`.
- `lib/notes.test.ts` — unit tests del predicado.

**Modificados:**

- `app/api/today/route.ts` — quitar filtro `domain: 'PROYECTOS'` de las tres queries de tareas.
- `components/NotePanel.tsx` — usar `isTask` en lugar de comparación por dominio para decidir campos y labels.
- `app/(app)/hubs/[domain]/HubContent.tsx` — `NoteCard` diferencia tareas vs notas visualmente, con checkbox interactivo.

## 10. Out of scope

- Editor rich-text / markdown para notas (issue #5 del backlog del usuario).
- Linking entre notas ([[wiki-links]] estilo Zettelkasten) — issue #5.
- Rediseño del modelo de Proyectos con milestones/hitos (issue #8).
- Cambios en la IA de clasificación (sigue mandando al dominio que considere, la accionabilidad se calcula aparte).
- Quitar el filtro de dominio de las queries internas del endpoint `/api/hubs/[domain]` (cada hub sigue mostrando solo su dominio, eso no cambia).