// Lógica de Project — transiciones, validación, mappers y helpers.
// Cero estado, todo puro. Usado por endpoints /api/projects/* y validación de projectId en notes.

import { prisma } from '@/lib/prisma'
import { CUID_REGEX } from '@/lib/types/project'
import type { ProjectStatus } from '@prisma/client'
import type {
  ProjectItem,
  ProjectBrief,
  InvalidProjectIdFormatError,
  InvalidProjectIdNotFoundError,
  InvalidProjectIdForbiddenError,
  InvalidProjectIdError,
} from '@/lib/types/project'

// ─── DAG de transiciones ──────────────────────────────────────────────────

export const PROJECT_TRANSITIONS: Record<ProjectStatus, ProjectStatus[]> = {
  IDEATION:    ['ACTIVE', 'ARCHIVED'],
  ACTIVE:      ['MAINTENANCE', 'ARCHIVED', 'IDEATION'],
  MAINTENANCE: ['ACTIVE', 'ARCHIVED'],
  ARCHIVED:    ['ACTIVE', 'IDEATION'],
}

export function validateTransition(
  from: ProjectStatus,
  to: ProjectStatus
): { ok: true } | { ok: false; allowed: ProjectStatus[] } {
  if (from === to) return { ok: true }
  if (!PROJECT_TRANSITIONS[from]) return { ok: false, allowed: [] }
  if (PROJECT_TRANSITIONS[from].includes(to)) return { ok: true }
  return { ok: false, allowed: PROJECT_TRANSITIONS[from] }
}

// ─── Mappers ──────────────────────────────────────────────────────────────

export function formatProjectItem(p: {
  id: string; userId: string; name: string; description: string | null;
  status: ProjectStatus; createdAt: Date; updatedAt: Date;
}): ProjectItem {
  return {
    id: p.id,
    userId: p.userId,
    name: p.name,
    description: p.description,
    status: p.status,
    createdAt: p.createdAt instanceof Date ? p.createdAt.toISOString() : String(p.createdAt),
    updatedAt: p.updatedAt instanceof Date ? p.updatedAt.toISOString() : String(p.updatedAt),
  }
}

export function formatProjectBrief(
  p: { id: string; name: string; status: ProjectStatus | string } | null
): ProjectBrief | null {
  if (!p) return null
  return { id: p.id, name: p.name, status: p.status as ProjectStatus }
}

// ─── Ownership check ──────────────────────────────────────────────────────

export async function findOwnProjectOrThrow(
  projectId: string,
  userId: string
): Promise<{ id: string; userId: string; name: string; description: string | null; status: ProjectStatus; createdAt: Date; updatedAt: Date }> {
  if (!CUID_REGEX.test(projectId)) {
    const err: InvalidProjectIdFormatError = {
      code: 'invalid_projectId_format',
      message: 'El projectId no tiene formato válido (cuid esperado).',
      details: { projectId, expected: 'cuid' },
    }
    throw err
  }

  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { id: true, userId: true, name: true, description: true, status: true, createdAt: true, updatedAt: true },
  })

  if (!project) {
    const err: InvalidProjectIdNotFoundError = {
      code: 'invalid_projectId_not_found',
      message: 'El proyecto no existe.',
      details: { projectId },
    }
    throw err
  }

  if (project.userId !== userId) {
    const err: InvalidProjectIdForbiddenError = {
      code: 'invalid_projectId_forbidden',
      message: 'El proyecto no pertenece al usuario actual.',
      details: { projectId },
    }
    throw err
  }

  return project
}

// ─── Helpers de error Prisma ──────────────────────────────────────────────

export function buildInvalidProjectIdResponse(error: InvalidProjectIdError): { status: number; body: Record<string, unknown> } {
  return {
    status: 400,
    body: { ok: false, error: { ...error } },
  }
}

// ─── Logging ──────────────────────────────────────────────────────────────

export function logProjectEvent(event: string, ctx: Record<string, unknown>, level: 'log' | 'warn' | 'error' = 'log'): void {
  console[level](JSON.stringify({ event, ts: new Date().toISOString(), ...ctx }))
}

// ─── Mapeo de errores Prisma ─────────────────────────────────────────────

export function mapPrismaError(e: unknown): { status: number; error: { code: string; message: string } } {
  if (typeof e === 'object' && e !== null && 'code' in e) {
    const code = (e as { code: string }).code
    if (code === 'P2002') return { status: 409, error: { code: 'conflict', message: 'Recurso duplicado' } }
    if (code === 'P2003') return { status: 400, error: { code: 'fk_violation', message: 'Referencia inválida' } }
    if (code === 'P2025') return { status: 404, error: { code: 'not_found', message: 'Recurso no encontrado' } }
  }
  console.error('[projects] unexpected error:', e)
  return { status: 500, error: { code: 'internal', message: 'Error interno del servidor' } }
}
