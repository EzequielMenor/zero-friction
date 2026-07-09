/**
 * Test factories para crear Notes y Tasks en tests E2E.
 * Usa Prisma Client directo (no API routes).
 */

import { prisma } from '@/lib/prisma'
import type { Note, Task, Project, Domain } from '@prisma/client'
import type { ProjectStatus } from '@prisma/client'
import cuid from 'cuid'

const id = () => cuid()

export type NoteInput = {
  content?: string
  title?: string | null
  domain?: Domain
  noteStatus?: 'DRAFT' | 'NEEDS_REVIEW' | 'ACTIVE'
  tags?: string[]
  suggestedGoals?: string[]
  projectId?: string | null
}

export type TaskInput = {
  status?: 'OPEN' | 'DONE'
  dueDate?: Date | null
  isImportant?: boolean
  focusedAt?: Date | null
  completedAt?: Date | null
}

/**
 * Crear una Note (sin Task).
 */
export async function createNote(userId: string, input: NoteInput = {}): Promise<Note> {
  return prisma.note.create({
    data: {
      id: id(),
      userId,
      content: input.content ?? 'Test content',
      title: input.title ?? '',
      domain: input.domain ?? 'PERSONAL',
      noteStatus: input.noteStatus ?? 'DRAFT',
      tags: input.tags ?? [],
      suggestedGoals: input.suggestedGoals ?? [],
      ...(input.projectId !== undefined ? { projectId: input.projectId } : {}),
    },
  })
}

/**
 * Crear una Note con Task asociada en una transacción.
 */
export async function createNoteWithTask(
  userId: string,
  noteInput: NoteInput = {},
  taskInput: TaskInput = {}
): Promise<{ note: Note; task: Task }> {
  return prisma.$transaction(async (tx) => {
    const note = await tx.note.create({
      data: {
        id: id(), userId,
        content: noteInput.content ?? 'Test content',
        title: noteInput.title ?? '',
        domain: noteInput.domain ?? 'PROYECTOS',
        noteStatus: noteInput.noteStatus ?? 'ACTIVE',
        tags: noteInput.tags ?? [],
        suggestedGoals: noteInput.suggestedGoals ?? [],
        ...(noteInput.projectId !== undefined ? { projectId: noteInput.projectId } : {}),
      },
    })
    const task = await tx.task.create({
      data: {
        id: id(),
        noteId: note.id,
        userId,
        status: taskInput.status ?? 'OPEN',
        dueDate: taskInput.dueDate ?? null,
        isImportant: taskInput.isImportant ?? false,
        focusedAt: taskInput.focusedAt ?? null,
        completedAt: taskInput.completedAt ?? null,
      },
    })
    return { note, task }
  })
}

/**
 * Crear Note + Task con focusedAt = now().
 */
export async function createFocusedTask(
  userId: string,
  input: NoteInput = {}
): Promise<{ note: Note; task: Task }> {
  return createNoteWithTask(userId, input, { focusedAt: new Date() })
}

/**
 * Crear Note + Task con status = DONE y completedAt = now().
 */
export async function createCompletedTask(
  userId: string,
  input: NoteInput = {}
): Promise<{ note: Note; task: Task }> {
  return createNoteWithTask(userId, input, { status: 'DONE', completedAt: new Date() })
}

export type ProjectInput = {
  name?: string
  description?: string | null
  status?: ProjectStatus
}

/**
 * Crear un Project.
 */
export async function createProject(userId: string, input: ProjectInput = {}): Promise<Project> {
  return prisma.project.create({
    data: {
      id: id(),
      userId,
      name: input.name ?? 'Test Project',
      description: input.description ?? null,
      status: input.status ?? 'IDEATION',
    },
  })
}

/**
 * Limpiar todos los datos de test de un usuario.
 */
export async function cleanupTestData(userId: string): Promise<void> {
  await prisma.task.deleteMany({ where: { userId } })
  await prisma.note.deleteMany({ where: { userId } })
  await prisma.project.deleteMany({ where: { userId } })
}
