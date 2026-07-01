'use client'

// Calendar — monthly grid of tasks with a backlog sidebar of undated work.
// ponytail: native Date + Intl.DateTimeFormat only (no date lib). All bucketing
// is client-side so the API stays a thin pass-through over the user's notes.

import { useCallback, useEffect, useMemo, useState } from 'react'
import { NotePanel, type NoteDraft, type NoteItem } from '@/components/NotePanel'
import { Toast } from '@/components/Toast'

// ─── Types ───────────────────────────────────────────────────────────────────

type NoteStatus = 'DRAFT' | 'NEEDS_REVIEW' | 'ACTIVE' | 'IN_PROGRESS' | 'DONE'
type NoteDomain = 'ESPIRITUAL' | 'PERSONAL' | 'APRENDIZAJE' | 'PROYECTOS' | 'REGISTROS'

interface GridCell {
  date: Date
  ymd: string
  inMonth: boolean
  isToday: boolean
}

// ─── Constants ───────────────────────────────────────────────────────────────

// ponytail: colors live here, not in lib/hubs.ts. Once the design system
// stabilizes we can centralize them; for now the calendar is the only surface
// that needs a per-domain hue.
const DOMAIN_COLOR: Record<NoteDomain, string> = {
  ESPIRITUAL: '#A68966',
  PERSONAL: '#8E8E93',
  APRENDIZAJE: '#5B7FBF',
  PROYECTOS: '#6B8E5A',
  REGISTROS: '#C9A961',
}

const DAY_LABELS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom']

const STATUS_LABEL: Record<NoteStatus, string> = {
  DRAFT: 'Borrador',
  NEEDS_REVIEW: 'Revisión',
  ACTIVE: 'Activa',
  IN_PROGRESS: 'En curso',
  DONE: 'Hecha',
}

// ─── Date helpers ────────────────────────────────────────────────────────────

function toYMD(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const r = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${r}`
}

function capitalizeFirst(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

function formatMonthLabel(year: number, monthIdx: number): string {
  const d = new Date(year, monthIdx, 1)
  const raw = new Intl.DateTimeFormat('es-AR', { month: 'long', year: 'numeric' }).format(d)
  return capitalizeFirst(raw)
}

function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  )
}

function buildGrid(year: number, monthIdx: number, today: Date): GridCell[] {
  // ponytail: Monday-first week. JS getDay() returns 0 (Sun) – 6 (Sat); we
  // remap to 0 (Mon) – 6 (Sun) via (getDay() + 6) % 7.
  const firstOfMonth = new Date(year, monthIdx, 1)
  const offset = (firstOfMonth.getDay() + 6) % 7
  const gridStart = new Date(firstOfMonth)
  gridStart.setDate(gridStart.getDate() - offset)

  const cells: GridCell[] = []
  for (let i = 0; i < 42; i++) {
    const d = new Date(gridStart)
    d.setDate(gridStart.getDate() + i)
    cells.push({
      date: d,
      ymd: toYMD(d),
      inMonth: d.getMonth() === monthIdx,
      isToday: isSameDay(d, today),
    })
  }
  return cells
}

// ─── Domain helpers ──────────────────────────────────────────────────────────

function domainColor(d: string): string {
  return DOMAIN_COLOR[d as NoteDomain] ?? '#5A5A5A'
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s
  return s.slice(0, n - 1).trimEnd() + '…'
}

// ─── Main component ──────────────────────────────────────────────────────────

export default function CalendarPage() {
  const [notes, setNotes] = useState<NoteItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)

  const today = useMemo(() => new Date(), [])
  const [view, setView] = useState<{ year: number; monthIdx: number }>(() => ({
    year: today.getFullYear(),
    monthIdx: today.getMonth(),
  }))

  const [selectedNote, setSelectedNote] = useState<NoteItem | null>(null)
  const [creatingDraft, setCreatingDraft] = useState<NoteDraft | null>(null)
  const [creatingDate, setCreatingDate] = useState<Date | null>(null)

  // ── Data fetching ────────────────────────────────────────────────────────

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/calendar', { cache: 'no-store' })
      if (!res.ok) throw new Error('Failed to load')
      const json: NoteItem[] = await res.json()
      setNotes(json)
    } catch {
      setError('No se pudieron cargar las tareas.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load()
  }, [load])

  // ── View navigation ──────────────────────────────────────────────────────

  function gotoPrevMonth() {
    setView((v) => {
      const m = v.monthIdx - 1
      if (m < 0) return { year: v.year - 1, monthIdx: 11 }
      return { year: v.year, monthIdx: m }
    })
  }
  function gotoNextMonth() {
    setView((v) => {
      const m = v.monthIdx + 1
      if (m > 11) return { year: v.year + 1, monthIdx: 0 }
      return { year: v.year, monthIdx: m }
    })
  }
  function gotoToday() {
    setView({ year: today.getFullYear(), monthIdx: today.getMonth() })
  }

  // ── Derived state ────────────────────────────────────────────────────────

  const grid = useMemo(
    () => buildGrid(view.year, view.monthIdx, today),
    [view, today]
  )

  const todayYMD = useMemo(() => toYMD(today), [today])

  // Index notes by YYYY-MM-DD string so cell lookups are O(1). Includes tasks
  // scheduled this month AND spillover from adjacent months that the grid still
  // renders (with opacity-30).
  const tasksByYMD = useMemo(() => {
    const map = new Map<string, NoteItem[]>()
    for (const n of notes) {
      if (!n.dueDate) continue
      const ymd = n.dueDate.slice(0, 10)
      const arr = map.get(ymd) ?? []
      arr.push(n)
      map.set(ymd, arr)
    }
    return map
  }, [notes])

  const monthTotal = useMemo(() => {
    const monthPrefix = `${view.year}-${String(view.monthIdx + 1).padStart(2, '0')}`
    let total = 0
    for (const n of notes) {
      if (!n.dueDate) continue
      // ponytail: dueDate is an ISO string from Prisma; the YYYY-MM prefix
      // matches the view's month directly. No timezone math needed.
      if (n.dueDate.slice(0, 7) === monthPrefix) total++
    }
    return total
  }, [notes, view])

  // Backlog = undated AND not done.
  const backlog = useMemo(
    () => notes.filter((n) => n.dueDate === null && n.status !== 'DONE'),
    [notes]
  )

  // ── Handlers ─────────────────────────────────────────────────────────────

  function handleCellClick(cell: GridCell) {
    setCreatingDate(cell.date)
    setCreatingDraft({
      title: '',
      content: '',
      domain: 'PERSONAL',
      status: 'ACTIVE',
      dueDate: cell.ymd,
    })
  }

  function handleTaskClick(task: NoteItem, e: React.SyntheticEvent) {
    e.stopPropagation()
    setSelectedNote(task)
  }

  // ponytail: create-with-prefilled-date flow. We POST first to get a note id,
  // then PATCH the dueDate, then refresh. If the PATCH fails the note still
  // exists (just undated) and we surface a toast — never block the user.
  const patchDueDateAndReload = useCallback(
    async (saved: NoteItem, date: Date | null) => {
      if (!date) {
        await load()
        return
      }
      try {
        const res = await fetch(`/api/notes/${saved.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ dueDate: date.toISOString() }),
        })
        if (!res.ok) {
          setToast('La nota se creó, pero no se pudo asignar la fecha.')
        }
      } catch {
        setToast('La nota se creó, pero no se pudo asignar la fecha.')
      }
      await load()
    },
    [load]
  )

  function closePanels() {
    setSelectedNote(null)
    setCreatingDraft(null)
    setCreatingDate(null)
  }

  // ── Render ───────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="space-y-6 animate-pulse">
        <div className="h-8 w-48 border-border rounded" />
        <div className="h-6 w-32 border-border rounded" />
        <div className="grid grid-cols-7 gap-2 mt-6">
          {Array.from({ length: 42 }).map((_, i) => (
            <div key={i} className="h-24 border border-border bg-surface" />
          ))}
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="border border-border bg-surface px-4 py-3 flex items-center justify-between">
        <p className="text-sm text-fg">{error}</p>
        <button
          onClick={() => {
            setError(null)
            setLoading(true)
            load()
          }}
          className="text-[10px] tracking-widest text-accent uppercase hover:underline"
        >
          Reintentar
        </button>
      </div>
    )
  }

  const monthLabel = formatMonthLabel(view.year, view.monthIdx)

  return (
    <>
      <style>{`
        .cal-cell { transition: border-color 150ms ease-out, background-color 150ms ease-out }
        .cal-cell:hover { border-color: rgba(166, 137, 102, 0.4) }
        .cal-tag { transition: border-color 120ms ease-out, color 120ms ease-out }
        .cal-tag:hover { color: #E3E2E2 }

        /* ponytail: real CSS breakout. The shared (app)/layout.tsx caps the
           <main> at max-w-[720px] and offsets it by 220px (md:ml-[220px]) for
           the sidebar. A child can only ever be as wide as its parent's box,
           so a literal "max-w-[1100px]" on the page is a no-op.
           The pattern: width: 100vw with a negative margin that compensates
           for the parent's centering + sidebar offset, and padding-left:
           220px to push the actual content past the fixed sidebar.
           Verified math:
             - vw < 940 (parent fills container, no centering): margin = -220
             - vw >= 940 (parent at max-w 720, centered in 100vw-220):
                 parent_left_v = 220 + (100vw - 940) / 2 = 50vw - 250
                 margin = -(parent_left_v) = 250 - 50vw
               which equals -220 - max(0, 50vw - 470) for all viewports.
             - max-width: 1320 keeps the content area <= 1100 (1320 - 220). */
        .calendar-container {
          width: 100%;
          max-width: 1100px;
          margin-left: auto;
          margin-right: auto;
        }
        @media (min-width: 768px) {
          .calendar-container {
            width: 100vw;
            max-width: 1320px;
            margin-left: calc(-220px - max(0px, 50vw - 470px));
            padding-left: 220px;
          }
        }
      `}</style>

      <div className="calendar-container">
        {/* Header */}
        <div className="mb-6">
          <p className="text-[10px] tracking-[0.2em] text-accent uppercase font-semibold">PLANIFICACIÓN</p>
          <div className="flex items-end justify-between mt-1 flex-wrap gap-3">
            <div>
              <h1 className="font-serif text-4xl text-fg">Calendario</h1>
              <p className="font-serif text-lg text-fg-subtle mt-1">{monthLabel}</p>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={gotoPrevMonth}
                aria-label="Mes anterior"
                className="w-9 h-9 border border-border text-fg-muted hover:border-accent/40 hover:text-accent transition-colors text-base leading-none flex items-center justify-center"
              >
                ‹
              </button>
              <button
                onClick={gotoToday}
                className="px-4 h-9 border border-border text-fg-muted text-[10px] uppercase tracking-wider hover:border-accent/40 hover:text-accent transition-colors"
              >
                Hoy
              </button>
              <button
                onClick={gotoNextMonth}
                aria-label="Mes siguiente"
                className="w-9 h-9 border border-border text-fg-muted hover:border-accent/40 hover:text-accent transition-colors text-base leading-none flex items-center justify-center"
              >
                ›
              </button>
            </div>
          </div>
          <div className="h-px bg-gradient-to-r from-[#A68966]/60 via-[#A68966]/20 to-transparent mt-4" />
        </div>

        {/* Grid + Sidebar */}
        <div className="md:grid md:grid-cols-[1fr_300px] md:gap-6 md:items-start">
          {/* Calendar grid */}
          <div>
            {/* Day-of-week header */}
            <div className="grid grid-cols-7 gap-1.5 mb-1.5">
              {DAY_LABELS.map((d) => (
                <div
                  key={d}
                  className="text-[10px] tracking-[0.15em] uppercase text-fg-faint text-center py-1"
                >
                  {d}
                </div>
              ))}
            </div>

            {/* Day cells — 6 weeks × 7 days = 42 */}
            <div className="grid grid-cols-7 gap-1.5">
              {grid.map((cell) => {
                const cellTasks = tasksByYMD.get(cell.ymd) ?? []
                const visible = cellTasks.slice(0, 3)
                const overflow = cellTasks.length - visible.length

                return (
                  <button
                    key={cell.ymd}
                    type="button"
                    onClick={() => handleCellClick(cell)}
                    aria-label={`Crear tarea el ${cell.ymd}`}
                    className={[
                      'cal-cell text-left border border-border bg-surface min-h-[88px] p-1.5 flex flex-col gap-1 cursor-pointer',
                      !cell.inMonth ? 'opacity-30' : '',
                      cell.isToday ? 'border-accent/60 bg-accent/5' : '',
                    ].join(' ')}
                  >
                    <div className="flex items-center justify-between">
                      <span
                        className={[
                          'text-[10px] font-medium',
                          cell.isToday ? 'text-accent' : 'text-fg-subtle',
                        ].join(' ')}
                      >
                        {cell.date.getDate()}
                      </span>
                      {cell.ymd === todayYMD && cell.inMonth && (
                        <span className="text-[8px] uppercase tracking-wider text-accent">
                          Hoy
                        </span>
                      )}
                    </div>
                    <div className="flex flex-col gap-0.5 overflow-hidden">
                      {visible.map((t) => (
                        <div
                          key={t.id}
                          role="button"
                          tabIndex={0}
                          onClick={(e) => handleTaskClick(t, e)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault()
                              handleTaskClick(t, e)
                            }
                          }}
                          className="cal-tag flex items-center gap-1 border-l-2 pl-1 pr-1 py-0.5 text-[10px] leading-tight truncate cursor-pointer"
                          style={{ borderLeftColor: domainColor(t.domain) }}
                          title={t.title}
                        >
                          <span className="truncate text-fg-muted">{truncate(t.title, 30)}</span>
                        </div>
                      ))}
                      {overflow > 0 && (
                        <div className="text-[9px] text-fg-faint pl-1">+{overflow}</div>
                      )}
                    </div>
                  </button>
                )
              })}
            </div>

            {monthTotal === 0 && (
              <p className="text-fg-faint text-sm italic mt-8">
                No hay tareas este mes.
              </p>
            )}
          </div>

          {/* Backlog sidebar */}
          <aside className="mt-8 md:mt-0 md:sticky md:top-8">
            <div className="flex items-baseline justify-between mb-3">
              <p className="text-[10px] tracking-[0.2em] text-accent uppercase font-semibold">
                Tareas sin Fecha
              </p>
              <span className="text-[10px] text-fg-faint">{backlog.length}</span>
            </div>

            {backlog.length === 0 ? (
              <p className="text-fg-faint text-xs italic">
                Todo al día. No quedan tareas sin fecha.
              </p>
            ) : (
              <div className="space-y-2">
                {backlog.map((n) => (
                  <button
                    key={n.id}
                    type="button"
                    onClick={() => setSelectedNote(n)}
                    className="w-full text-left border border-border bg-surface px-3 py-2.5 hover:border-accent/30 transition-colors group"
                  >
                    <div className="flex items-start gap-2">
                      <span
                        className="mt-1 w-1.5 h-1.5 flex-shrink-0 rounded-full"
                        style={{ backgroundColor: domainColor(n.domain) }}
                        aria-hidden
                      />
                      <div className="flex-1 min-w-0">
                        <p className="text-xs text-fg truncate group-hover:text-accent/80 transition-colors">
                          {n.title || 'Sin título'}
                        </p>
                        {n.status === 'IN_PROGRESS' && (
                          <span className="inline-block mt-1 text-[9px] uppercase tracking-wider border border-accent/40 text-accent px-1.5 py-0.5">
                            {STATUS_LABEL[n.status]}
                          </span>
                        )}
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </aside>
        </div>
      </div>

      {/* NotePanel — view/edit existing task */}
      {selectedNote && (
        <NotePanel
          note={selectedNote}
          onClose={() => setSelectedNote(null)}
          onUpdate={() => {
            load()
          }}
          onDelete={() => {
            setSelectedNote(null)
            load()
          }}
        />
      )}

      {/* NotePanel — create with pre-filled date (PATCH applied after create) */}
      {creatingDraft && (
        <NotePanel
          draft={creatingDraft}
          onClose={closePanels}
          onCreated={(saved) => patchDueDateAndReload(saved, creatingDate)}
        />
      )}

      {/* Toast */}
      {toast && (
        <Toast message={toast} onDismiss={() => setToast(null)} />
      )}
    </>
  )
}
