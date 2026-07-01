'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'

// ─── Types ───────────────────────────────────────────────────────────────────

interface Habit {
  id: string
  name: string
  frequency: string
  streak: number
  logs: string[]
}

interface HabitsData {
  habits: Habit[]
}

// ─── Constants ───────────────────────────────────────────────────────────────

const HEATMAP_DAYS = 84 // 12 weeks
const COLS = 12
const ROWS = 7

const COLORS = {
  empty: '#1C1C1F',
  done: '#34D399',
  doneToday: '#A68966',
} as const

// ─── Date helpers ────────────────────────────────────────────────────────────

function dayKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function addDays(d: Date, n: number): Date {
  const out = new Date(d)
  out.setDate(out.getDate() + n)
  return out
}

// ─── Icons ───────────────────────────────────────────────────────────────────

function FlameIcon({ size = 32 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="#A68966"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M8.5 14.5A2.5 2.5 0 0 0 11 17c1.5 0 3-1 3-3.5 0-1.5-1-2.5-2-3.5 0-2-1-3.5-1-5.5C8 6 6 8 6 11.5 6 13 7 14 8.5 14.5z" />
      <path d="M12 22a7 7 0 0 0 7-7c0-2-1-3.5-2-4.5 0 1.5-1 2.5-2 2.5" />
    </svg>
  )
}

function TrashIcon({ size = 14 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <polyline points="3,6 5,6 21,6" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      <line x1="10" y1="11" x2="10" y2="17" />
      <line x1="14" y1="11" x2="14" y2="17" />
    </svg>
  )
}

// ─── Streak calc (mirrors server) ────────────────────────────────────────────

function calcStreak(logs: Set<string>): number {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const yesterday = addDays(today, -1)

  let cursor: Date
  if (logs.has(dayKey(today))) cursor = today
  else if (logs.has(dayKey(yesterday))) cursor = yesterday
  else return 0

  let streak = 0
  while (logs.has(dayKey(cursor))) {
    streak++
    cursor = addDays(cursor, -1)
  }
  return streak
}

// ─── Heatmap ─────────────────────────────────────────────────────────────────

function Heatmap({ logs }: { logs: string[] }) {
  const logSet = useMemo(() => new Set(logs), [logs])
  const today = useMemo(() => {
    const d = new Date()
    d.setHours(0, 0, 0, 0)
    return d
  }, [])

  const todayKey = dayKey(today)
  // Oldest cell = today - 83 days. Newest cell = today.
  const cells = useMemo(() => {
    return Array.from({ length: HEATMAP_DAYS }, (_, i) => {
      const date = addDays(today, -(HEATMAP_DAYS - 1 - i))
      const key = dayKey(date)
      const completed = logSet.has(key)
      const isToday = key === todayKey
      const color = completed ? (isToday ? COLORS.doneToday : COLORS.done) : COLORS.empty
      const formatted = date.toLocaleDateString('es-AR', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
      })
      const status = completed ? '✓ Completado' : 'Sin completar'
      return { key, color, title: `${formatted} · ${status}` }
    })
  }, [logSet, today, todayKey])

  return (
    <div
      className="grid gap-[2px]"
      style={{
        gridTemplateColumns: `repeat(${COLS}, 12px)`,
        gridTemplateRows: `repeat(${ROWS}, 12px)`,
      }}
    >
      {cells.map((c) => (
        <div
          key={c.key}
          title={c.title}
          className="rounded-[2px] transition-colors"
          style={{ backgroundColor: c.color, width: 12, height: 12 }}
        />
      ))}
    </div>
  )
}

// ─── Habit Card ──────────────────────────────────────────────────────────────

function HabitCard({
  habit,
  onToggle,
  onDelete,
}: {
  habit: Habit
  onToggle: (id: string) => void
  onDelete: (id: string) => void
}) {
  const logSet = useMemo(() => new Set(habit.logs), [habit.logs])
  const todayKey = useMemo(() => {
    const d = new Date()
    d.setHours(0, 0, 0, 0)
    return dayKey(d)
  }, [])
  const completedToday = logSet.has(todayKey)
  const streak = useMemo(() => calcStreak(logSet), [logSet])

  return (
    <div className="border border-graphite-border bg-graphite-card p-5 space-y-5">
      {/* Title row */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <h3 className="font-serif text-[#E3E2E2] text-lg leading-snug truncate">
            {habit.name}
          </h3>
          <p className="text-[11px] tracking-[0.1em] uppercase text-[#5A5A5A] mt-1">
            {habit.frequency}
          </p>
        </div>
        <button
          onClick={() => onDelete(habit.id)}
          className="text-[#5A5A5A] hover:text-[#F87171] transition-colors p-1 -mt-1"
          title="Eliminar hábito"
        >
          <TrashIcon size={14} />
        </button>
      </div>

      {/* Streak indicator */}
      <div className="flex items-baseline gap-2">
        <span
          className={`font-serif text-2xl ${streak > 0 ? 'text-[#A68966]' : 'text-[#5A5A5A]'}`}
        >
          {streak}
        </span>
        <span className="text-[11px] tracking-[0.1em] uppercase text-[#5A5A5A]">
          {streak === 0
            ? 'Sin racha'
            : streak === 1
              ? 'día seguido 🔥'
              : 'días seguidos 🔥'}
        </span>
      </div>

      {/* Heatmap */}
      <Heatmap logs={habit.logs} />

      {/* Quick toggle */}
      <button
        onClick={() => onToggle(habit.id)}
        className={`w-full border text-xs uppercase tracking-wider py-2 rounded transition-colors ${
          completedToday
            ? 'border-[#34D399]/60 text-[#34D399] bg-[#34D399]/5 hover:bg-[#34D399]/10'
            : 'border-graphite-border text-[#A1A1AA] hover:border-[#A68966]/50 hover:text-[#A68966]'
        }`}
      >
        {completedToday ? '✓ Completado hoy' : 'Marcar hoy'}
      </button>
    </div>
  )
}

// ─── Add Habit Form ───────────────────────────────────────────────────────────

function AddHabitForm({ onSuccess }: { onSuccess: () => void }) {
  const [name, setName] = useState('')
  const [frequency, setFrequency] = useState('DAILY')
  const [status, setStatus] = useState<string | null>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setStatus(null)
    if (!name.trim()) {
      setStatus('error:El nombre es requerido')
      return
    }
    try {
      const res = await fetch('/api/registros/habitos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), frequency }),
      })
      if (!res.ok) {
        const json = await res.json()
        throw new Error(json.error ?? 'Error al crear')
      }
      setName('')
      setFrequency('DAILY')
      setStatus('ok:Hábito creado')
      setTimeout(onSuccess, 400)
    } catch (err) {
      setStatus(`error:${err instanceof Error ? err.message : 'Error'}`)
    }
  }

  const statusColor = status?.startsWith('ok')
    ? 'text-[#34D399]'
    : status?.startsWith('error')
      ? 'text-[#F87171]'
      : ''
  const statusText = status?.startsWith('ok')
    ? status.split(':')[1]
    : status?.startsWith('error')
      ? status.split(':')[1]
      : null

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <h3 className="text-[10px] uppercase tracking-[0.15em] text-[#5A5A5A]">
        Nuevo hábito
      </h3>
      <div className="flex gap-2">
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Ej. Meditar 10 min"
          className="flex-1 bg-graphite-card border border-graphite-border text-[#E3E2E2] text-sm px-3 py-2 rounded focus:outline-none focus:border-[#A68966]/50 placeholder-[#5A5A5A]"
        />
        <select
          value={frequency}
          onChange={(e) => setFrequency(e.target.value)}
          className="w-32 bg-graphite-card border border-graphite-border text-[#A1A1AA] text-sm px-3 py-2 rounded focus:outline-none focus:border-[#A68966]/50"
        >
          <option value="DAILY">Diario</option>
          <option value="WEEKLY">Semanal</option>
          <option value="MONTHLY">Mensual</option>
        </select>
      </div>
      <button
        type="submit"
        className="w-full border border-[#A68966]/50 text-[#A68966] text-xs uppercase tracking-wider py-2 rounded hover:bg-[#A68966]/10 transition-colors"
      >
        Agregar hábito
      </button>
      {statusText && <p className={`text-xs ${statusColor} text-center`}>{statusText}</p>}
    </form>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function HabitosPage() {
  const [data, setData] = useState<HabitsData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/registros/habitos')
      if (!res.ok) throw new Error('Error al cargar')
      const json = await res.json()
      setData(json)
    } catch {
      setError('No se pudieron cargar los hábitos.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    // ponytail: standard fetch-on-mount pattern; rule is too aggressive here.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load()
  }, [load])

  // Optimistic toggle — flip today's log locally, call API, revert on failure.
  const handleToggle = useCallback(
    async (id: string) => {
      setData((prev) => {
        if (!prev) return prev
        const today = new Date()
        today.setHours(0, 0, 0, 0)
        const todayKey = dayKey(today)
        return {
          habits: prev.habits.map((h) => {
            if (h.id !== id) return h
            const logSet = new Set(h.logs)
            const wasDone = logSet.has(todayKey)
            if (wasDone) logSet.delete(todayKey)
            else logSet.add(todayKey)
            const logs = Array.from(logSet)
            return { ...h, logs, streak: calcStreak(logSet) }
          }),
        }
      })

      try {
        const res = await fetch(`/api/habits/${id}/log`, { method: 'POST' })
        if (!res.ok) {
          // Revert by reloading authoritative state
          load()
        }
      } catch {
        load()
      }
    },
    [load]
  )

  const handleDelete = useCallback(
    async (id: string) => {
      // Optimistic remove
      setData((prev) =>
        prev ? { habits: prev.habits.filter((h) => h.id !== id) } : prev
      )
      try {
        const res = await fetch(`/api/registros/habitos/${id}`, { method: 'DELETE' })
        if (!res.ok && res.status !== 204) {
          load()
        }
      } catch {
        load()
      }
    },
    [load]
  )

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-[#5A5A5A] text-sm animate-pulse">Cargando…</div>
      </div>
    )
  }

  if (error || !data) {
    return (
      <div className="border border-graphite-border bg-graphite-card px-4 py-3 text-sm text-[#E3E2E2]">
        {error ?? 'Error desconocido.'}
      </div>
    )
  }

  return (
    <div className="space-y-10">
      {/* Header */}
      <div>
        <div className="flex items-center gap-3 mb-2">
          <FlameIcon size={36} />
          <h1 className="font-serif text-3xl text-[#E3E2E2]">Hábitos</h1>
        </div>
        <div className="h-px bg-gradient-to-r from-[#A68966]/60 via-[#A68966]/20 to-transparent mt-4 mb-3" />
        <p className="text-[11px] tracking-[0.15em] uppercase text-[#5A5A5A]">
          {data.habits.length === 0
            ? 'Sin hábitos registrados'
            : `${data.habits.length} hábito${data.habits.length !== 1 ? 's' : ''} en seguimiento`}
        </p>
      </div>

      {/* Add habit form */}
      <div className="border border-graphite-border bg-graphite-card p-5 max-w-xl">
        <AddHabitForm onSuccess={load} />
      </div>

      {/* Habits grid */}
      {data.habits.length === 0 ? (
        <p className="text-[#5A5A5A] text-sm italic">
          Creá tu primer hábito arriba para empezar a registrar tu racha.
        </p>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {data.habits.map((habit) => (
            <HabitCard
              key={habit.id}
              habit={habit}
              onToggle={handleToggle}
              onDelete={handleDelete}
            />
          ))}
        </div>
      )}
    </div>
  )
}