// Tipos para Note — fuente única de shapes Note en UI/API.

import type { Note } from '@prisma/client'
// Después de Migration B, NoteStatus será el enum de 3 valores (DRAFT | NEEDS_REVIEW | ACTIVE).
// Durante la ventana pre-migration, usar el tipo del schema directamente.
import type { NoteStatus } from '@prisma/client'

export type { Note, NoteStatus }

/** Shape de Note en responses de API (sin campos de Task). */
export interface NoteItem {
  id: string
  userId: string
  title: string
  content: string
  domain: string
  tags: string[]
  suggestedGoals: string[]
  noteStatus: 'DRAFT' | 'NEEDS_REVIEW' | 'ACTIVE'
  hasTask: boolean
  projectId?: string // NUEVO Phase 3
  project?: ProjectBrief | null
  createdAt: string
  updatedAt: string
}

/** Datos para crear una Note desde el frontend. */
export interface NoteDraft {
  mode: 'text' | 'structured'
  content: string
  title?: string
  domain?: string
  tags?: string[]
}

/** Note que incluye su Task asociada (si existe).
 *  project puede ser null por: (1) nunca tuvo proyecto, (2) perdió proyecto por cascade de un Project borrado. */
export interface NoteWithTask extends NoteItem {
  task: TaskItem | null
  project?: ProjectBrief | null
}

/** Resultado de búsqueda (usado por CaptureOverlay). */
export interface SearchResultItem extends NoteItem {
  task: Pick<TaskItem, 'id' | 'isImportant' | 'dueDate' | 'status'> | null
  project?: ProjectBrief | null
}

import type { TaskItem } from './task'
import type { ProjectBrief } from './project'
