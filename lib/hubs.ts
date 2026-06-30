// Shared hub constants — single source of truth for domain slug ↔ enum mapping.
// Used by NavMenu, the hubs API route, and the hub pages.

import type { Domain } from '@prisma/client'

export const HUBS = [
  { slug: 'espiritual', enum: 'ESPIRITUAL' as Domain, emoji: '📖', label: 'Espiritual' },
  { slug: 'personal',   enum: 'PERSONAL' as Domain,   emoji: '🧠', label: 'Personal'   },
  { slug: 'aprendizaje',enum: 'APRENDIZAJE' as Domain,emoji: '📚', label: 'Aprendizaje'},
  { slug: 'proyectos',  enum: 'PROYECTOS' as Domain, emoji: '💻', label: 'Proyectos'  },
  { slug: 'registros',  enum: 'REGISTROS' as Domain, emoji: '📊', label: 'Registros'  },
] as const

export const SUPPORTED_SLUGS = HUBS.map((h) => h.slug)

export function toDomainEnum(slug: string): Domain | null {
  const hub = HUBS.find((h) => h.slug === slug)
  return hub?.enum ?? null
}

export function domainMeta(domain: Domain) {
  const hub = HUBS.find((h) => h.enum === domain)
  if (!hub) return null
  return { emoji: hub.emoji, label: hub.label, slug: hub.slug }
}

export const NOTE_SELECT = {
  id: true,
  title: true,
  content: true,
  status: true,
  isImportant: true,
  dueDate: true,
  createdAt: true,
  updatedAt: true,
} as const
