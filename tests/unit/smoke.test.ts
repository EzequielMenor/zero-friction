import { describe, it, expect, vi } from 'vitest'

// Mock @/lib/prisma ANTES de cualquier import que lo use
vi.mock('@/lib/prisma', () => ({
  prisma: {
    note: {
      create: vi.fn(),
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      deleteMany: vi.fn(),
      delete: vi.fn(),
      count: vi.fn(),
    },
    task: {
      create: vi.fn(),
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
      updateMany: vi.fn(),
      deleteMany: vi.fn(),
      count: vi.fn(),
    },
    $transaction: vi.fn(),
    $executeRaw: vi.fn(),
    $executeRawUnsafe: vi.fn(),
    $queryRaw: vi.fn(),
    habit: {
      findMany: vi.fn(),
      create: vi.fn(),
    },
    habitLog: {
      findMany: vi.fn(),
      create: vi.fn(),
    },
    noteRelationship: {
      create: vi.fn(),
      upsert: vi.fn(),
    },
    account: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
    },
    transaction: {
      create: vi.fn(),
      findMany: vi.fn(),
    },
    subscription: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
    },
    user: {
      findUnique: vi.fn(),
      create: vi.fn(),
      delete: vi.fn(),
      update: vi.fn(),
    },
  },
}))

// Mock next/headers
vi.mock('next/headers', () => ({
  cookies: vi.fn(),
}))

// Mock @/lib/auth
vi.mock('@/lib/auth', () => ({
  verifySession: vi.fn(),
  signSession: vi.fn(),
  hashPassword: vi.fn(),
  verifyPassword: vi.fn(),
  AUTH_COOKIE: 'auth_token',
  cookieOptions: vi.fn(),
}))

describe('smoke — vitest + mocks funcionan', () => {
  it('resuelve alias @/lib/prisma mockeado', async () => {
    const { prisma } = await import('@/lib/prisma')
    expect(prisma).toBeDefined()
    expect(prisma.note).toBeDefined()
    expect(prisma.task).toBeDefined()
  })

  it('resuelve alias @/lib/hubs', async () => {
    const { HUBS, NOTE_SELECT_NEW, TASK_SELECT, toDomainEnum, domainMeta } = await import('@/lib/hubs')
    expect(HUBS).toHaveLength(5)
    expect(NOTE_SELECT_NEW).toBeDefined()
    expect(TASK_SELECT).toBeDefined()
    expect(toDomainEnum('espiritual')).toBe('ESPIRITUAL')
    expect(toDomainEnum('invalido')).toBeNull()
    expect(domainMeta('ESPIRITUAL')).toEqual({ icon: 'espiritual', label: 'Espiritual', slug: 'espiritual' })
    expect(domainMeta('INVALID' as any)).toBeNull()
  })

  it('resuelve alias @/lib/types/*', async () => {
    // Verificar que los tipos existen (compile-time check, runtime smoke)
    const mod = await import('@/lib/types/api')
    expect(mod).toBeDefined()
  })
})
