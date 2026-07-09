/**
 * Tests unitarios para lib/hubs.ts
 * Validan que los selects NO incluyan embedding ni campos legacy.
 */

import { describe, it, expect } from 'vitest'
import {
  HUBS,
  SUPPORTED_SLUGS,
  toDomainEnum,
  domainMeta,
  NOTE_SELECT_NEW,
  NOTE_SELECT_WITH_TASK_FLAG,
  TASK_SELECT,
  NOTE_SELECT_WITH_TASK,
} from '@/lib/hubs'

describe('lib/hubs.ts — constants', () => {
  it('HUBS tiene exactamente 5 dominios', () => {
    expect(HUBS).toHaveLength(5)
  })

  it('SUPPORTED_SLUGS contiene todos los slugs de HUBS', () => {
    const slugs = HUBS.map((h) => h.slug)
    expect(SUPPORTED_SLUGS).toEqual(slugs)
  })

  it('cada hub tiene slug, enum, icon y label', () => {
    for (const hub of HUBS) {
      expect(hub).toHaveProperty('slug')
      expect(hub).toHaveProperty('enum')
      expect(hub).toHaveProperty('icon')
      expect(hub).toHaveProperty('label')
      expect(typeof hub.slug).toBe('string')
      expect(typeof hub.enum).toBe('string')
      expect(typeof hub.icon).toBe('string')
      expect(typeof hub.label).toBe('string')
    }
  })
})

describe('lib/hubs.ts — toDomainEnum', () => {
  it('convierte slug "espiritual" → ESPIRITUAL', () => {
    expect(toDomainEnum('espiritual')).toBe('ESPIRITUAL')
  })

  it('convierte slug "personal" → PERSONAL', () => {
    expect(toDomainEnum('personal')).toBe('PERSONAL')
  })

  it('convierte slug "aprendizaje" → APRENDIZAJE', () => {
    expect(toDomainEnum('aprendizaje')).toBe('APRENDIZAJE')
  })

  it('convierte slug "proyectos" → PROYECTOS', () => {
    expect(toDomainEnum('proyectos')).toBe('PROYECTOS')
  })

  it('convierte slug "registros" → REGISTROS', () => {
    expect(toDomainEnum('registros')).toBe('REGISTROS')
  })

  it('slug inválido devuelve null', () => {
    expect(toDomainEnum('invalido')).toBeNull()
    expect(toDomainEnum('')).toBeNull()
  })

  it('slug con mayúsculas devuelve null (case-sensitive)', () => {
    expect(toDomainEnum('ESPIRITUAL')).toBeNull()
  })
})

describe('lib/hubs.ts — domainMeta', () => {
  it('ESPIRITUAL devuelve meta correcta', () => {
    expect(domainMeta('ESPIRITUAL')).toEqual({
      icon: 'espiritual',
      label: 'Espiritual',
      slug: 'espiritual',
    })
  })

  it('PROYECTOS devuelve meta correcta', () => {
    expect(domainMeta('PROYECTOS')).toEqual({
      icon: 'proyectos',
      label: 'Proyectos',
      slug: 'proyectos',
    })
  })

  it('dominio inválido devuelve null', () => {
    expect(domainMeta('INVALID' as any)).toBeNull()
  })
})

describe('lib/hubs.ts — NOTE_SELECT_NEW', () => {
  it('NO incluye embedding', () => {
    expect(NOTE_SELECT_NEW).not.toHaveProperty('embedding')
  })

  it('NO incluye campos legacy (status, dueDate, isImportant)', () => {
    expect(NOTE_SELECT_NEW).not.toHaveProperty('status')
    expect(NOTE_SELECT_NEW).not.toHaveProperty('dueDate')
    expect(NOTE_SELECT_NEW).not.toHaveProperty('isImportant')
  })

  it('incluye noteStatus (no el viejo status)', () => {
    expect(NOTE_SELECT_NEW).toHaveProperty('noteStatus')
    expect((NOTE_SELECT_NEW as any).noteStatus).toBe(true)
  })

  it('incluye campos base: id, userId, title, content, domain, tags', () => {
    expect((NOTE_SELECT_NEW as any).id).toBe(true)
    expect((NOTE_SELECT_NEW as any).userId).toBe(true)
    expect((NOTE_SELECT_NEW as any).title).toBe(true)
    expect((NOTE_SELECT_NEW as any).content).toBe(true)
    expect((NOTE_SELECT_NEW as any).domain).toBe(true)
    expect((NOTE_SELECT_NEW as any).tags).toBe(true)
    expect((NOTE_SELECT_NEW as any).suggestedGoals).toBe(true)
    expect((NOTE_SELECT_NEW as any).createdAt).toBe(true)
    expect((NOTE_SELECT_NEW as any).updatedAt).toBe(true)
  })

  it('NO incluye relación task', () => {
    expect(NOTE_SELECT_NEW).not.toHaveProperty('task')
  })
})

describe('lib/hubs.ts — NOTE_SELECT_WITH_TASK_FLAG', () => {
  it('NO incluye embedding', () => {
    expect(NOTE_SELECT_WITH_TASK_FLAG).not.toHaveProperty('embedding')
  })

  it('incluye task anidada con solo id (para hasTask)', () => {
    expect(NOTE_SELECT_WITH_TASK_FLAG).toHaveProperty('task')
    expect((NOTE_SELECT_WITH_TASK_FLAG as any).task).toEqual({
      select: { id: true },
    })
  })
})

describe('lib/hubs.ts — TASK_SELECT', () => {
  it('incluye todos los campos del modelo Task', () => {
    const fields = [
      'id', 'noteId', 'userId', 'status',
      'dueDate', 'isImportant', 'focusedAt',
      'completedAt', 'createdAt', 'updatedAt',
    ]
    for (const field of fields) {
      expect((TASK_SELECT as any)[field]).toBe(true)
    }
  })

  it('NO incluye embedding', () => {
    expect(TASK_SELECT).not.toHaveProperty('embedding')
  })

  it('NO incluye campos legacy de Note', () => {
    expect(TASK_SELECT).not.toHaveProperty('noteStatus')
  })

  it('tiene exactamente 10 campos', () => {
    expect(Object.keys(TASK_SELECT)).toHaveLength(10)
  })
})

describe('lib/hubs.ts — NOTE_SELECT_WITH_TASK', () => {
  it('incluye task anidada con TASK_SELECT completo', () => {
    expect(NOTE_SELECT_WITH_TASK).toHaveProperty('task')
    expect((NOTE_SELECT_WITH_TASK as any).task).toEqual({
      select: TASK_SELECT,
    })
  })

  it('NO incluye embedding', () => {
    expect(NOTE_SELECT_WITH_TASK).not.toHaveProperty('embedding')
  })
})
