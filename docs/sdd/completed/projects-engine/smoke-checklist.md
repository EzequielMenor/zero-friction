# Smoke Checklist: Project Engine (Phase 3)

**Archivo**: `docs/sdd/active/projects-engine/smoke-checklist.md`
**Fecha**: 2026-07-09
**Ejecutor**: Ezequiel (humano, cuenta de staging)
**Pre-requisito**: Migration `add_project` aplicada en staging (T2.2)

---

## Checklist (9 puntos del spec §6)

### 1. Crear proyecto "Test" vía POST /api/projects

```bash
curl -X POST http://localhost:3000/api/projects \
  -H "Content-Type: application/json" \
  -H "Cookie: sb-access-token=<TOKEN>" \
  -d '{"name":"Test","description":"Proyecto de prueba"}'
```

- [ ] **Esperado**: 201 con `data.id` (cuid), `data.status: "IDEATION"`, `data.name: "Test"`.

---

### 2. Asignar Note existente al proyecto vía PATCH /api/notes/[id]

```bash
curl -X PATCH http://localhost:3000/api/notes/<NOTE_ID> \
  -H "Content-Type: application/json" \
  -H "Cookie: sb-access-token=<TOKEN>" \
  -d '{"projectId":"<PROJECT_ID>"}'
```

- [ ] **Esperado**: 200 con `data.project: { id, name, status }`.

---

### 3. Verificar badge en dashboard: GET /api/dashboard

```bash
curl http://localhost:3000/api/dashboard \
  -H "Cookie: sb-access-token=<TOKEN>" | jq '.data.todayTasks[0].note.project'
```

- [ ] **Esperado**: `{ id: "<PROJECT_ID>", name: "Test", status: "IDEATION" }` (si la Note tiene Task con dueDate hoy) o `null` (si no).

---

### 4. Transiciones válidas: IDEATION → ACTIVE → MAINTENANCE → ARCHIVED

```bash
for status in ACTIVE MAINTENANCE ARCHIVED; do
  curl -X PATCH http://localhost:3000/api/projects/<PROJECT_ID> \
    -H "Content-Type: application/json" \
    -H "Cookie: sb-access-token=<TOKEN>" \
    -d "{\"status\":\"$status\"}"
done
```

- [ ] **Esperado**: cada paso devuelve 200 con `data.status` actualizado.

---

### 5. Transición inválida: ARCHIVED → MAINTENANCE

```bash
curl -X PATCH http://localhost:3000/api/projects/<PROJECT_ID> \
  -H "Content-Type: application/json" \
  -H "Cookie: sb-access-token=<TOKEN>" \
  -d '{"status":"MAINTENANCE"}'
```

- [ ] **Esperado**: 409 con:
  ```json
  {
    "ok": false,
    "error": {
      "code": "invalidTransition",
      "details": {
        "from": "ARCHIVED",
        "attempted": "MAINTENANCE",
        "allowedFromCurrent": ["ACTIVE", "IDEATION"]
      }
    }
  }
  ```

---

### 6. Revivir: ARCHIVED → ACTIVE

```bash
curl -X PATCH http://localhost:3000/api/projects/<PROJECT_ID> \
  -H "Content-Type: application/json" \
  -H "Cookie: sb-access-token=<TOKEN>" \
  -d '{"status":"ACTIVE"}'
```

- [ ] **Esperado**: 200 con `data.status: "ACTIVE"`.

---

### 7. Borrar proyecto → 204; verificar Note.projectId = null, Task intacto

```bash
# Borrar
curl -X DELETE http://localhost:3000/api/projects/<PROJECT_ID> \
  -H "Cookie: sb-access-token=<TOKEN>" -v

# Verificar en DB (psql o Supabase dashboard)
```

- [ ] **Esperado DELETE**: 204 No Content.
- [ ] **Esperado DB**: `SELECT "projectId" FROM "Note" WHERE id = '<NOTE_ID>'` → `NULL`.
- [ ] **Esperado DB**: `SELECT "id" FROM "Task" WHERE "noteId" = '<NOTE_ID>'` → existe (no borrado).

---

### 8. Buscar Note huérfana en /api/search

```bash
curl "http://localhost:3000/api/search?q=<PALABRA_CLAVE>" \
  -H "Cookie: sb-access-token=<TOKEN>" | jq '.data[] | select(.id == "<NOTE_ID>")'
```

- [ ] **Esperado**: la Note huérfana aparece en resultados (`project: null`).

---

### 9. Verificar embedding pgvector intacto (1536 dims)

```sql
SELECT vector_dims(embedding) AS dims FROM "Note" WHERE id = '<NOTE_ID>';
```

- [ ] **Esperado**: `dims = 1536`.

---

## Resultado

| # | Punto | Estado |
|---|-------|--------|
| 1 | Crear proyecto | [ ] |
| 2 | Asignar Note a proyecto | [ ] |
| 3 | Badge en dashboard | [ ] |
| 4 | Transiciones válidas | [ ] |
| 5 | Transición inválida → 409 | [ ] |
| 6 | Revivir ARCHIVED → ACTIVE | [ ] |
| 7 | DELETE proyecto → Note huérfana | [ ] |
| 8 | Buscar Note huérfana | [ ] |
| 9 | Embedding pgvector | [ ] |

**Total**: __ / 9

---

**Firma**: ______________  
**Fecha**: ____________
