'use client'

import { useState } from 'react'
import { HubIcon } from '@/components/icons'

// ─── Types ───────────────────────────────────────────────────────────────────

type NoteStatus = 'DRAFT' | 'NEEDS_REVIEW' | 'ACTIVE' | 'IN_PROGRESS' | 'DONE'

export interface NoteItem {
  id: string
  title: string
  content: string
  status: NoteStatus
  isImportant: boolean
  dueDate: string | null
  createdAt: string
  updatedAt: string
  domain: string
  tags?: string[]
  suggestedGoals?: string[]
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

function domainMeta(domain: string): { icon: string; label: string } | null {
  const map: Record<string, { icon: string; label: string }> = {
    ESPIRITUAL: { icon: 'espiritual', label: 'Espiritual' },
    PERSONAL: { icon: 'personal', label: 'Personal' },
    APRENDIZAJE: { icon: 'aprendizaje', label: 'Aprendizaje' },
    PROYECTOS: { icon: 'proyectos', label: 'Proyectos' },
    REGISTROS: { icon: 'registros', label: 'Registros' },
  }
  return map[domain] ?? null
}

// ─── Suggested Goal Button ─────────────────────────────────────────────────────

function SuggestedGoalButton({ noteId, goal }: { noteId: string; goal: string }) {
  const [accepted, setAccepted] = useState(false)

  async function handleAccept() {
    if (accepted) return
    try {
      const res = await fetch(`/api/notes/${noteId}/accept-goal`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ goalText: goal }),
      })
      if (res.ok) {
        setAccepted(true)
      }
    } catch {
      // noop
    }
  }

  return (
    <div className="flex items-start gap-2">
      <span className="text-[#5A5A5A] text-xs flex-1 leading-relaxed">{goal}</span>
      <button
        onClick={handleAccept}
        disabled={accepted}
        className={`flex-shrink-0 text-[10px] uppercase tracking-wider px-2 py-1 border transition-colors ${
          accepted
            ? 'border-[#A68966]/20 text-[#A68966]/30 cursor-default'
            : 'border-[#A68966]/40 text-[#A68966] hover:bg-[#A68966]/10'
        }`}
      >
        {accepted ? 'Aceptada' : 'Aceptar como Meta'}
      </button>
    </div>
  )
}

// ─── Note Panel ───────────────────────────────────────────────────────────────

export function NotePanel({ note, onClose }: { note: NoteItem; onClose: () => void }) {
  const meta = domainMeta(note.domain)

  return (
    <>
      <div
        className="fixed inset-0 z-50 bg-graphite/60"
        onClick={onClose}
      />
      <div className="fixed right-0 top-0 h-full z-50 w-full max-w-[480px] bg-graphite-card border-l border-graphite-border overflow-y-auto animate-slide-in-right">
        <div className="p-6">
          <div className="flex items-start justify-between mb-6">
            <div className="flex-1 min-w-0">
              <h2 className="font-serif text-2xl text-[#E3E2E2] leading-snug">
                {note.title || 'Sin título'}
              </h2>
              <p className="text-[10px] tracking-[0.15em] uppercase text-[#5A5A5A] mt-1 flex items-center gap-1">
                {meta && <HubIcon icon={meta.icon} size={12} />}
                {meta?.label ?? note.domain}
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

          {/* Tags */}
          {note.tags && note.tags.length > 0 && (
            <div className="flex flex-wrap gap-2 mt-4">
              {note.tags.map((tag) => (
                <span
                  key={tag}
                  className="text-[10px] uppercase tracking-wider border border-[#A68966]/30 text-[#A68966] px-2 py-0.5"
                >
                  {tag}
                </span>
              ))}
            </div>
          )}

          {/* Suggested Goals — only for espiritual notes */}
          {note.domain === 'ESPIRITUAL' && note.suggestedGoals && note.suggestedGoals.length > 0 && (
            <div className="mt-6 pt-4 border-t border-graphite-border">
              <p className="text-[10px] tracking-[0.15em] uppercase text-[#A68966] mb-3">
                Metas sugeridas por IA
              </p>
              <div className="space-y-2">
                {note.suggestedGoals.map((goal, i) => (
                  <SuggestedGoalButton key={i} noteId={note.id} goal={goal} />
                ))}
              </div>
            </div>
          )}

          <div className="mt-8 pt-4 border-t border-graphite-border text-[10px] text-[#5A5A5A]">
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
