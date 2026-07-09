// Shared hub constants — single source of truth for domain slug ↔ enum mapping.
// Used by NavMenu, the hubs API route, and the hub pages.

import type { Domain } from '@prisma/client'

export const HUBS = [
  { slug: 'espiritual', enum: 'ESPIRITUAL' as Domain, icon: 'espiritual',  label: 'Espiritual' },
  { slug: 'personal',   enum: 'PERSONAL' as Domain,   icon: 'personal',    label: 'Personal'   },
  { slug: 'aprendizaje',enum: 'APRENDIZAJE' as Domain, icon: 'aprendizaje', label: 'Aprendizaje'},
  { slug: 'proyectos',  enum: 'PROYECTOS' as Domain,  icon: 'proyectos',   label: 'Proyectos'  },
  { slug: 'registros',  enum: 'REGISTROS' as Domain,  icon: 'registros',   label: 'Registros'  },
] as const

export const SUPPORTED_SLUGS = HUBS.map((h) => h.slug)

export function toDomainEnum(slug: string): Domain | null {
  const hub = HUBS.find((h) => h.slug === slug)
  return hub?.enum ?? null
}

export function domainMeta(domain: Domain) {
  const hub = HUBS.find((h) => h.enum === domain)
  if (!hub) return null
  return { icon: hub.icon, label: hub.label, slug: hub.slug }
}

// ─── Nuevos selects (post-split) ───────────────────────────────────────────

/** Select para Note sin campos de Task (para hubs, search, etc.). */
export const NOTE_SELECT_NEW = {
  id: true,
  userId: true,
  title: true,
  content: true,
  domain: true,
  tags: true,
  suggestedGoals: true,
  noteStatus: true,
  createdAt: true,
  updatedAt: true,
} as const

/** Select para Note con flag hasTask (include ligero de Task). */
export const NOTE_SELECT_WITH_TASK_FLAG = {
  id: true,
  userId: true,
  title: true,
  content: true,
  domain: true,
  tags: true,
  suggestedGoals: true,
  noteStatus: true,
  createdAt: true,
  updatedAt: true,
  task: { select: { id: true } },
} as const

/** Select para Task. */
export const TASK_SELECT = {
  id: true,
  noteId: true,
  userId: true,
  status: true,
  dueDate: true,
  isImportant: true,
  focusedAt: true,
  completedAt: true,
  createdAt: true,
  updatedAt: true,
} as const

/** Select para Note con Task incluida (para dashboard TodayItem). */
export const NOTE_SELECT_WITH_TASK = {
  ...NOTE_SELECT_NEW,
  task: { select: TASK_SELECT },
} as const
