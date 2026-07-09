# Phase 3: Project Engine (Archivado 2026-07-09)

## Resumen ejecutivo

Se implementó el modelo `Project` con ENUM `ProjectStatus` (IDEATION | ACTIVE | MAINTENANCE | ARCHIVED) que permite agrupar Notes como contenedor semántico de trabajo personal. Un Proyecto aquí no es un workspace colaborativo — es un tag estructurado con estado para organizar micro-SaaS personales: "estoy construyendo el micro-SaaS X, estas Notes son mi investigación y estas Tasks son mi ejecución". La decisión central fue **D4**: Task NO lleva `projectId` denormalizado, sino que se deriva vía JOIN (`Task → Note → Project`), eliminando el riesgo P1 de desincronización detectado en el deep-think.

El cascade sigue la asimetría fundamental del producto: `Note.projectId → onDelete: SetNull` (el Second Brain sobrevive al borrar el proyecto, embeddings y NoteRelationship intactos), sin `Task.projectId` (la Task ni tiene FK — la pérdida de Tasks de un proyecto muerto es tolerable y deseable como limpieza de deuda táctica). Se añadieron 4 endpoints CRUD nuevos (`/api/projects` POST/GET/GET[id]/PATCH/DELETE) con validación de transiciones en app layer vía constante `PROJECT_TRANSITIONS` + helper `validateTransition`, usando patrón CAS (Compare-And-Swap) con `updateMany` para PATCH race-safe. 3 endpoints existentes se extendieron (dashboard, hubs, calendar, search, notes) con campo informativo `project` opcional. Se creó componente UI `ProjectBadge` con colores por status (Tailwind estáticos) y sin vista dedicada de Projects en MVP (D7, YAGNI).

El SDD pasó por Judgment Day — 9 fixes aplicados: 4 del adversarial review en design (CAS pattern, 3 codes de error separados para invalid_projectId, VALID_STATUSES pre-validate, regex [4][0-9]{2} en DoD) y 5 del apply phase (NOTE_SELECT_WITH_TASK_FLAG_PROJECT, project en NoteItem response, CAS falso cuando body no tiene status, try/catch + mapPrismaError en Projects handlers, rate-limit keys por método HTTP). Se ejecutaron 21 tareas atómicas en 7 batches, generando 9 archivos nuevos, modificando 15 existentes, y añadiendo 26 tests (21 unit + 5 E2E).

## Artefactos del SDD
- `deep-think.md` — análisis arquitectónico con 7 decisiones D1-D7 (454 líneas)
- `explore.md` — validación contra código real, blast radius (~14 archivos), riesgos R-A a R-E (358 líneas)
- `spec.md` — contrato formal (schema, endpoints, migration SQL, 7 batches) (634 líneas)
- `design.md` — arquitectura por capas, testing, errores, observabilidad con 4 fixes C1-C4 (1655 líneas)
- `tasks.md` — 21 tareas atómicas en 7 batches con grafo de dependencias (739 líneas)
- `smoke-checklist.md` — 9 puntos funcionales para staging (159 líneas)
- `verify-checklist.md` — 13 puntos con post-fix items F1/F3/F4 (145 líneas)

## Decisiones arquitectónicas cerradas

| ID  | Decisión                                                                 | Severidad original |
| --- | ------------------------------------------------------------------------ | ------------------ |
| D1  | ProjectStatus = [IDEATION, ACTIVE, MAINTENANCE, ARCHIVED] con DAG + revive | —                  |
| D2  | Note.projectId → onDelete: SetNull (Second Brain sobrevive)              | —                  |
| D3  | /api/dashboard global, campo project informativo en items Task           | —                  |
| D4  | NO Task.projectId. Derivar vía JOIN (Task → Note → Project)              | P1 original        |
| D5  | Project.userId por consistencia con el resto del schema                  | —                  |
| D6  | No soft-delete, no deletedAt                                             | —                  |
| D7  | No endpoint por-proyecto en MVP (YAGNI)                                  | —                  |

## Fixes del adversarial review (Judgment Day)

### Design phase (4 fixes del design.md §1)
- **C1**: CAS pattern en PATCH /api/projects/[id] con updateMany + WHERE status para race-safe transitions
- **C2**: 3 codes separados para invalid_projectId (format/not_found/forbidden) en vez de un code con details.reason
- **C3**: Validación previa con VALID_STATUSES antes de validateTransition para evitar TypeError en PROJECT_TRANSITIONS[from]
- **C4**: DoD check #9 con regex [4][0-9]{2} para detectar 4xx sin ApiError shape

### Apply phase (5 fixes detectados durante brain-apply)
- **F1**: NOTE_SELECT_WITH_TASK_FLAG_PROJECT necesario en GET /api/notes/[id] para que response incluya project asignado
- **F2**: project sale de TaskWithNote y entra en NoteItem (el proyecto es de la Note, no de la Task — D4)
- **F3**: PATCH /api/projects/[id] sin CAS falso cuando body no incluye status (solo name/description)
- **F4**: try/catch + mapPrismaError en todos los handlers de Projects (faltaba en algunos paths de error)
- **F5**: Rate-limit keys separadas por método HTTP (POST vs GET comparten endpoint pero tienen límites distintos)

## Schema final (delta)

```prisma
enum ProjectStatus {
  IDEATION
  ACTIVE
  MAINTENANCE
  ARCHIVED
}

model Project {
  id          String        @id @default(cuid())
  userId      String
  user        User          @relation(fields: [userId], references: [id], onDelete: Cascade)
  name        String
  description String?
  status      ProjectStatus @default(IDEATION)
  createdAt   DateTime      @default(now())
  updatedAt   DateTime      @updatedAt

  notes Note[]

  @@index([userId, status])
  @@index([userId, updatedAt])
}

// En Note:
// projectId String?
// project   Project? @relation(fields: [projectId], references: [id], onDelete: SetNull)
// @@index([projectId, noteStatus])

// En User:
// projects Project[]
```

## Endpoints nuevos
- `POST /api/projects` — crear proyecto (201, default IDEATION)
- `GET /api/projects` — listar proyectos (200, order by updatedAt desc, filtro ?status=)
- `GET /api/projects/[id]` — detalle con notesCount + openTasksCount
- `PATCH /api/projects/[id]` — actualizar con CAS + validateTransition (200/409)
- `DELETE /api/projects/[id]` — hard-delete con SetNull cascade (204/404)

## Endpoints modificados
- `POST /api/notes` — acepta `projectId` opcional con ownership check
- `PATCH /api/notes/[id]` — acepta `projectId` opcional/null, devuelve `project` en response (F1)
- `GET /api/dashboard` — campo `project: {id,name,status} | null` en items Task (focusTask, todayTasks, maintenanceTasks)
- `GET /api/hubs/[domain]` — selector extendido con project
- `GET /api/notes` — selector extendido con project
- `GET /api/calendar` — selector extendido con project
- `GET /api/search` — selector extendido con project

## Métricas
- 21 tareas atómicas ejecutadas en 7 batches
- 9 archivos nuevos: `lib/types/project.ts`, `lib/projects.ts`, `lib/rate-limit.ts`, `components/ProjectBadge.tsx`, `app/api/projects/route.ts`, `app/api/projects/[id]/route.ts`, `tests/unit/projects.test.ts`, migration `.sql`
- 15 archivos modificados: `prisma/schema.prisma`, `lib/types/note.ts`, `lib/types/task.ts`, `lib/hubs.ts`, `app/api/dashboard/route.ts`, `app/api/notes/route.ts`, `app/api/notes/[id]/route.ts`, `app/api/hubs/[domain]/route.ts`, `app/api/calendar/route.ts`, `app/api/search/route.ts`, `app/(app)/page.tsx`, `app/(app)/calendar/page.tsx`, `app/(app)/hubs/[domain]/page.tsx`, `tests/helpers/factories.ts`, `tests/e2e.spec.ts`
- 26 tests añadidos: 21 unit (validateTransition 20/20 combinaciones + mappers + findOwnProjectOrThrow) + 5 E2E (crear+asignar+JOIN, transición inválida 409, cadena completa con revive, delete+huérfana, embeddings/relationships persisten)
- 9 fixes aplicados (4 design C1-C4 + 5 apply F1-F5)
- 1 schema migration aditiva (sin backfill)

## Issues no resueltos / conocido
- 2 errores preexistentes en `tests/unit/focus.test.ts:67,92` (Prisma v7 mock, no de Phase 3)
- E2E no ejecutados localmente (playwright.config.ts no excluye unit/, pre-existente)
- Migration staging pendiente de ejecución humana con cuenta de Supabase
- Smoke manual staging pendiente (9 puntos del smoke-checklist + 4 post-fix F1/F3/F4)

## Próximas fases (futuro)
- Fix playwright.config.ts para que E2E corran localmente (testDir debe excluir unit/)
- Aplicar migration en staging con backup previo
- Smoke manual con cuenta de staging (13 puntos del verify-checklist)
- Commit + PR con los 7 batches mergeados

## Lecciones aprendidas

- **El pipeline brain-team funcionó bien**: deep-think → explore → spec → design → tasks → apply. Cada fase validó la anterior y encontró problemas (D4 reabierto en explore, C1-C4 en design, F1-F5 en apply). La estructura de 7 fases forzó a pensar antes de escribir código.
- **Judgment Day fue útil pero costoso**: 9 fixes entre design y apply. Algunos eran obvios en retrospectiva (F3: no hacer CAS si body no tiene status). Para próxima fase, considerar mover algunos checks del adversarial review a la propia checklist del design (autoinspection antes de pasar a apply).
- **El DAG de transiciones fue simple pero completo**: 4 estados, 9 transiciones válidas. No hizo falta trigger Postgres ni soft-delete. La validación en app layer con constante + helper fue suficiente y testeable.
- **Los 3 codes separados para invalid_projectId** (format/not_found/forbidden) añadieron más archivos de tipos pero mejoraron el DX en debugging. Valió la pena.
- **El CAS pattern con updateMany** para PATCH de Project es correcto pero añadió complejidad inesperada: cuando el body no incluye status, no se debe pasar `status: project.status` al WHERE porque crea un falso positivo (F3).
- **Rate-limit keys separadas por método HTTP**: obvio en retrospectiva, fácil de pasar por alto. Añadirlo a la checklist de diseño rutinario.
- **El tail: process wrapper ausente** en `lib/parse-capture.ts` (detectado en explore) sigue siendo un issue menor abierto. No bloqueó Phase 3 pero conviene arreglarlo pronto.
- **Archivos compartidos de tests son frágiles**: las factorías en `tests/helpers/factories.ts` las usan todos los tests existentes. Un cambio en defaults puede romper cascada. Mitigación: añadir nuevos defaults como parámetros opcionales con valores sensatos.
