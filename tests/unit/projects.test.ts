/**
 * Tests unitarios para lib/projects.ts — validación de transiciones, mappers y helpers.
 */

import { describe, it, expect, vi } from 'vitest'
import {
  validateTransition,
  formatProjectItem,
  formatProjectBrief,
} from '@/lib/projects'

vi.mock('@/lib/prisma', () => ({ prisma: { project: { findUnique: vi.fn() } } }))

// ─── validateTransition ──────────────────────────────────────────────────

describe('validateTransition', () => {
  // Válidas
  it('IDEATION → ACTIVE → ok', () => {
    expect(validateTransition('IDEATION', 'ACTIVE')).toEqual({ ok: true })
  })
  it('IDEATION → ARCHIVED → ok', () => {
    expect(validateTransition('IDEATION', 'ARCHIVED')).toEqual({ ok: true })
  })
  it('ACTIVE → MAINTENANCE → ok', () => {
    expect(validateTransition('ACTIVE', 'MAINTENANCE')).toEqual({ ok: true })
  })
  it('ACTIVE → ARCHIVED → ok', () => {
    expect(validateTransition('ACTIVE', 'ARCHIVED')).toEqual({ ok: true })
  })
  it('ACTIVE → IDEATION → ok (pivot duro)', () => {
    expect(validateTransition('ACTIVE', 'IDEATION')).toEqual({ ok: true })
  })
  it('MAINTENANCE → ACTIVE → ok', () => {
    expect(validateTransition('MAINTENANCE', 'ACTIVE')).toEqual({ ok: true })
  })
  it('MAINTENANCE → ARCHIVED → ok', () => {
    expect(validateTransition('MAINTENANCE', 'ARCHIVED')).toEqual({ ok: true })
  })
  it('ARCHIVED → ACTIVE → ok (revive)', () => {
    expect(validateTransition('ARCHIVED', 'ACTIVE')).toEqual({ ok: true })
  })
  it('ARCHIVED → IDEATION → ok (revive)', () => {
    expect(validateTransition('ARCHIVED', 'IDEATION')).toEqual({ ok: true })
  })

  // Inválidas
  it('IDEATION → MAINTENANCE → blocked', () => {
    const r = validateTransition('IDEATION', 'MAINTENANCE')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.allowed).toEqual(['ACTIVE', 'ARCHIVED'])
  })
  it('MAINTENANCE → IDEATION → blocked', () => {
    const r = validateTransition('MAINTENANCE', 'IDEATION')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.allowed).toEqual(['ACTIVE', 'ARCHIVED'])
  })
  it('ARCHIVED → MAINTENANCE → blocked', () => {
    const r = validateTransition('ARCHIVED', 'MAINTENANCE')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.allowed).toEqual(['ACTIVE', 'IDEATION'])
  })

  // Self transitions (idempotente)
  it('IDEATION → IDEATION → ok (idempotente)', () => {
    expect(validateTransition('IDEATION', 'IDEATION')).toEqual({ ok: true })
  })
  it('ACTIVE → ACTIVE → ok (idempotente)', () => {
    expect(validateTransition('ACTIVE', 'ACTIVE')).toEqual({ ok: true })
  })
  it('MAINTENANCE → MAINTENANCE → ok (idempotente)', () => {
    expect(validateTransition('MAINTENANCE', 'MAINTENANCE')).toEqual({ ok: true })
  })
  it('ARCHIVED → ARCHIVED → ok (idempotente)', () => {
    expect(validateTransition('ARCHIVED', 'ARCHIVED')).toEqual({ ok: true })
  })

  // Estado desconocido
  it('estado desconocido → blocked', () => {
    const result = validateTransition('UNKNOWN' as never, 'ACTIVE')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.allowed).toEqual([])
  })
})

// ─── formatProjectItem ────────────────────────────────────────────────────

describe('formatProjectItem', () => {
  it('convierte fechas a ISO string', () => {
    const d1 = new Date('2026-01-01T00:00:00Z')
    const d2 = new Date('2026-06-01T12:00:00Z')
    const result = formatProjectItem({
      id: 'c123', userId: 'u1', name: 'Test', description: 'desc',
      status: 'ACTIVE', createdAt: d1, updatedAt: d2,
    })
    expect(result.id).toBe('c123')
    expect(result.name).toBe('Test')
    expect(result.description).toBe('desc')
    expect(result.status).toBe('ACTIVE')
    expect(result.createdAt).toBe(d1.toISOString())
    expect(result.updatedAt).toBe(d2.toISOString())
  })

  it('maneja fechas ya string (defensa)', () => {
    const result = formatProjectItem({
      id: 'c2', userId: 'u1', name: 'X', description: null,
      status: 'IDEATION', createdAt: '2026-01-01T00:00:00Z' as unknown as Date, updatedAt: new Date(),
    })
    expect(result.createdAt).toBe('2026-01-01T00:00:00Z')
  })
})

// ─── formatProjectBrief ───────────────────────────────────────────────────

describe('formatProjectBrief', () => {
  it('null → null', () => {
    expect(formatProjectBrief(null)).toBeNull()
  })

  it('Project → {id, name, status}', () => {
    const result = formatProjectBrief({ id: 'c1', name: 'P1', status: 'ACTIVE' })
    expect(result).toEqual({ id: 'c1', name: 'P1', status: 'ACTIVE' })
  })
})
