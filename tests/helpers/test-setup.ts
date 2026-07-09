/**
 * Helpers compartidos para tests unitarios.
 * Datos de test y factories, SIN configurar mocks.
 * Cada test file configura sus propios mocks vía vi.mock() + vi.mocked().
 */

import { vi } from 'vitest'

// ─── Constantes de test ──────────────────────────────────────────────────

export const TEST_USER_ID = 'test-user-cuid-001'
export const TEST_TOKEN = 'mock-jwt-token-xyz'

// ─── Factories de datos ──────────────────────────────────────────────────

/** Factory de Task para respuestas mock. */
export function makeTask(overrides: Record<string, unknown> = {}) {
  const now = new Date()
  return {
    id: overrides.id ?? 'task-cuid-001',
    noteId: overrides.noteId ?? 'note-cuid-001',
    userId: overrides.userId ?? TEST_USER_ID,
    status: overrides.status ?? 'OPEN',
    dueDate: overrides.dueDate ?? null,
    isImportant: overrides.isImportant ?? false,
    focusedAt: overrides.focusedAt ?? null,
    completedAt: overrides.completedAt ?? null,
    createdAt: overrides.createdAt ?? now,
    updatedAt: overrides.updatedAt ?? now,
    ...overrides,
  }
}

/** Factory de Note para respuestas mock. */
export function makeNote(overrides: Record<string, unknown> = {}) {
  const now = new Date()
  return {
    id: overrides.id ?? 'note-cuid-001',
    userId: overrides.userId ?? TEST_USER_ID,
    title: overrides.title ?? 'Test Note',
    content: overrides.content ?? 'Test content',
    domain: overrides.domain ?? 'PROYECTOS',
    tags: overrides.tags ?? [],
    suggestedGoals: overrides.suggestedGoals ?? [],
    noteStatus: overrides.noteStatus ?? 'DRAFT',
    createdAt: overrides.createdAt ?? now,
    updatedAt: overrides.updatedAt ?? now,
    ...overrides,
  }
}

// ─── Helpers para Request/Response ───────────────────────────────────────

/** Crea un contexto params para route handlers (Next.js 15+). */
export function params(id: string): { params: Promise<{ id: string }> } {
  return { params: Promise.resolve({ id }) }
}

/** Extrae body JSON de una Response. */
export async function json(res: Response): Promise<any> {
  return res.json()
}

// ─── Helpers para mocks ──────────────────────────────────────────────────

/**
 * Configura el mock de cookies para simular auth válida.
 * Usar DENTRO de los tests, después de importar { cookies } from 'next/headers'.
 */
export function mockAuthCookie(cookiesFn: any, token = TEST_TOKEN) {
  vi.mocked(cookiesFn).mockResolvedValue({
    get: vi.fn().mockReturnValue({ value: token }),
  } as any)
}

/**
 * Configura el mock de cookies para simular usuario NO autenticado.
 */
export function mockNoAuthCookie(cookiesFn: any) {
  vi.mocked(cookiesFn).mockResolvedValue({
    get: vi.fn().mockReturnValue(undefined),
  } as any)
}

/**
 * Configura verifySession para devolver un usuario válido.
 */
export function mockValidSession(verifySessionFn: any) {
  vi.mocked(verifySessionFn).mockResolvedValue({ userId: TEST_USER_ID })
}

/**
 * Configura verifySession para devolver null (sesión inválida).
 */
export function mockInvalidSession(verifySessionFn: any) {
  vi.mocked(verifySessionFn).mockResolvedValue(null)
}
