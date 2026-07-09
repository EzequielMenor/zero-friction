// Tipos para Task — fuente única de shapes Task en UI/API.

import type { Task, TaskStatus } from '@prisma/client'

export type { Task, TaskStatus }

/** Shape de Task en responses de API. */
export interface TaskItem {
  id: string
  noteId: string
  userId: string
  status: 'OPEN' | 'DONE'
  dueDate: string | null
  isImportant: boolean
  focusedAt: string | null
  completedAt: string | null
  createdAt: string
  updatedAt: string
}

/** Task que incluye su Note asociada. */
export interface TaskWithNote extends TaskItem {
  note: NoteItem
}

/** Datos para crear o actualizar una Task. */
export interface TaskDraft {
  noteId: string
  dueDate?: string | null
  isImportant?: boolean
}

import type { NoteItem } from './note'
