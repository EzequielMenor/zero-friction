/**
 * Tests unitarios para POST /api/tasks/[id]/focus
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { cookies } from 'next/headers'
import { verifySession } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { POST } from '@/app/api/tasks/[id]/focus/route'
import {
  params, json, makeTask,
  mockAuthCookie, mockNoAuthCookie,
  mockValidSession, mockInvalidSession,
  TEST_USER_ID,
} from '../helpers/test-setup'

// ─── Mocks ───────────────────────────────────────────────────────────────

vi.mock('next/headers', () => ({ cookies: vi.fn() }))
vi.mock('@/lib/auth', () => ({
  verifySession: vi.fn(),
  signSession: vi.fn(),
  hashPassword: vi.fn(),
  verifyPassword: vi.fn(),
  AUTH_COOKIE: 'auth_token',
  cookieOptions: vi.fn(),
}))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    task: {
      updateMany: vi.fn(),
      findUnique: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}))

describe('POST /api/tasks/[id]/focus', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // ── Auth ───────────────────────────────────────────────────────────────

  it('devuelve 401 si no hay cookie de auth', async () => {
    mockNoAuthCookie(cookies)
    const res = await POST({} as any, params('task-001'))
    expect(res.status).toBe(401)
    const body = await json(res)
    expect(body.error.code).toBe('unauthenticated')
  })

  it('devuelve 401 si el token es inválido', async () => {
    mockAuthCookie(cookies)
    mockInvalidSession(verifySession)
    const res = await POST({} as any, params('task-001'))
    expect(res.status).toBe(401)
  })

  // ── Happy path ─────────────────────────────────────────────────────────

  it('desenfoca todas las Tasks del usuario y enfoca la nueva (200)', async () => {
    mockAuthCookie(cookies)
    mockValidSession(verifySession)

    // Mock de la transacción (array de operaciones)
    vi.mocked(prisma.$transaction).mockImplementation(async (ops: any[]) => {
      return [{ count: 1 }, { count: 1 }]
    })

    const focusedTask = makeTask({
      id: 'task-001',
      focusedAt: new Date('2026-07-08T12:00:00Z'),
    })
    vi.mocked(prisma.task.findUnique).mockResolvedValue(focusedTask as any)

    const res = await POST({} as any, params('task-001'))
    expect(res.status).toBe(200)

    const body = await json(res)
    expect(body.ok).toBe(true)
    expect(body.data.focusedAt).toBe('2026-07-08T12:00:00.000Z')
    expect(body.data.id).toBe('task-001')
  })

  // ── Task DONE → 409 not_open ───────────────────────────────────────────

  it('devuelve 409 si la Task está DONE (focusedAt queda null)', async () => {
    mockAuthCookie(cookies)
    mockValidSession(verifySession)

    vi.mocked(prisma.$transaction).mockImplementation(async (ops: any[]) => {
      return [{ count: 1 }, { count: 0 }]
    })
    vi.mocked(prisma.task.findUnique).mockResolvedValue(makeTask({
      id: 'task-001', status: 'DONE', focusedAt: null,
    }) as any)

    const res = await POST({} as any, params('task-001'))
    expect(res.status).toBe(409)

    const body = await json(res)
    expect(body.error.code).toBe('not_open')
  })

  // ── Race condition P2002 → 409 focus_race ──────────────────────────────

  it('devuelve 409 focus_race si ocurre P2002 (partial unique index)', async () => {
    mockAuthCookie(cookies)
    mockValidSession(verifySession)

    const p2002 = new Error('Unique violation') as any
    p2002.code = 'P2002'
    vi.mocked(prisma.$transaction).mockRejectedValue(p2002)

    const res = await POST({} as any, params('task-002'))
    expect(res.status).toBe(409)

    const body = await json(res)
    expect(body.error.code).toBe('focus_race')
  })

  // ── Task no existe → 409 ───────────────────────────────────────────────

  it('devuelve 409 si la Task no existe', async () => {
    mockAuthCookie(cookies)
    mockValidSession(verifySession)

    vi.mocked(prisma.$transaction).mockResolvedValue([{ count: 1 }, { count: 0 }])
    vi.mocked(prisma.task.findUnique).mockResolvedValue(null)

    const res = await POST({} as any, params('nonexistent'))
    expect(res.status).toBe(409)
  })
})
