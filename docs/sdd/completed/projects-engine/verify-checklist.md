# Verify Checklist: Project Engine (Phase 3)

**Archivo**: `docs/sdd/active/projects-engine/verify-checklist.md`
**Fecha**: 2026-07-09
**Ejecutor**: Ezequiel (humano, cuenta de staging)
**Pre-requisito**: Migration `add_project` aplicada en staging + build verde

> Este checklist amplía `smoke-checklist.md` añadiendo los post-fix items (F1, F3, F4).

---

## Checklist (13 puntos)

### 0. Login
- [ ] Login con cuenta de staging.

### 1. Crear proyecto "Test"
```bash
curl -X POST http://localhost:3000/api/projects \
  -H "Content-Type: application/json" \
  -H "Cookie: sb-access-token=<TOKEN>" \
  -d '{"name":"Test","description":"Proyecto de prueba"}'
```
- [ ] **Esperado**: 201 con `data.id` (cuid), `data.status: "IDEATION"`, `data.name: "Test"`.

### 2. Asignar Note existente al proyecto
```bash
curl -X PATCH http://localhost:3000/api/notes/<NOTE_ID> \
  -H "Content-Type: application/json" \
  -H "Cookie: sb-access-token=<TOKEN>" \
  -d '{"projectId":"<PROJECT_ID>"}'
```
- [ ] **Esperado**: 200 con `data.project: { id, name, status }`.

### 3. Badge en dashboard
```bash
curl http://localhost:3000/api/dashboard \
  -H "Cookie: sb-access-token=<TOKEN>" | jq '.data.todayTasks[0].note.project'
```
- [ ] **Esperado**: `{ id, name, status }` (o null si no hay dueDate hoy).

### 4. Transiciones válidas
```bash
for status in ACTIVE MAINTENANCE ARCHIVED; do
  curl -X PATCH http://localhost:3000/api/projects/<PROJECT_ID> \
    -H "Content-Type: application/json" \
    -H "Cookie: sb-access-token=<TOKEN>" \
    -d "{\"status\":\"$status\"}"
done
```
- [ ] **Esperado**: cada paso devuelve 200 con `data.status` actualizado.

### 5. Transición inválida (ARCHIVED → MAINTENANCE)
```bash
curl -X PATCH http://localhost:3000/api/projects/<PROJECT_ID> \
  -H "Content-Type: application/json" \
  -H "Cookie: sb-access-token=<TOKEN>" \
  -d '{"status":"MAINTENANCE"}'
```
- [ ] **Esperado**: 409 con `error.details.allowedFromCurrent = ["ACTIVE", "IDEATION"]`.

### 6. Revivir ARCHIVED → ACTIVE
```bash
curl -X PATCH http://localhost:3000/api/projects/<PROJECT_ID> \
  -H "Content-Type: application/json" \
  -H "Cookie: sb-access-token=<TOKEN>" \
  -d '{"status":"ACTIVE"}'
```
- [ ] **Esperado**: 200 con `data.status: "ACTIVE"`.

### 7. DELETE proyecto → Note huérfana
```bash
curl -X DELETE http://localhost:3000/api/projects/<PROJECT_ID> \
  -H "Cookie: sb-access-token=<TOKEN>" -v
```
- [ ] **Esperado DELETE**: 204 No Content.
- [ ] **Esperado DB**: `SELECT "projectId" FROM "Note" WHERE id = '<NOTE_ID>'` → `NULL`.
- [ ] **Esperado DB**: `SELECT "id" FROM "Task" WHERE "noteId" = '<NOTE_ID>'` → existe.

### 8. Buscar Note huérfana
```bash
curl "http://localhost:3000/api/search?q=<PALABRA_CLAVE>" \
  -H "Cookie: sb-access-token=<TOKEN>" | jq '.data[] | select(.id == "<NOTE_ID>")'
```
- [ ] **Esperado**: Note aparece en resultados con `project: null`.

### 9. Embedding pgvector intacto
```sql
SELECT vector_dims(embedding) FROM "Note" WHERE id = '<NOTE_ID>';
```
- [ ] **Esperado**: `vector_dims = 1536`.

---

### Post-fix items

### F4. DELETE /api/projects/[id] inexistente
```bash
curl -X DELETE http://localhost:3000/api/projects/<ID_INEXISTENTE> \
  -H "Cookie: sb-access-token=<TOKEN>" -v
```
- [ ] **Esperado**: 404 con `{ ok: false, error: { code: "not_found" } }`.

### F3. PATCH solo name (sin status)
```bash
curl -X PATCH http://localhost:3000/api/projects/<PROJECT_ID> \
  -H "Content-Type: application/json" \
  -H "Cookie: sb-access-token=<TOKEN>" \
  -d '{"name":"Nuevo nombre"}'
```
- [ ] **Esperado**: 200 OK (NO 409). `data.name === "Nuevo nombre"`.

### F1. GET /api/notes/[id] devuelve project asignado
```bash
curl http://localhost:3000/api/notes/<NOTE_ID> \
  -H "Cookie: sb-access-token=<TOKEN>" | jq '.project'
```
- [ ] **Esperado**: `{ id, name, status }` si tiene proyecto asignado; `null` si no.

---

## Resultado

| # | Punto | Estado |
|---|-------|--------|
| 0 | Login | [ ] |
| 1 | Crear proyecto | [ ] |
| 2 | Asignar Note a proyecto | [ ] |
| 3 | Badge en dashboard | [ ] |
| 4 | Transiciones válidas | [ ] |
| 5 | Transición inválida → 409 | [ ] |
| 6 | Revivir ARCHIVED → ACTIVE | [ ] |
| 7 | DELETE → Note huérfana | [ ] |
| 8 | Buscar Note huérfana | [ ] |
| 9 | Embedding pgvector | [ ] |
| F4 | DELETE inexistente → 404 | [ ] |
| F3 | PATCH solo name → 200 | [ ] |
| F1 | GET note con project | [ ] |

**Total**: __ / 13

---

**Firma**: ______________
**Fecha**: ____________
