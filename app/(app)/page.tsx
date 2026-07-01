'use client'

import { useEffect, useState, useRef, useCallback } from 'react'
import Link from 'next/link'
import InboxSection from '@/components/InboxSection'
import { Toast } from '@/components/Toast'
import { domainMeta } from '@/lib/hubs'
import type { Domain } from '@prisma/client'

// ─── Types ─────────────────────────────────────────────────────────────────────

type NoteStatus = 'DRAFT' | 'NEEDS_REVIEW' | 'ACTIVE' | 'IN_PROGRESS' | 'DONE'

interface Note {
  id: string
  title: string
  content: string
  status: NoteStatus
  isImportant: boolean
  dueDate: string | null
  createdAt: string
  updatedAt: string
}

interface TempNote extends Omit<Note, 'status' | 'updatedAt'> {
  status: 'ACTIVE'
  _pending?: true
}



interface Habit {
  id: string
  name: string
  frequency: string
  completedToday: boolean
}

interface Subscription {
  id: string
  name: string
  amount: number
}

interface ResurgenceNote {
  id: string
  title: string
  content: string
  createdAt: string
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

function capitalizeFirst(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

function formatDisplayName(localPart: string): string {
  // ponytail: email local part → "Test User" / "Ezequiel". Strips digits and
  // test-noise suffixes; upgrade path is a proper display-name field on User.
  return localPart
    .split(/[-_]/)
    .map((w) => w.replace(/[^a-zA-Z]/g, ''))
    .filter(Boolean)
    .map(capitalizeFirst)
    .join(' ')
}

function formatDateSpanish(date: Date): string {
  // ponytail: locale hardcoded; user-locale switching would be the upgrade path.
  const df = new Intl.DateTimeFormat('es-AR', { weekday: 'long', day: 'numeric', month: 'long' })
  return capitalizeFirst(df.format(date).replace(/\s+/g, ' '))
}

function getGreeting(hour: number): string {
  if (hour >= 5 && hour < 12) return 'Buen día'
  if (hour >= 12 && hour < 19) return 'Buenas tardes'
  return 'Buenas noches'
}

function getTodayYYYYMMDD(): string {
  const now = new Date()
  return new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString().slice(0, 10)
}



// ─── Skeleton ──────────────────────────────────────────────────────────────────

function Skeleton() {
  return (
    <div className="space-y-6 animate-pulse">
      <div className="h-4 w-12 bg-graphite-border rounded" />
      <div className="h-8 w-64 bg-graphite-border rounded" />
      <div className="h-3 w-48 bg-graphite-border rounded" />
      <div className="mt-10 h-32 border border-graphite-border rounded-none bg-graphite-card" />
      <div className="space-y-3">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-12 border border-graphite-border rounded-none bg-graphite-card" />
        ))}
      </div>
    </div>
  )
}

// ─── Inline SVG Icons ──────────────────────────────────────────────────────────

function CheckIcon({ checked, onChange }: { checked: boolean; onChange: () => void }) {
  return (
    <button
      onClick={onChange}
      className="flex-shrink-0 w-5 h-5 border rounded-none focus:outline-none focus:ring-1 focus:ring-[#A68966] transition-all duration-150"
      style={{
        borderColor: '#A68966',
        backgroundColor: checked ? '#A68966' : 'transparent',
      }}
      aria-label={checked ? 'Desmarcar tarea' : 'Completar tarea'}
    >
      {checked && (
        <svg viewBox="0 0 12 12" className="w-full h-full">
          <polyline points="2,6 5,9 10,3" fill="none" stroke="black" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )}
    </button>
  )
}

function StarIcon({ filled }: { filled: boolean }) {
  return (
    <svg viewBox="0 0 16 16" className="w-3 h-3 flex-shrink-0">
      {filled ? (
        <path d="M8 1l1.9 3.8 4.1.6-3 2.9.7 4.1L8 10.4l-3.7 2 .7-4.1-3-2.9 4.1-.6L8 1z" fill="#A68966" />
      ) : (
        <path d="M8 1l1.9 3.8 4.1.6-3 2.9.7 4.1L8 10.4l-3.7 2 .7-4.1-3-2.9 4.1-.6L8 1z" fill="none" stroke="#A68966" strokeWidth="1" opacity="0.3" />
      )}
    </svg>
  )
}

function FocusIcon() {
  return (
    <svg viewBox="0 0 16 16" className="w-4 h-4" aria-hidden="true">
      <circle cx="8" cy="8" r="3" fill="none" stroke="#A68966" strokeWidth="1.2" />
      <line x1="8" y1="1" x2="8" y2="4" stroke="#A68966" strokeWidth="1.2" strokeLinecap="round" />
      <line x1="8" y1="12" x2="8" y2="15" stroke="#A68966" strokeWidth="1.2" strokeLinecap="round" />
      <line x1="1" y1="8" x2="4" y2="8" stroke="#A68966" strokeWidth="1.2" strokeLinecap="round" />
      <line x1="12" y1="8" x2="15" y2="8" stroke="#A68966" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  )
}

// ─── Reflection Form ─────────────────────────────────────────────────────────

function ReflectionForm({
  noteId,
  onSubmit,
}: {
  noteId: string
  onSubmit: (noteId: string, text: string, onSuccess: () => void) => Promise<void>
}) {
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')

  function handleSubmit() {
    if (text.trim() === '') return
    onSubmit(noteId, text, () => {
      setText('')
      setOpen(false)
    })
  }

  return (
    <div>
      {!open ? (
        <button
          onClick={() => setOpen(true)}
          className="text-[10px] uppercase tracking-wider text-[#5A5A5A] hover:text-[#A68966] transition-colors"
        >
          Añadir reflexión
        </button>
      ) : (
        <div className="mt-2 space-y-2">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            className="w-full bg-graphite-card border border-graphite-border text-[#E3E2E2] text-xs px-3 py-2 resize-none focus:outline-none focus:border-[#A68966]/40"
            rows={3}
            placeholder="Tu reflexión..."
          />
          <div className="flex gap-2">
            <button
              onClick={handleSubmit}
              className="text-[10px] uppercase tracking-wider px-3 py-1.5 border border-graphite-border text-[#7A7A7A] hover:border-[#A68966]/40 hover:text-[#A68966] transition-colors"
            >
              Añadir
            </button>
            <button
              onClick={() => { setOpen(false); setText('') }}
              className="text-[10px] uppercase tracking-wider px-3 py-1.5 border border-graphite-border text-[#5A5A5A] hover:text-[#7A7A7A] transition-colors"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function Dashboard() {
  const [displayName, setDisplayName] = useState<string>('')
  const [focusTask, setFocusTask] = useState<Note | null>(null)
  const [todayTasks, setTodayTasks] = useState<(Note | TempNote)[]>([])
  const [maintenanceTasks, setMaintenanceTasks] = useState<Note[]>([])
  const [habits, setHabits] = useState<Habit[]>([])
  const [dueSubscription, setDueSubscription] = useState<Subscription | null>(null)
  const [resurgenceNote, setResurgenceNote] = useState<ResurgenceNote | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [toast, setToast] = useState<{ message: string; href?: string } | null>(null)

  const showToast = useCallback((msg: string, _tone?: 'success' | 'error', domain?: string) => {
    const href = domain ? `/hubs/${domainMeta(domain as Domain)?.slug ?? ''}` : undefined
    setToast({ message: msg, href: href && href !== '/hubs/' ? href : undefined })
  }, [])

  // ── Auth + Data Fetch ───────────────────────────────────────────────────────

  useEffect(() => {
    async function load() {
      try {
        const meRes = await fetch('/api/auth/me')
        if (!meRes.ok) return
        const { user } = await meRes.json()
        const localPart = user.email?.split('@')[0] ?? ''
        const formatted = formatDisplayName(localPart)
        setDisplayName(formatted || 'vos')

        const todayRes = await fetch('/api/today')
        if (!todayRes.ok) throw new Error('Failed to load today')
        const { focusTask: ft, todayTasks: tt, maintenanceTasks: mt, habits: h, dueSubscription: ds, resurgenceNote: rn } = await todayRes.json()
        setFocusTask(ft)
        setTodayTasks(tt)
        setMaintenanceTasks(mt)
        setHabits(h ?? [])
        setDueSubscription(ds ?? null)
        setResurgenceNote(rn ?? null)
      } catch {
        setError('No se pudieron cargar las tareas.')
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])



  // ── Optimistic Mutations ─────────────────────────────────────────────────────

  async function handleCheck(task: Note | TempNote) {
    if ('_pending' in task) return
    const prev = todayTasks
    setTodayTasks((t) => t.filter((x) => x.id !== task.id))
    try {
      const res = await fetch(`/api/notes/${task.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'DONE' }),
      })
      if (!res.ok) throw new Error()
    } catch {
      setTodayTasks(prev)
      showToast('No se pudo completar la tarea.')
    }
  }

  async function handleFocus(task: Note | TempNote) {
    if ('_pending' in task) return
    const prev = todayTasks
    // Optimistically remove from list and set as focus
    setTodayTasks((t) => t.filter((x) => x.id !== task.id))
    try {
      const res = await fetch(`/api/notes/${task.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'IN_PROGRESS' }),
      })
      if (!res.ok) throw new Error()
      const updated: Note = await res.json()
      setFocusTask(updated)
    } catch {
      setTodayTasks(prev)
      showToast('No se pudo hacer foco en la tarea.')
    }
  }

  async function handleReleaseFocus() {
    if (!focusTask) return
    const prevFocus = focusTask
    setFocusTask(null)
    try {
      const res = await fetch(`/api/notes/${prevFocus.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'ACTIVE' }),
      })
      if (!res.ok) throw new Error()
      const updated: Note = await res.json()
      // Add back to list if it has today's dueDate
      const todayYYYYMMDD = getTodayYYYYMMDD()
      const dueStr = updated.dueDate?.slice(0, 10)
      if (dueStr === todayYYYYMMDD) {
        setTodayTasks((t) => [...t, updated])
      }
    } catch {
      setFocusTask(prevFocus)
      showToast('No se pudo liberar el enfoque.')
    }
  }

  // ── Maintenance Console handlers ──────────────────────────────────────────────

  // ponytail: each handler snapshots its slice, optimistically removes (or moves)
  // the task, then PATCHes. Rollback on any thrown error.
  async function handleMaintCheck(task: Note) {
    const prev = maintenanceTasks
    setMaintenanceTasks((m) => m.filter((x) => x.id !== task.id))
    try {
      const res = await fetch(`/api/notes/${task.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'DONE' }),
      })
      if (!res.ok) throw new Error()
    } catch {
      setMaintenanceTasks(prev)
      showToast('No se pudo completar la tarea.')
    }
  }

  async function handleMaintHoy(task: Note) {
    const prevMaint = maintenanceTasks
    const prevToday = todayTasks
    const now = new Date()
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    const iso = startOfToday.toISOString()
    const updated: Note = { ...task, dueDate: iso, updatedAt: new Date().toISOString() }
    setMaintenanceTasks((m) => m.filter((x) => x.id !== task.id))
    setTodayTasks((t) => [...t, updated])
    try {
      const res = await fetch(`/api/notes/${task.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dueDate: iso }),
      })
      if (!res.ok) throw new Error()
    } catch {
      setMaintenanceTasks(prevMaint)
      setTodayTasks(prevToday)
      showToast('No se pudo reprogramar la tarea.')
    }
  }

  async function handleMaintManana(task: Note) {
    const prev = maintenanceTasks
    const now = new Date()
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    const startOfTomorrow = new Date(startOfToday)
    startOfTomorrow.setDate(startOfTomorrow.getDate() + 1)
    const iso = startOfTomorrow.toISOString()
    setMaintenanceTasks((m) => m.filter((x) => x.id !== task.id))
    try {
      const res = await fetch(`/api/notes/${task.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dueDate: iso }),
      })
      if (!res.ok) throw new Error()
    } catch {
      setMaintenanceTasks(prev)
      showToast('No se pudo reprogramar la tarea.')
    }
  }

  async function handleMaintBacklog(task: Note) {
    const prev = maintenanceTasks
    setMaintenanceTasks((m) => m.filter((x) => x.id !== task.id))
    try {
      const res = await fetch(`/api/notes/${task.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dueDate: null, isImportant: false }),
      })
      if (!res.ok) throw new Error()
    } catch {
      setMaintenanceTasks(prev)
      showToast('No se pudo mover al backlog.')
    }
  }

  // "Dejar aquí": no reprograma nada — solo saca el nag de la consola de
  // mantenimiento para esta sesión (la tarea sigue atrasada, sin tocar el backend).
  function handleMaintDejarAqui(task: Note) {
    setMaintenanceTasks((m) => m.filter((x) => x.id !== task.id))
  }

  // ── Habit toggle ─────────────────────────────────────────────────────────────

  async function handleHabitToggle(habit: Habit) {
    const prev = habits
    setHabits((h) =>
      h.map((x) => (x.id === habit.id ? { ...x, completedToday: !x.completedToday } : x))
    )
    try {
      const res = await fetch(`/api/habits/${habit.id}/log`, { method: 'POST' })
      if (!res.ok) throw new Error()
    } catch {
      setHabits(prev)
      showToast('No se pudo actualizar el hábito.')
    }
  }

  // ── Subscription confirm ────────────────────────────────────────────────────

  async function handleSubscriptionConfirm(id: string, confirmed: boolean) {
    const prev = dueSubscription
    setDueSubscription(null)
    try {
      const res = await fetch(`/api/subscriptions/${id}/confirm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirmed }),
      })
      if (!res.ok) throw new Error()
    } catch {
      setDueSubscription(prev)
      showToast('No se pudo confirmar.')
    }
  }

  // ── Reflection ───────────────────────────────────────────────────────────────

  async function handleReflection(noteId: string, text: string, onSuccess: () => void) {
    try {
      const res = await fetch(`/api/notes/${noteId}/reflection`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      })
      if (!res.ok) throw new Error()
      showToast('Reflexión añadida.')
      onSuccess()
    } catch {
      showToast('No se pudo añadir la reflexión.')
    }
  }

  // ── Resurgence refresh ──────────────────────────────────────────────────────
  // ponytail: random refresh via re-fetch; could be cached client-side.

  async function handleResurgenceRefresh() {
    const res = await fetch('/api/today')
    if (!res.ok) return
    const { resurgenceNote: rn } = await res.json()
    setResurgenceNote(rn ?? null)
  }

  // ── Render ───────────────────────────────────────────────────────────────────

  if (loading) return <Skeleton />

  const now = new Date()
  const hour = now.getHours()
  const greeting = getGreeting(hour)
  const dateStr = formatDateSpanish(now)

  return (
    <>
      {/* Header */}
      <div className="mb-2">
        <p className="text-[10px] tracking-[0.2em] text-[#A68966] uppercase font-semibold">HOY</p>
        <h1 className="font-serif text-4xl text-[#E3E2E2] mt-1">
          {greeting}, {displayName}.
        </h1>
        <p className="text-sm text-[#5A5A5A] mt-0.5">{dateStr}</p>
      </div>

      {/* Error state */}
      {error && (
        <div className="mt-6 border border-graphite-border bg-graphite-card px-4 py-3 flex items-center justify-between">
          <p className="text-sm text-[#E3E2E2]">{error}</p>
          <button
            onClick={() => window.location.reload()}
            className="text-[10px] tracking-widest text-[#A68966] uppercase hover:underline"
          >
            Reintentar
          </button>
        </div>
      )}

      {/* Focus Widget */}
      <div className="mt-8">
        <p className="text-[10px] tracking-[0.2em] text-[#A68966] uppercase mb-3">ENFOQUE</p>
        <div
          className="border border-graphite-border border-t border-t-[#A68966]/40 bg-gradient-to-b from-graphite-card to-graphite min-h-[120px] px-6 py-5 relative"
          style={!focusTask ? { animation: 'pulse-border 2s ease-in-out infinite' } : undefined}
        >
          {focusTask ? (
            <>
              <h2 className="font-serif text-2xl text-[#E3E2E2] leading-snug">{focusTask.title}</h2>
              <button
                onClick={handleReleaseFocus}
                className="mt-3 text-[11px] text-[#A68966] hover:underline"
              >
                Quitar enfoque
              </button>
            </>
          ) : (
            <p className="text-[#5A5A5A] text-sm italic leading-relaxed">
              Sin enfoque activo. Marcá una tarea para entrar en deep work.
            </p>
          )}
        </div>
      </div>

      {/* Inbox — GTD capture processing queue */}
      <InboxSection showToast={showToast} />

      {/* Today's Tasks */}
      <div className="mt-10">
        <p className="text-[10px] tracking-[0.2em] text-[#A68966] uppercase mb-4">TAREAS DE HOY</p>

        {todayTasks.length === 0 ? (
          <p className="text-[#5A5A5A] text-sm">Nada pendiente. Capturá algo con ⌘K.</p>
        ) : (
          <div className="space-y-2">
            {todayTasks
              .filter((task) => !focusTask || task.id !== focusTask.id)
              .map((task) => {
              const isPending = '_pending' in task
              const isDone = !isPending && task.status === 'DONE'

              return (
                <div
                  key={task.id}
                  className={`flex items-start gap-3 border border-graphite-border bg-graphite-card px-4 py-3 group transition-opacity duration-200 ${isDone ? 'opacity-30' : 'opacity-100'}`}
                >
                  {/* Checkbox */}
                  {!isPending && (
                    <CheckIcon checked={isDone} onChange={() => handleCheck(task)} />
                  )}
                  {isPending && (
                    <div className="w-5 h-5 flex items-center justify-center flex-shrink-0">
                      <span className="w-1.5 h-1.5 rounded-full bg-[#A68966] animate-pulse-dot" />
                    </div>
                  )}

                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    <p
                      className={`text-sm leading-snug transition-all duration-150 ${isDone ? 'line-through text-[#5A5A5A]' : 'text-[#E3E2E2]'}`}
                    >
                      {task.title}
                    </p>
                    {isPending && (
                      <p className="text-[10px] text-[#5A5A5A] mt-0.5">Procesando...</p>
                    )}
                  </div>

                  {/* Important star */}
                  {!isPending && task.isImportant && <StarIcon filled />}

                  {/* Focus button — only for real, non-done, non-focus tasks */}
                  {!isPending && !isDone && focusTask?.id !== task.id && (
                    <button
                      onClick={() => handleFocus(task)}
                      className="opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0 focus:opacity-100 focus:outline-none"
                      aria-label="Hacer foco en esta tarea"
                    >
                      <FocusIcon />
                    </button>
                  )}

                  {/* Spacer for pending rows so the "Procesando..." label inside the content column stays right-aligned */}
                  {isPending && <span className="w-4 flex-shrink-0" />}
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Maintenance Console */}
      {maintenanceTasks.length > 0 && (
        <div className="mt-12">
          <p className="text-[10px] tracking-[0.2em] text-[#5A5A5A] uppercase font-normal mb-3">
            Consola de Mantenimiento
          </p>
          <div className="space-y-2">
            {maintenanceTasks.map((task) => {
              const isUndated = task.dueDate === null
              return (
                <div
                  key={task.id}
                  className="flex items-center gap-3 border border-graphite-border bg-graphite-card px-3 py-2"
                >
                  <CheckIcon checked={false} onChange={() => handleMaintCheck(task)} />
                  <span className="flex-1 min-w-0 truncate text-[12px] text-[#7A7A7A] italic">
                    {task.title}
                  </span>
                  <span
                    className={`text-[9px] uppercase tracking-widest px-1.5 py-0.5 border ${
                      isUndated
                        ? 'border-graphite-border text-[#5A5A5A]'
                        : 'border-[#A68966]/30 text-[#A68966]/70'
                    }`}
                  >
                    {isUndated ? 'Sin fecha' : 'Atrasada'}
                  </span>
                  <div className="flex items-center gap-1.5 flex-shrink-0">
                    <button
                      onClick={() => handleMaintHoy(task)}
                      className="text-[10px] uppercase tracking-wider px-2 py-1 border border-graphite-border text-[#7A7A7A] hover:border-[#A68966]/40 hover:text-[#A68966] transition-colors"
                    >
                      Hoy
                    </button>
                    <button
                      onClick={() => handleMaintManana(task)}
                      className="text-[10px] uppercase tracking-wider px-2 py-1 border border-graphite-border text-[#7A7A7A] hover:border-[#A68966]/40 hover:text-[#A68966] transition-colors"
                    >
                      Mañana
                    </button>
                    <button
                      onClick={() => handleMaintBacklog(task)}
                      className="text-[10px] uppercase tracking-wider px-2 py-1 border border-graphite-border text-[#7A7A7A] hover:border-[#A68966]/40 hover:text-[#A68966] transition-colors"
                    >
                      Al Backlog
                    </button>
                    <button
                      onClick={() => handleMaintDejarAqui(task)}
                      className="text-[10px] uppercase tracking-wider px-2 py-1 border border-graphite-border text-[#7A7A7A] hover:border-[#A68966]/40 hover:text-[#A68966] transition-colors"
                    >
                      Dejar aquí
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Habits Widget */}
      {habits.length > 0 && (
        <div className="mt-12">
          <p className="text-[10px] tracking-[0.2em] text-[#A68966] uppercase mb-4">HÁBITOS DE HOY</p>
          <div className="flex flex-wrap gap-3">
            {habits.map((habit) => {
              const words = habit.name.trim().split(/\s+/)
              const initials =
                words.length >= 2
                  ? (words[0][0] + words[1][0]).toUpperCase()
                  : habit.name.slice(0, 2).toUpperCase()
              return (
                <button
                  key={habit.id}
                  onClick={() => handleHabitToggle(habit)}
                  className={[
                    'w-10 h-10 rounded-full flex items-center justify-center text-xs font-medium transition-all duration-150',
                    habit.completedToday
                      ? 'bg-[#A68966] border border-[#A68966] text-black'
                      : 'bg-graphite-card border border-[#2A2A2D] text-[#A1A1AA] hover:border-[#A68966]/40 hover:text-[#E3E2E2]',
                  ].join(' ')}
                  aria-label={habit.completedToday ? `Desmarcar ${habit.name}` : `Completar ${habit.name}`}
                >
                  {initials}
                </button>
              )
            })}
          </div>
        </div>
      )}

      {/* Subscription Prompt */}
      {dueSubscription && (
        <div className="mt-12">
          <p className="text-[10px] tracking-[0.2em] text-[#A68966] uppercase mb-3">
            SUBSCRIPCIÓN DE HOY
          </p>
          <div className="border border-graphite-border bg-graphite-card px-4 py-3 flex items-center justify-between">
            <p className="text-sm text-[#E3E2E2]">
              ¿Te han cobrado hoy {dueSubscription.name} ({dueSubscription.amount}€)?
            </p>
            <div className="flex items-center gap-2 ml-4 flex-shrink-0">
              <button
                onClick={() => handleSubscriptionConfirm(dueSubscription.id, true)}
                className="text-[10px] uppercase tracking-wider px-3 py-1.5 border border-graphite-border text-[#7A7A7A] hover:border-[#A68966]/40 hover:text-[#A68966] transition-colors"
              >
                Sí
              </button>
              <button
                onClick={() => handleSubscriptionConfirm(dueSubscription.id, false)}
                className="text-[10px] uppercase tracking-wider px-3 py-1.5 border border-graphite-border text-[#7A7A7A] hover:border-[#A68966]/40 hover:text-[#A68966] transition-colors"
              >
                No
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Resurgence Card */}
      {resurgenceNote && (
        <div className="mt-12">
          <p className="text-[10px] tracking-[0.2em] text-[#A68966] uppercase mb-3">DEL PASADO</p>
          <div className="border border-graphite-border bg-graphite-card px-4 py-4 relative">
            <button
              onClick={handleResurgenceRefresh}
              className="absolute top-3 right-3 text-[#5A5A5A] hover:text-[#A68966] transition-colors"
              aria-label="Refrescar nota"
            >
              <svg viewBox="0 0 16 16" className="w-4 h-4">
                <path
                  d="M2 8a6 6 0 1 1 1.5 4M2 8V4m0 4H6"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
            <h3 className="font-serif text-lg text-[#E3E2E2]">{resurgenceNote.title}</h3>
            <p className="text-xs text-[#5A5A5A] mt-1 mb-3">
              {resurgenceNote.content.replace(/\n/g, ' ').slice(0, 200)}
              {resurgenceNote.content.length > 200 ? '…' : ''}
            </p>
            <ReflectionForm noteId={resurgenceNote.id} onSubmit={handleReflection} />
          </div>
        </div>
      )}

      {/* Toast */}
      {toast && <Toast message={toast.message} href={toast.href} onDismiss={() => setToast(null)} />}
    </>
  )
}
