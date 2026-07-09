'use client'

import { useState } from 'react'
import { HubIcon } from '@/components/icons'
import { domainMeta } from '@/lib/hubs'
import type { NoteItem, NoteWithTask } from '@/lib/types/note'
import type { TaskItem } from '@/lib/types/task'

// ─── Re-export types for consumers ────────────────────────────────────────────

export type { NoteItem } from '@/lib/types/note'

type NoteDomain = 'ESPIRITUAL' | 'PERSONAL' | 'APRENDIZAJE' | 'PROYECTOS' | 'REGISTROS'

// Legacy NoteDraft for create mode (used by Calendar, HubContent)
export interface NoteDraftLegacy {
  title: string
  content: string
  domain: NoteDomain
  status?: string
  dueDate?: string | null
  isImportant?: boolean
  tags?: string[]
}

// Re-export with old name for compat
export type NoteDraft = NoteDraftLegacy

function formatInputDate(dateStr: string | null | undefined): string {
  if (!dateStr) return ''
  const d = new Date(dateStr)
  if (isNaN(d.getTime())) return ''
  return d.toISOString().split('T')[0]
}

interface NotePanelProps {
  note?: NoteItem | NoteWithTask
  draft?: NoteDraft
  lockDomain?: boolean
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

// ─── Suggested Goal Button ─────────────────────────────────────────────────────

function SuggestedGoalButton({ noteId, goal }: { noteId: string; goal: string }) {
  const [accepted, setAccepted] = useState(false)
  const [error, setError] = useState<string | null>(null)

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
      } else if (res.status === 409) {
        setError('Ya tenés una tarea asociada a esta nota.')
      }
    } catch {
      // noop
    }
  }

  return (
    <div className="flex items-start gap-2">
      <span className="text-fg-faint text-xs flex-1 leading-relaxed">{goal}</span>
      <div className="flex-shrink-0">
        {error ? (
          <span className="text-[10px] text-amber-400">{error}</span>
        ) : (
          <button
            onClick={handleAccept}
            disabled={accepted}
            className={`text-[10px] uppercase tracking-wider px-2 py-1 border transition-colors ${
              accepted
                ? 'border-accent/20 text-accent/30 cursor-default'
                : 'border-accent/40 text-accent hover:bg-accent/10'
            }`}
          >
            {accepted ? 'Aceptada' : 'Aceptar como Meta'}
          </button>
        )}
      </div>
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

  // Extraer Task de NoteWithTask
  const existingTask = note && 'task' in note ? (note as NoteWithTask).task : null
  const taskId = existingTask?.id

  // Local form state
  const [title, setTitle] = useState(draft?.title ?? note?.title ?? '')
  const [content, setContent] = useState(draft?.content ?? note?.content ?? '')
  const [domain, setDomain] = useState<NoteDomain>(draft?.domain ?? note?.domain as NoteDomain ?? 'PERSONAL')
  const [dueDate, setDueDate] = useState<string>(formatInputDate(
    draft?.dueDate ?? existingTask?.dueDate ?? null
  ))
  const [isImportant, setIsImportant] = useState<boolean>(
    draft?.isImportant ?? existingTask?.isImportant ?? false
  )
  const [tagsText, setTagsText] = useState<string>((draft?.tags ?? note?.tags ?? []).join(', '))
  const [isEditing, setIsEditing] = useState(isCreateMode)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleDelete() {
    if (!note) return
    if (!window.confirm('¿Estás seguro de que querés eliminar esta nota? Esta acción no se puede deshacer.')) return

    setSaving(true)
    setError(null)

    try {
      const res = await fetch(`/api/notes/${note.id}`, { method: 'DELETE', credentials: 'include' })
      if (!res.ok) {
        const json = await res.json().catch(() => ({}))
        throw new Error(json.error?.message ?? 'Error al eliminar la nota')
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
        const payload: Record<string, unknown> = {
          title: title.trim() || 'Sin título',
          content,
          domain,
          tags: tagsText.split(',').map((t) => t.trim()).filter(Boolean),
        }
        // Pasar campos de Task si el draft los incluye (ej: desde calendario)
        if (draft?.dueDate) {
          payload.dueDate = draft.dueDate
        }
        if (draft?.isImportant) {
          payload.isImportant = draft.isImportant
        }
        const res = await fetch('/api/notes', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })
        if (!res.ok) {
          const json = await res.json().catch(() => ({}))
          throw new Error(json.error?.message ?? 'Error al crear la nota')
        }
        const body = await res.json()
        const created = body.data ?? body
        onCreated?.(created)
        onClose()
        return
      }

      if (!note) return

      // PATCH Note (title/content/tags/domain)
      const notePatch = fetch(`/api/notes/${note.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: title.trim() || 'Sin título',
          content,
          domain,
          tags: tagsText.split(',').map((t) => t.trim()).filter(Boolean),
        }),
      })

      // PATCH Task (dueDate/isImportant) — solo si hay Task
      const taskData = taskId ? {
        dueDate: dueDate || null,
        isImportant,
      } : null

      const results = await Promise.allSettled([
        notePatch,
        taskId && taskData
          ? fetch(`/api/tasks/${taskId}`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(taskData),
            })
          : Promise.resolve(null),
      ])

      const noteResult = results[0]
      const taskResult = results[1]

      if (noteResult.status === 'rejected') {
        throw new Error('Error al guardar los cambios de la nota')
      }

      const noteRes = await noteResult.value.json()
      const updated = noteRes.data ?? noteRes

      if (taskResult.status === 'rejected') {
        setError('La nota se guardó, pero los cambios de tarea no. Reintentá.')
      } else {
        setError(null)
      }

      // Reflect latest values
      setTitle(updated.title)
      setContent(updated.content)
      setDomain(updated.domain)
      if (taskResult.status === 'fulfilled' && taskResult.value) {
        const taskRes = await taskResult.value.json()
        const taskUpdated = taskRes.data ?? taskRes
        setDueDate(formatInputDate(taskUpdated?.dueDate ?? null))
        setIsImportant(taskUpdated?.isImportant ?? false)
      }
      setTagsText((updated.tags ?? []).join(', '))
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
    setDomain(note.domain as NoteDomain)
    setDueDate(formatInputDate(existingTask?.dueDate ?? null))
    setIsImportant(existingTask?.isImportant ?? false)
    setTagsText((note.tags ?? []).join(', '))
    setIsEditing(false)
    setError(null)
  }

  const viewDueDate = existingTask?.dueDate ?? null

  return (
    <>
      <div
        className="fixed inset-0 z-50 flex items-end justify-center bg-bg/70 backdrop-blur-sm p-4 md:items-center animate-fade-in"
        onPointerDown={(e) => {
          if (e.target === e.currentTarget) onClose()
        }}
      >
        <div className="w-full max-h-[85vh] overflow-y-auto rounded-t-3xl border border-border bg-surface px-6 pb-8 pt-6 shadow-2xl md:max-w-2xl md:rounded-3xl animate-scale-in">
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
                    placeholder={domain === 'PROYECTOS' || domain === 'PERSONAL' ? 'Nombre de la tarea' : 'Título de la nota'}
                    className="w-full bg-surface border border-border text-fg font-serif text-2xl leading-snug px-2 py-1 focus:outline-none focus:border-accent/50"
                  />
                  <div className="mt-2">
                    <label className="text-[10px] tracking-[0.15em] uppercase text-fg-faint block mb-1">
                      Dominio
                    </label>
                    <select
                      value={domain}
                      onChange={(e) => setDomain(e.target.value as NoteDomain)}
                      disabled={lockDomain}
                      className="w-full bg-surface border border-border text-fg-muted text-xs px-2 py-1 focus:outline-none focus:border-accent/50 disabled:opacity-60 disabled:cursor-not-allowed"
                    >
                      <option value="ESPIRITUAL">Espiritual</option>
                      <option value="PERSONAL">Personal</option>
                      <option value="APRENDIZAJE">Aprendizaje</option>
                      <option value="PROYECTOS">Proyectos</option>
                    </select>
                  </div>
                  {(domain === 'PROYECTOS' || domain === 'PERSONAL') && taskId && (
                    <>
                      <div className="mt-2">
                        <label className="text-[10px] tracking-[0.15em] uppercase text-fg-faint block mb-1">
                          Fecha Límite (Opcional)
                        </label>
                        <input
                          type="date"
                          value={dueDate}
                          onChange={(e) => setDueDate(e.target.value)}
                          className="w-full bg-surface border border-border text-fg-muted text-xs px-2 py-1 focus:outline-none focus:border-accent/50"
                        />
                      </div>
                      <div className="mt-3 flex items-center gap-2">
                        <input
                          type="checkbox"
                          id="isImportant"
                          checked={isImportant}
                          onChange={(e) => setIsImportant(e.target.checked)}
                          className="rounded border-border bg-surface text-accent focus:ring-0"
                        />
                        <label
                          htmlFor="isImportant"
                          className="text-[10px] tracking-[0.15em] uppercase text-fg-faint select-none cursor-pointer"
                        >
                          Marcar como Importante (★)
                        </label>
                      </div>
                    </>
                  )}
                </>
              ) : (
                <>
                  <h2 className="font-serif text-2xl text-fg leading-snug">
                    {title || 'Sin título'}
                  </h2>
                  <p className="text-[10px] tracking-[0.15em] uppercase text-fg-faint mt-1 flex items-center gap-1">
                    {meta && <HubIcon icon={meta.icon} size={12} />}
                    {meta?.label ?? domain}
                  </p>
                </>
              )}
            </div>
            <button
              onClick={onClose}
              className="ml-4 flex-shrink-0 text-fg-faint hover:text-accent transition-colors"
              aria-label="Cerrar"
            >
              <svg viewBox="0 0 16 16" className="w-4 h-4">
                <line x1="2" y1="2" x2="14" y2="14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                <line x1="14" y1="2" x2="2" y2="14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            </button>
          </div>

          {/* Edit-mode actions */}
          {isEditing && (
            <div className="flex flex-col gap-2 mb-4">
              <div className="flex items-center gap-2">
                <button
                  onClick={handleSave}
                  disabled={saving}
                  className="flex-1 border border-accent/60 text-accent text-xs uppercase tracking-wider py-2 hover:bg-accent/10 transition-colors disabled:opacity-50 disabled:cursor-not-allowed font-semibold"
                >
                  {saving ? 'Guardando…' : 'Guardar'}
                </button>
                <button
                  onClick={handleCancel}
                  disabled={saving}
                  className="flex-1 border border-border text-fg-muted text-xs uppercase tracking-wider py-2 hover:border-accent/40 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
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
                <div className="flex items-center gap-3 text-[11px] text-fg-faint">
                  <span className="border border-accent/40 text-accent px-2 py-0.5 text-[10px] uppercase tracking-wider">
                    {note.noteStatus === 'DRAFT' ? 'Borrador' : note.noteStatus === 'NEEDS_REVIEW' ? 'Revisión' : 'Activa'}
                  </span>
                  {viewDueDate && (
                    <span>{new Date(viewDueDate).toLocaleDateString('es-AR')}</span>
                  )}
                  {existingTask?.isImportant && (
                    <span className="text-accent">★ Importante</span>
                  )}
                </div>
                <button
                  onClick={() => setIsEditing(true)}
                  className="border border-border text-fg-muted text-[10px] uppercase tracking-wider px-3 py-1 hover:border-accent/40 hover:text-accent transition-colors"
                >
                  Editar
                </button>
              </div>

              <div className="prose prose-sm text-fg-muted font-sans leading-relaxed whitespace-pre-wrap">
                {content || <span className="italic text-fg-faint">Sin contenido.</span>}
              </div>

              {/* Tags */}
              {note.tags && note.tags.length > 0 && (
                <div className="flex flex-wrap gap-2 mt-4">
                  {note.tags.map((tag) => (
                    <span
                      key={tag}
                      className="text-[10px] uppercase tracking-wider border border-accent/30 text-accent px-2 py-0.5"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              )}

              {/* Suggested Goals */}
              {note.domain === 'ESPIRITUAL' && (note.suggestedGoals?.length ?? 0) > 0 && (
                <div className="mt-6 pt-4 border-t border-border">
                  <p className="text-[10px] tracking-[0.15em] uppercase text-accent mb-3">
                    Metas sugeridas por IA
                  </p>
                  <div className="space-y-2">
                    {note.suggestedGoals!.map((goal, i) => (
                      <SuggestedGoalButton key={i} noteId={note.id} goal={goal} />
                    ))}
                  </div>
                </div>
              )}

              <div className="mt-8 pt-4 border-t border-border text-[10px] text-fg-faint">
                <p>Creada {relativeTime(note.createdAt)}</p>
                <p className="mt-0.5">Actualizada {relativeTime(note.updatedAt)}</p>
              </div>
            </>
          )}

          {/* Edit-mode content body */}
          {isEditing && (
            <>
              <div className="mt-4">
                <label className="text-[10px] tracking-[0.15em] uppercase text-fg-faint block mb-1">
                  {domain === 'PROYECTOS' || domain === 'PERSONAL' ? 'Descripción' : 'Contenido'}
                </label>
                <textarea
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                  placeholder={domain === 'PROYECTOS' || domain === 'PERSONAL' ? 'Escribí la descripción o sub-tareas…' : 'Escribí el contenido de la nota…'}
                  className="w-full h-48 bg-surface border border-border text-fg-muted text-sm font-sans leading-relaxed px-3 py-2 focus:outline-none focus:border-accent/50 placeholder-fg-faint"
                />
              </div>
              <div className="mt-4">
                <label className="text-[10px] tracking-[0.15em] uppercase text-fg-faint block mb-1">
                  Etiquetas (separadas por comas)
                </label>
                <input
                  type="text"
                  value={tagsText}
                  onChange={(e) => setTagsText(e.target.value)}
                  placeholder="ej: programacion, ideas, gym"
                  className="w-full bg-surface border border-border text-fg-muted text-xs px-2 py-1 focus:outline-none focus:border-accent/50 placeholder-fg-faint"
                />
              </div>
              {error && (
                <p className="text-error text-xs mt-2">{error}</p>
              )}
            </>
          )}
        </div>
      </div>
    </div>
    </>
  )
}
