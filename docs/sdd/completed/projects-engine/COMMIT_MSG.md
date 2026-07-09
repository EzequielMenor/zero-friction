feat(projects): add Project engine with Note grouping and lifecycle states

Phase 3: Project Engine. Adds a Project model that groups Notes (and
transitively, Tasks via JOIN) for personal execution context.

Data model:
- New enum ProjectStatus (IDEATION | ACTIVE | MAINTENANCE | ARCHIVED)
- New model Project with DAG transitions and ARCHIVED→ACTIVE revive
- Note.projectId nullable with onDelete: SetNull (Second Brain survives)
- Task NOT modified (project derived via Task→Note→Project JOIN, D4)

API:
- 4 new endpoints under /api/projects (POST, GET, GET [id], PATCH, DELETE)
- PATCH uses CAS pattern (updateMany with WHERE status) for race-safe transitions
- POST/PATCH /api/notes accept optional projectId with eager ownership check
- /api/dashboard extended with project metadata in task items
- /api/hubs/[domain], /api/notes, /api/calendar, /api/search extended with project

UI:
- New ProjectBadge component (static Tailwind classes per status)
- Dashboard renders badge in focusTask/todayTasks/maintenanceTasks
- Calendar and hubs pages also render badge

Testing:
- 21 unit tests for validateTransition (full DAG coverage, 20/20 combinations)
- 5 new E2E tests for project CRUD, transition, cascade, orphan resilience
- Factories extended with createProject and NoteInput.projectId

Migration: prisma/migrations/20260709130000_add_project (additive, no backfill)

Closes: Phase 3 (Project Engine)
SDD: docs/sdd/completed/projects-engine/
