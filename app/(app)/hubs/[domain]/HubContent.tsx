'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { HUBS, domainMeta } from '@/lib/hubs'
import { HubIcon } from '@/components/icons'
import { NotePanel, type NoteItem, type NoteDraft } from '@/components/NotePanel'
import type { Domain } from '@prisma/client'

// ─── Types ───────────────────────────────────────────────────────────────────

// ─── Helpers ───────────────────────────────────────────────────────────────────

function relativeTime(dateStr: string): string {
  const date = new Date(dateStr)
  const now = new Date()
  const diffMs = date.getTime() - now.getTime()
  const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24))
  const rtf = new Intl.RelativeTimeFormat('es-AR', { numeric: 'auto' })
  if (Math.abs(diffDays) < 30) return rtf.format(diffDays, 'day')
  if (Math.abs(diffDays) < 365) return rtf.format(Math.round(diffDays / 30), 'month')
  return rtf.format(Math.round(diffDays / 365), 'year')
}

function domainIcon(domain: string): string | null {
  const meta = domainMeta(domain as Domain)
  return meta?.icon ?? null
}

function domainLabel(domain: string): string {
  const meta = domainMeta(domain as Domain)
  return meta?.label ?? domain
}

// ─── Note Card ────────────────────────────────────────────────────────────────

function NoteCard({ note, onOpen }: { note: NoteItem; onOpen: (n: NoteItem) => void }) {
  return (
    <button
      onClick={() => onOpen(note)}
      className="w-full text-left border border-border bg-surface px-5 py-4 hover:border-accent/30 transition-colors group"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <h3 className="font-serif text-fg text-lg leading-snug group-hover:text-accent/80 transition-colors">
            {note.title || 'Sin título'}
          </h3>
          {note.content && (
            <p className="text-fg-faint text-xs mt-1 line-clamp-2 leading-relaxed">
              {note.content.replace(/\n/g, ' ')}
            </p>
          )}
        </div>
        <div className="flex-shrink-0 text-fg-faint group-hover:text-accent transition-colors mt-0.5">
          <svg viewBox="0 0 12 12" className="w-3 h-3">
            <polyline points="2,1 10,1 10,9" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
            <line x1="10" y1="1" x2="2" y2="9" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
          </svg>
        </div>
      </div>
      <div className="flex items-center gap-2 mt-3 text-[10px] text-fg-faint">
        <span className="text-[9px] uppercase tracking-wider border border-border px-1.5 py-0.5">
          {note.noteStatus === 'DRAFT' ? 'Borrador' : note.noteStatus === 'NEEDS_REVIEW' ? 'Revisión' : 'Activa'}
        </span>
        <span>Actualizada {relativeTime(note.updatedAt)}</span>
        {note.hasTask && <span className="text-accent">⚡</span>}
      </div>
    </button>
  )
}

// ─── Hub Content ──────────────────────────────────────────────────────────────

interface HubData {
  notes: NoteItem[]
  relatedItems: NoteItem[]
}

export default function HubContent({ slug }: { slug: string }) {
  const [data, setData] = useState<HubData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedNote, setSelectedNote] = useState<NoteItem | null>(null)
  const [activeTag, setActiveTag] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)

  const hub = HUBS.find((h) => h.slug === slug)
  const hubDomain = hub?.enum ?? null

  const allTags = slug === 'espiritual'
    ? Array.from(new Set(data?.notes.flatMap((n) => n.tags ?? []) ?? [])).sort()
    : []

  const filteredNotes = activeTag
    ? (data?.notes.filter((n) => n.tags?.includes(activeTag)) ?? [])
    : (data?.notes ?? [])

  const load = async () => {
    try {
      const res = await fetch(`/api/hubs/${slug}`)
      if (!res.ok) throw new Error('Failed to load')
      const body = await res.json()
      const json = body.data ?? body
      setData(json)
    } catch {
      setError('No se pudieron cargar las notas.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [slug])

  if (loading) {
    return (
      <div className="space-y-4 animate-pulse">
        <div className="h-20 bg-fg-faint/30 w-48 rounded" />
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-24 border border-border bg-surface" />
          ))}
        </div>
      </div>
    )
  }

  if (error || !data) {
    return (
      <div className="border border-border bg-surface px-4 py-3 text-sm text-fg">
        {error ?? 'Error desconocido.'}
      </div>
    )
  }

  const { relatedItems } = data

  const createDraft: NoteDraft | null =
    hubDomain && hubDomain !== 'REGISTROS'
      ? { title: '', content: '', domain: hubDomain, status: 'ACTIVE' }
      : null

  return (
    <>
      <div className="mb-8">
        <div className="flex items-center gap-4 mb-2">
          {hub && <HubIcon icon={hub.icon} size={48} />}
          <h1 className="font-serif text-4xl text-fg">{hub?.label}</h1>
        </div>
        <div className="h-px bg-gradient-to-r from-accent/60 via-accent/20 to-transparent mt-4 mb-3" />
        <p className="text-[11px] tracking-[0.15em] uppercase text-fg-faint">
          {filteredNotes.length === 0
            ? 'Sin notas'
            : `${filteredNotes.length} nota${filteredNotes.length !== 1 ? 's' : ''}`}
        </p>
      </div>

      {slug === 'registros' && (
        <div className="space-y-3">
          <p className="text-fg-faint text-xs mb-4">
            Seleccioná un submódulo para acceder a su panel de control.
          </p>
          {[
            { href: '/hubs/registros/fuerza', label: 'Fuerza', desc: 'Entrenamientos, volumen y récords personales' },
            { href: '/hubs/registros/finanzas', label: 'Finanzas', desc: 'Ciclo de nómina, distribución de gastos y suscripciones' },
            { href: '/hubs/registros/habitos', label: 'Hábitos', desc: 'Seguimiento de hábitos y rutinas diarias' },
          ].map((item) => (
            <Link key={item.href} href={item.href}
              className="flex items-center justify-between border border-border bg-surface px-5 py-4 hover:border-accent/40 transition-colors group">
              <div>
                <h3 className="font-serif text-fg text-lg group-hover:text-accent/80 transition-colors">{item.label}</h3>
                <p className="text-fg-faint text-xs mt-0.5">{item.desc}</p>
              </div>
              <div className="text-fg-faint group-hover:text-accent transition-colors">
                <svg viewBox="0 0 12 12" className="w-3 h-3">
                  <polyline points="2,1 10,1 10,9" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
                  <line x1="10" y1="1" x2="2" y2="9" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
                </svg>
              </div>
            </Link>
          ))}
        </div>
      )}

      {slug !== 'registros' && (
        <div className="flex flex-wrap items-center gap-3 mb-6">
          {allTags.length > 0 && (
            <div className="flex flex-wrap gap-2">
              <button onClick={() => setActiveTag(null)}
                className={`text-[10px] uppercase tracking-wider px-3 py-1 border transition-colors ${
                  activeTag === null ? 'border-accent text-accent' : 'border-border text-fg-faint hover:border-accent/40'
                }`}>
                Todas
              </button>
              {allTags.map((tag) => (
                <button key={tag} onClick={() => setActiveTag(tag === activeTag ? null : tag)}
                  className={`text-[10px] uppercase tracking-wider px-3 py-1 border transition-colors ${
                    tag === activeTag ? 'border-accent text-accent' : 'border-border text-fg-faint hover:border-accent/40'
                  }`}>
                  {tag}
                </button>
              ))}
            </div>
          )}

          {createDraft && (
            <button onClick={() => setCreating(true)}
              className="ml-auto border border-accent/50 text-accent text-[10px] uppercase tracking-wider px-3 py-1 hover:bg-accent/10 transition-colors">
              + Nueva Nota
            </button>
          )}
        </div>
      )}

      {slug !== 'registros' && (filteredNotes.length === 0 ? (
        <p className="text-fg-faint text-sm italic mt-8">Sin notas en este dominio por ahora.</p>
      ) : (
        <div className="space-y-3">
          {filteredNotes.map((note) => (
            <NoteCard key={note.id} note={note} onOpen={setSelectedNote} />
          ))}
        </div>
      ))}

      <div className="mt-12">
        <details className="group">
          <summary className="flex items-center justify-between cursor-pointer list-none text-[11px] tracking-[0.15em] uppercase text-fg-faint hover:text-accent/80 transition-colors select-none">
            <span>Vínculos Externos</span>
            <div className="flex items-center gap-2">
              <span className="border border-border px-1.5 py-0.5 text-[10px]">{relatedItems.length}</span>
              <span className="group-open:rotate-180 transition-transform duration-200">
                <svg viewBox="0 0 12 12" className="w-3 h-3">
                  <polyline points="2,4 6,8 10,4" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </span>
            </div>
          </summary>
          <div className="mt-4">
            {relatedItems.length === 0 ? (
              <p className="text-fg-faint text-xs italic pl-1">Sin vínculos con otros dominios por ahora.</p>
            ) : (
              <div className="space-y-2">
                {relatedItems.map((item) => (
                  <button key={item.id} onClick={() => setSelectedNote(item)}
                    className="w-full text-left border border-border bg-surface px-4 py-3 hover:border-accent/30 transition-colors group flex items-start gap-3">
                    <span className="flex-shrink-0 text-[10px] border border-accent/40 text-accent px-2 py-0.5 uppercase tracking-wider mt-0.5 flex items-center gap-1">
                      {domainIcon(item.domain) && <HubIcon icon={domainIcon(item.domain)!} size={12} />}
                      {domainLabel(item.domain)}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="text-fg text-sm font-serif group-hover:text-accent/80 transition-colors truncate">
                        {item.title || 'Sin título'}
                      </p>
                      {item.content && (
                        <p className="text-fg-faint text-xs mt-0.5 line-clamp-1">
                          {item.content.replace(/\n/g, ' ')}
                        </p>
                      )}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </details>
      </div>

      {selectedNote && (
        <NotePanel note={selectedNote} onClose={() => setSelectedNote(null)}
          onUpdate={(updated) => setSelectedNote(updated)}
          onDelete={() => { setSelectedNote(null); load() }} />
      )}

      {creating && createDraft && (
        <NotePanel draft={createDraft} lockDomain onClose={() => setCreating(false)}
          onCreated={() => { setCreating(false); load() }} />
      )}
    </>
  )
}
