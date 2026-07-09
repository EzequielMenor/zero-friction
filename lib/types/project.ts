// Tipos para Project — fuente única de shapes Project en UI/API.

import type { ProjectStatus } from '@prisma/client'
export { type ProjectStatus }

/** Regex para validar formato cuid generado por Prisma. */
export const CUID_REGEX = /^c[a-z0-9]{20,30}$/i

/** Brief: lo que se embebe en items compuestos (Task, Note). */
export interface ProjectBrief {
  id: string
  name: string
  status: ProjectStatus
}

/** Full: shape completo de Project. */
export interface ProjectItem {
  id: string
  userId: string
  name: string
  description: string | null
  status: ProjectStatus
  createdAt: string // ISO
  updatedAt: string // ISO
}

/** Detalle con contadores. */
export interface ProjectDetail extends ProjectItem {
  notesCount: number
  openTasksCount: number
}

/** Input para crear Project. */
export interface CreateProjectInput {
  name: string
  description?: string
  status?: ProjectStatus // default IDEATION
}

/** Input para actualizar Project. */
export interface UpdateProjectInput {
  name?: string
  description?: string | null // null explícito para borrar
  status?: ProjectStatus
}

// ─── Errores ─────────────────────────────────────────────────────────────

/** Error para transiciones inválidas (409). */
export interface ProjectTransitionError {
  code: 'invalidTransition'
  message: string
  details: {
    from: ProjectStatus
    attempted: ProjectStatus
    allowedFromCurrent: ProjectStatus[]
  }
}

/** Error: formato cuid inválido (regex falla). */
export interface InvalidProjectIdFormatError {
  code: 'invalid_projectId_format'
  message: string
  details: { projectId: string; expected: string }
}

/** Error: cuid válido pero no existe Project. */
export interface InvalidProjectIdNotFoundError {
  code: 'invalid_projectId_not_found'
  message: string
  details: { projectId: string }
}

/** Error: cuid válido, Project existe pero userId distinto. */
export interface InvalidProjectIdForbiddenError {
  code: 'invalid_projectId_forbidden'
  message: string
  details: { projectId: string }
}

/** Discriminated union para errores de projectId en Note. */
export type InvalidProjectIdError =
  | InvalidProjectIdFormatError
  | InvalidProjectIdNotFoundError
  | InvalidProjectIdForbiddenError
