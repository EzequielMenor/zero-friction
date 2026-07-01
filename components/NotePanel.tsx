'use client'

import { useState } from 'react'
import { HubIcon } from '@/components/icons'

// ─── Types ───────────────────────────────────────────────────────────────────

type NoteStatus = 'DRAFT' | 'NEEDS_REVIEW' | 'ACTIVE' | 'IN_PROGRESS' | 'DONE'
type NoteDomain = 'ESPIRITUAL' | 'PERSONAL' | 'APRENDIZAJE' | 'PROYECTOS' | 'REGISTROS'

export interface NoteItem {
  id: string
  title: string
  content: string
  status: NoteStatus
  isImportant: boolean
  dueDate: string | null
  createdAt: string
  updatedAt: string
  domain: NoteDomain
  tags?: string[]
  suggestedGoals?: string[]
}

export interface NoteDraft {
  title: string
  content: string
  domain: NoteDomain
  status: NoteStatus
}

interface NotePanelProps {
  /** Provide either an existing `note` (edit/view mode) or a `draft` (create mode). */
  note?: NoteItem
  draft?: NoteDraft
  /** When true, lock the domain selector to the provided value (used by HubContent create flow). */
  lockDomain?: boolean
  /** Called after a successful save (PATCH) or create (POST). */
  onClose: () => void
  onUpdate?: (saved: NoteItem) => void
  onCreated?: (saved: NoteItem) => void
  onDelete?: (id: string) => void
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

export function NotePanel({
  note,
  draft,
  lockDomain = false,
  onClose,
  onUpdate,
  onCreated,
  onDelete,
}: NotePanelProps) {
  const isCreateMode = !note && !!draft

  // Local form state for edit/create flows
  const [title, setTitle] = useState(draft?.title ?? note?.title ?? '')
  const [content, setContent] = useState(draft?.content ?? note?.content ?? '')
  const [domain, setDomain] = useState<NoteDomain>(draft?.domain ?? note?.domain ?? 'PERSONAL')
  const [status, setStatus] = useState<NoteStatus>(draft?.status ?? note?.status ?? 'ACTIVE')
  const [isEditing, setIsEditing] = useState(isCreateMode)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleDelete() {
    if (!note) return
    if (!window.confirm('¿Estás seguro de que querés eliminar esta nota? Esta acción no se puede deshacer.')) return

    setSaving(true)
    setError(null)

    try {
      const res = await fetch(`/api/notes/${note.id}`, {
        method: 'DELETE',
        credentials: 'include',
      })
      if (!res.ok) {
        const json = await res.json().catch(() => ({}))
        throw new Error(json.error ?? 'Error al eliminar la nota')
      }
      onDelete?.(note.id)
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al eliminar')
      setSaving(false)
    }
  }

  const meta = domainMeta(domain)

  async function handleSave() {
    if (!title.trim() && !content.trim()) {
      setError('Agregá un título o contenido antes de guardar.')
      return
    }

    setSaving(true)
    setError(null)

    try {
      if (isCreateMode) {
        const res = await fetch('/api/notes', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: title.trim() || 'Sin título',
            content,
            domain,
            status,
          }),
        })
        if (!res.ok) {
          const json = await res.json().catch(() => ({}))
          throw new Error(json.error ?? 'Error al crear la nota')
        }
        const created = (await res.json()) as NoteItem
        onCreated?.(created)
        onClose()
        return
      }

      if (!note) return
      const res = await fetch(`/api/notes/${note.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: title.trim() || 'Sin título',
          content,
          domain,
          status,
        }),
      })
      if (!res.ok) {
        const json = await res.json().catch(() => ({}))
        throw new Error(json.error ?? 'Error al guardar los cambios')
      }
      const updated = (await res.json()) as NoteItem
      // Reflect latest upstream values in local state
      setTitle(updated.title)
      setContent(updated.content)
      setDomain(updated.domain)
      setStatus(updated.status)
      setIsEditing(false)
      onUpdate?.(updated)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error desconocido')
    } finally {
      setSaving(false)
    }
  }

  function handleCancel() {
    if (isCreateMode) {
      onClose()
      return
    }
    if (!note) return
    setTitle(note.title)
    setContent(note.content)
    setDomain(note.domain)
    setStatus(note.status)
    setIsEditing(false)
    setError(null)
  }

  return (
    <>
      <div
        className="fixed inset-0 z-50 flex items-end justify-center bg-graphite/70 backdrop-blur-sm p-4 md:items-center animate-fade-in"
        onPointerDown={(e) => {
          if (e.target === e.currentTarget) onClose()
        }}
      >
        <div className="w-full max-h-[85vh] overflow-y-auto rounded-t-3xl border border-graphite-border bg-graphite-card px-6 pb-8 pt-6 shadow-2xl md:max-w-2xl md:rounded-3xl animate-scale-in">
          <div>
          {/* Header */}
          <div className="flex items-start justify-between mb-6">
            <div className="flex-1 min-w-0">
              {isEditing ? (
                <>
                  <input
                    type="text"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="Título de la nota"
                    className="w-full bg-graphite-card border border-graphite-border text-[#E3E2E2] font-serif text-2xl leading-snug px-2 py-1 focus:outline-none focus:border-[#A68966]/50"
                  />
                  <div className="mt-2">
                    <label className="text-[10px] tracking-[0.15em] uppercase text-[#5A5A5A] block mb-1">
                      Dominio
                    </label>
                    <select
                      value={domain}
                      onChange={(e) => setDomain(e.target.value as NoteDomain)}
                      disabled={lockDomain}
                      className="w-full bg-graphite-card border border-graphite-border text-[#A1A1AA] text-xs px-2 py-1 focus:outline-none focus:border-[#A68966]/50 disabled:opacity-60 disabled:cursor-not-allowed"
                    >
                      <option value="ESPIRITUAL">Espiritual</option>
                      <option value="PERSONAL">Personal</option>
                      <option value="APRENDIZAJE">Aprendizaje</option>
                      <option value="PROYECTOS">Proyectos</option>
                    </select>
                  </div>
                  {(domain === 'PROYECTOS' || domain === 'PERSONAL') && (
                    <div className="mt-2">
                      <label className="text-[10px] tracking-[0.15em] uppercase text-[#5A5A5A] block mb-1">
                        Estado
                      </label>
                      <select
                        value={status}
                        onChange={(e) => setStatus(e.target.value as NoteStatus)}
                        className="w-full bg-graphite-card border border-graphite-border text-[#A1A1AA] text-xs px-2 py-1 focus:outline-none focus:border-[#A68966]/50"
                      >
                        <option value="ACTIVE">Activa</option>
                        <option value="IN_PROGRESS">En curso</option>
                        <option value="DONE">Hecha</option>
                        <option value="NEEDS_REVIEW">Revisión</option>
                      </select>
                    </div>
                  )}
                </>
              ) : (
                <>
                  <h2 className="font-serif text-2xl text-[#E3E2E2] leading-snug">
                    {title || 'Sin título'}
                  </h2>
                  <p className="text-[10px] tracking-[0.15em] uppercase text-[#5A5A5A] mt-1 flex items-center gap-1">
                    {meta && <HubIcon icon={meta.icon} size={12} />}
                    {meta?.label ?? domain}
                  </p>
                </>
              )}
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

          {/* Edit-mode actions at top */}
          {isEditing && (
            <div className="flex flex-col gap-2 mb-4">
              <div className="flex items-center gap-2">
                <button
                  onClick={handleSave}
                  disabled={saving}
                  className="flex-1 border border-[#A68966]/60 text-[#A68966] text-xs uppercase tracking-wider py-2 hover:bg-[#A68966]/10 transition-colors disabled:opacity-50 disabled:cursor-not-allowed font-semibold"
                >
                  {saving ? 'Guardando…' : 'Guardar'}
                </button>
                <button
                  onClick={handleCancel}
                  disabled={saving}
                  className="flex-1 border border-graphite-border text-[#A1A1AA] text-xs uppercase tracking-wider py-2 hover:border-[#A68966]/40 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Cancelar
                </button>
              </div>
              {!isCreateMode && (
                <button
                  onClick={handleDelete}
                  disabled={saving}
                  className="w-full border border-red-500/40 text-red-400 text-xs uppercase tracking-wider py-2 hover:border-red-500 hover:bg-red-500/10 transition-colors disabled:opacity-50"
                >
                  Eliminar Nota
                </button>
              )}
            </div>
          )}

          {/* View-mode metadata + Editar button */}
          {!isEditing && note && (
            <>
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3 text-[11px] text-[#5A5A5A]">
                  <span className="border border-[#A68966]/40 text-[#A68966] px-2 py-0.5 text-[10px] uppercase tracking-wider">
                    {statusBadge(status)}
                  </span>
                  {note.dueDate && (
                    <span>{new Date(note.dueDate).toLocaleDateString('es-AR')}</span>
                  )}
                  {note.isImportant && (
                    <span className="text-[#A68966]">★ Importante</span>
                  )}
                </div>
                <button
                  onClick={() => setIsEditing(true)}
                  className="border border-graphite-border text-[#A1A1AA] text-[10px] uppercase tracking-wider px-3 py-1 hover:border-[#A68966]/40 hover:text-[#A68966] transition-colors"
                >
                  Editar
                </button>
              </div>

              <div className="prose prose-sm text-[#A1A1AA] font-sans leading-relaxed whitespace-pre-wrap">
                {content || <span className="italic text-[#5A5A5A]">Sin contenido.</span>}
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
            </>
          )}

          {/* Edit-mode content body */}
          {isEditing && (
            <>
              <label className="text-[10px] tracking-[0.15em] uppercase text-[#5A5A5A] block mb-1">
                Contenido
              </label>
              <textarea
                value={content}
                onChange={(e) => setContent(e.target.value)}
                placeholder="Escribí el contenido de la nota…"
                className="w-full h-64 bg-graphite-card border border-graphite-border text-[#A1A1AA] text-sm font-sans leading-relaxed px-3 py-2 focus:outline-none focus:border-[#A68966]/50 placeholder-[#5A5A5A]"
              />
              {error && (
                <p className="text-[#F87171] text-xs mt-2">{error}</p>
              )}
            </>
          )}
        </div>
      </div>
    </div>
      <style>{`
        @keyframes fade-in {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @keyframes scale-in {
          from { transform: scale(0.95); opacity: 0; }
          to { transform: scale(1); opacity: 1; }
        }
        .animate-fade-in { animation: fade-in 150ms ease-out forwards }
        .animate-scale-in { animation: scale-in 150ms ease-out forwards }
      `}</style>
    </>
  )
}