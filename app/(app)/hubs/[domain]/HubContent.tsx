'use client'

import { useEffect, useState } from 'react'
import { HUBS, domainMeta } from '@/lib/hubs'

// ─── Types ───────────────────────────────────────────────────────────────────

type NoteStatus = 'DRAFT' | 'NEEDS_REVIEW' | 'ACTIVE' | 'IN_PROGRESS' | 'DONE'

interface NoteItem {
  id: string
  title: string
  content: string
  status: NoteStatus
  isImportant: boolean
  dueDate: string | null
  createdAt: string
  updatedAt: string
  domain: string
}

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

function statusBadge(status: NoteStatus): string {
  const map: Record<NoteStatus, string> = {
    DRAFT: 'Borrador',
    NEEDS_REVIEW: 'Revisión',
    ACTIVE: 'Activa',
    IN_PROGRESS: 'En curso',
    DONE: 'Hecha',
  }
  return map[status] ?? status
}

function domainEmoji(domain: string): string {
  const meta = domainMeta(domain as Parameters<typeof domainMeta>[0])
  return meta?.emoji ?? '📄'
}

function domainLabel(domain: string): string {
  const meta = domainMeta(domain as Parameters<typeof domainMeta>[0])
  return meta?.label ?? domain
}

// ─── Detail Panel ─────────────────────────────────────────────────────────────

function NotePanel({ note, onClose }: { note: NoteItem; onClose: () => void }) {
  return (
    <>
      <div
        className="fixed inset-0 z-50 bg-black/60"
        onClick={onClose}
      />
      <div className="fixed right-0 top-0 h-full z-50 w-full max-w-[480px] bg-[#0A0A0A] border-l border-[#1A1A1A] overflow-y-auto animate-slide-in-right">
        <div className="p-6">
          <div className="flex items-start justify-between mb-6">
            <div className="flex-1 min-w-0">
              <h2 className="font-serif text-2xl text-[#E3E2E2] leading-snug">
                {note.title || 'Sin título'}
              </h2>
              <p className="text-[10px] tracking-[0.15em] uppercase text-[#5A5A5A] mt-1">
                {domainEmoji(note.domain)} {domainLabel(note.domain)}
              </p>
            </div>
            <button
              onClick={onClose}
              className="ml-4 flex-shrink-0 text-[#5A5A5A] hover:text-[#A68966] transition-colors"
              aria-label="Cerrar"
            >
              <svg viewBox="0 0 16 16" className="w-4 h-4">
                <line x1="2" y1="2" x2="14" y2="14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                <line x1="14" y1="2" x2="2" y2="14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            </button>
          </div>

          <div className="flex items-center gap-3 mb-6 text-[11px] text-[#5A5A5A]">
            <span className="border border-[#A68966]/40 text-[#A68966] px-2 py-0.5 text-[10px] uppercase tracking-wider">
              {statusBadge(note.status)}
            </span>
            {note.dueDate && (
              <span>{new Date(note.dueDate).toLocaleDateString('es-AR')}</span>
            )}
            {note.isImportant && (
              <span className="text-[#A68966]">★ Importante</span>
            )}
          </div>

          <div className="prose prose-sm text-[#A1A1AA] font-sans leading-relaxed whitespace-pre-wrap">
            {note.content || <span className="italic text-[#5A5A5A]">Sin contenido.</span>}
          </div>

          <div className="mt-8 pt-4 border-t border-[#1A1A1A] text-[10px] text-[#5A5A5A]">
            <p>Creada {relativeTime(note.createdAt)}</p>
            <p className="mt-0.5">Actualizada {relativeTime(note.updatedAt)}</p>
          </div>
        </div>
      </div>
      <style>{`
        @keyframes slide-in-right {
          from { transform: translateX(100%); }
          to { transform: translateX(0); }
        }
        .animate-slide-in-right { animation: slide-in-right 200ms ease-out forwards }
      `}</style>
    </>
  )
}

// ─── Note Card ────────────────────────────────────────────────────────────────

function NoteCard({ note, onOpen }: { note: NoteItem; onOpen: (n: NoteItem) => void }) {
  return (
    <button
      onClick={() => onOpen(note)}
      className="w-full text-left border border-[#1A1A1A] bg-[#0A0A0A] px-5 py-4 hover:border-[#A68966]/30 transition-colors group"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <h3 className="font-serif text-[#E3E2E2] text-lg leading-snug group-hover:text-[#A68966]/80 transition-colors">
            {note.title || 'Sin título'}
          </h3>
          {note.content && (
            <p className="text-[#5A5A5A] text-xs mt-1 line-clamp-2 leading-relaxed">
              {note.content.replace(/\n/g, ' ')}
            </p>
          )}
        </div>
        <div className="flex-shrink-0 text-[#5A5A5A] group-hover:text-[#A68966] transition-colors mt-0.5">
          <svg viewBox="0 0 12 12" className="w-3 h-3">
            <polyline points="2,1 10,1 10,9" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
            <line x1="10" y1="1" x2="2" y2="9" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
          </svg>
        </div>
      </div>
      <div className="flex items-center gap-2 mt-3 text-[10px] text-[#5A5A5A]">
        <span className="text-[9px] uppercase tracking-wider border border-[#1A1A1A] px-1.5 py-0.5">
          {statusBadge(note.status)}
        </span>
        <span>Actualizada {relativeTime(note.updatedAt)}</span>
        {note.isImportant && <span className="text-[#A68966]">★</span>}
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

  const hub = HUBS.find((h) => h.slug === slug)

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch(`/api/hubs/${slug}`)
        if (!res.ok) throw new Error('Failed to load')
        const json = await res.json()
        setData(json)
      } catch {
        setError('No se pudieron cargar las notas.')
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [slug])

  if (loading) {
    return (
      <div className="space-y-4 animate-pulse">
        <div className="h-20 bg-[#1A1A1A] w-48 rounded" />
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-24 border border-[#1A1A1A] bg-[#0A0A0A]" />
          ))}
        </div>
      </div>
    )
  }

  if (error || !data) {
    return (
      <div className="border border-[#1A1A1A] bg-[#0A0A0A] px-4 py-3 text-sm text-[#E3E2E2]">
        {error ?? 'Error desconocido.'}
      </div>
    )
  }

  const { notes, relatedItems } = data

  return (
    <>
      {/* Editorial Header */}
      <div className="mb-8">
        <div className="flex items-center gap-4 mb-2">
          <span className="text-5xl leading-none">{hub?.emoji}</span>
          <h1 className="font-serif text-4xl text-[#E3E2E2]">{hub?.label}</h1>
        </div>
        <div className="h-px bg-gradient-to-r from-[#A68966]/60 via-[#A68966]/20 to-transparent mt-4 mb-3" />
        <p className="text-[11px] tracking-[0.15em] uppercase text-[#5A5A5A]">
          {notes.length === 0
            ? 'Sin notas'
            : `${notes.length} nota${notes.length !== 1 ? 's' : ''}`}
        </p>
      </div>

      {/* Notes list */}
      {notes.length === 0 ? (
        <p className="text-[#5A5A5A] text-sm italic mt-8">
          Sin notas en este dominio por ahora.
        </p>
      ) : (
        <div className="space-y-3">
          {notes.map((note) => (
            <NoteCard key={note.id} note={note} onOpen={setSelectedNote} />
          ))}
        </div>
      )}

      {/* Vínculos Externos — collapsible */}
      <div className="mt-12">
        <details className="group">
          <summary
            className="flex items-center justify-between cursor-pointer list-none text-[11px] tracking-[0.15em] uppercase text-[#5A5A5A] hover:text-[#A68966]/80 transition-colors select-none"
          >
            <span>Vínculos Externos</span>
            <div className="flex items-center gap-2">
              <span className="border border-[#1A1A1A] px-1.5 py-0.5 text-[10px]">
                {relatedItems.length}
              </span>
              <span className="group-open:rotate-180 transition-transform duration-200">
                <svg viewBox="0 0 12 12" className="w-3 h-3">
                  <polyline points="2,4 6,8 10,4" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </span>
            </div>
          </summary>

          <div className="mt-4">
            {relatedItems.length === 0 ? (
              <p className="text-[#5A5A5A] text-xs italic pl-1">
                Sin vínculos con otros dominios por ahora.
              </p>
            ) : (
              <div className="space-y-2">
                {relatedItems.map((item) => (
                  <button
                    key={item.id}
                    onClick={() => setSelectedNote(item)}
                    className="w-full text-left border border-[#1A1A1A] bg-[#0A0A0A] px-4 py-3 hover:border-[#A68966]/30 transition-colors group flex items-start gap-3"
                  >
                    <span className="flex-shrink-0 text-[10px] border border-[#A68966]/40 text-[#A68966] px-2 py-0.5 uppercase tracking-wider mt-0.5">
                      {domainEmoji(item.domain)} {domainLabel(item.domain)}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="text-[#E3E2E2] text-sm font-serif group-hover:text-[#A68966]/80 transition-colors truncate">
                        {item.title || 'Sin título'}
                      </p>
                      {item.content && (
                        <p className="text-[#5A5A5A] text-xs mt-0.5 line-clamp-1">
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

      {/* Detail panel */}
      {selectedNote && (
        <NotePanel note={selectedNote} onClose={() => setSelectedNote(null)} />
      )}
    </>
  )
}
