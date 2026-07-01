# Backlog — Issues reportadas durante prueba del MVP

> Lista priorizada de issues detectados por el usuario al probar la app durante 5 minutos el 2026-07-01. Issues se abordan uno a uno, diseñando bien cada uno antes de implementar (flujo `brainstorming` → `writing-plans` → `subagent-driven-development`).
>
> Última actualización: 2026-07-01

---

## ✅ Done

- **#1 Tareas vs Notas** — Diferenciar visual y funcionalmente tareas y notas en toda la app. Spec en `docs/superpowers/specs/2026-07-01-tareas-vs-notas-design.md`, plan en `docs/superpowers/plans/2026-07-01-tareas-vs-notas.md`. Merged vía PR #6.

---

## Pendientes (orden propuesto)

### Bugs / bloqueantes diarios

#### #2 — Inbox "Error de red. Reintentá."
- **Síntoma:** Al procesar un item del inbox sale el error, sin diferenciar timeout / 5xx / red caída.
- **Causa probable:** El fetch a `/api/notes/[id]/process` falla, posiblemente por la API de IA caída o un 502. El catch all en `InboxSection.tsx:182` no distingue el tipo de error.
- **Archivos sospechosos:** `components/InboxSection.tsx`, `app/api/notes/[id]/process/route.ts`, `lib/llm.ts`.
- **Notas:** También "no se si se guarda bien o que" — el usuario sospecha que el guardado está roto, no solo el mensaje.

#### #3 — Today no muestra la tarea importante
- **Síntoma:** Una tarea importante que aparece en el calendario no sale en el dashboard Today.
- **Causa probable:** Resuelto parcialmente por #1 (Today ahora es cross-domain). Verificar post-merge que el caso específico del usuario funciona. Si no, hay otro bug en el filtrado.
- **Archivos sospechosos:** `app/api/today/route.ts`, `app/(app)/page.tsx`.
- **Dependencia:** Validar primero con el fix de #1; puede que ya esté cerrado.

#### #4 — Subscriptions: no puedo elegir la cuenta
- **Síntoma:** En el formulario de suscripción/transferencia no aparece el selector de cuenta.
- **Causa probable:** El modelo `Transaction` ya tiene `accountId` (ver `prisma/schema.prisma`), pero el formulario no lo expone. Falta el selector en la UI de finanzas.
- **Archivos sospechosos:** `app/(app)/hubs/registros/finanzas/page.tsx`, `components/` relacionados.
- **Notas:** Existe el modelo `Account` y migración previa. Posible fix de 1 archivo.

---

### Mejoras UX (features pequeños)

#### #5 — Editor de notas
- **Síntomas reportados:**
  - "no sale lo de enlazar" → falta el linking estilo wiki/Zettelkasten (`[[nota]]`).
  - "no me gusta que tenga que poner el titulo ns" → título debería ser opcional.
  - "no puedo formatear el texto o bueno no se como" → falta toolbar o notación markdown.
- **Archivos sospechosos:** `components/NotePanel.tsx`, posibles componentes nuevos (Markdown renderer, link autocomplete).
- **Decisiones a tomar:** ¿Markdown plano o rich-text editor (Tiptap, Lexical)? ¿Wiki-links con autocomplete o sintaxis cruda? ¿Título opcional aplica a todas las notas o solo a reflexiones?

#### #6 — Hábitos con días específicos
- **Síntoma:** No se puede crear un hábito con días específicos de la semana (L M X J V S D). Solo `daily` / `weekly` / `monthly` como enum.
- **Causa probable:** El modelo `Habit` tiene `frequency: String` sin estructura. Hace falta extender el schema con `daysOfWeek: Int[]` o similar.
- **Archivos sospechosos:** `prisma/schema.prisma`, `app/(app)/hubs/registros/habitos/page.tsx`, `app/api/registros/habitos/route.ts`.
- **Notas:** Migración necesaria (no como #1). Diseño: enum `DIARIO | SEMANAL | MENSUAL | PERSONALIZADO` + array de días.

---

### Features grandes

#### #7 — Modo inversiones
- **Síntoma:** El usuario quiere trackear inversiones en ETFs (Trade Republic). Quiere ver cuánto metió, cuánto gana/pierde, y el progreso. Acepta actualización manual (sin sync automático con Trade Republic).
- **Causa probable:** Feature nuevo entero. No existe en el schema.
- **Decisiones a tomar:** ¿Modelo `Investment` separado o reutilizar `Transaction` con categoría `INVERSION`? ¿Snapshot manual o cálculo de valor actual por holding? ¿Soporte multi-cuenta (Trade Republic, broker X, etc.)?
- **Notas:** Simular P&L requiere precio actual de cada holding. Sin sync automático, el usuario ingresa "valor actual" periódicamente. Diseñar UX de captura rápida (estilo inbox).

#### #8 — Rediseño de Proyectos (el más grande)
- **Síntomas reportados:**
  - "no haria notas como tal, haria un tipo de proyecto y dentro poder enlazar tareas, notas"
  - "que tenga como hitos o los hitos sean las tareas"
  - "progreso fecha de inicio y de fin"
- **Causa probable:** Hoy `PROYECTOS` es solo un dominio más. No hay entidad `Project` con metadata propia (hitos, progreso, fechas).
- **Decisiones a tomar:** ¿Modelo `Project` nuevo con relación a `Note` (donde las tareas son Notes con `projectId`)? ¿Cómo se mide el progreso (% tareas DONE vs hitos completados)? ¿Vista de Kanban, lista, o timeline?
- **Notas:** Cambio de schema mayor. Toca IA (clasificar al proyecto correcto), UI (vista de proyecto), y API (nuevos endpoints). Dejar el último porque es el que más cambia el modelo mental.
- **Dependencias:** Se apoya en #1 (isTask ya diferencia tareas vs notas) y se beneficia de #5 (linking entre notas del proyecto).

---

## Notas para la próxima sesión

- El usuario (Ezequiel) prefiere brainstorming + diseño uno a uno antes de tocar código. No saltar a implementación.
- Idioma de trabajo: español de España. Comentarios en código también en español, cortos.
- Branch actual: `feat/light-mode` (PR #6). Considerar mergear a `main` antes de empezar la siguiente issue, o seguir acumulando.
- Smoke tests manuales siguen siendo complicados desde agentes (BD con SSL, cookies de Chrome protegidas por classifier). El implementer debe documentar el gap en el report; el usuario verifica en local.
- PR #6 está abierto. Antes de empezar #2, considerar si el contenido del PR necesita una actualización (mezcla light-mode + tareas-vs-notas; podría ser confuso para reviewers externos).