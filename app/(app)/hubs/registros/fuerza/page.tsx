'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

// ─── Types ────────────────────────────────────────────────────────────────────

interface SetData {
  exerciseName: string
  weight: number
  reps: number
  setType: string
  estimated1RM: number | null
}

interface WorkoutData {
  id: string
  title: string
  date: string
  duration: string | null
  volume: number
  sets: SetData[]
}

interface VolumeEntry {
  date: string
  volume: number
}

interface PersonalRecord {
  exerciseName: string
  maxWeight: number
  maxReps: number
  max1RM: number
  achievedAt: string
}

interface StrengthMetrics {
  workouts: WorkoutData[]
  volumeHistory: VolumeEntry[]
  personalRecords: PersonalRecord[]
  coachAdvice: string | null
}

// ─── Dumbbell Icon ─────────────────────────────────────────────────────────────

function DumbbellIcon({ size = 24 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="#A68966"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {/* Left weight plate */}
      <rect x="2" y="9" width="3" height="6" rx="0.5" />
      <rect x="5" y="7" width="2" height="10" rx="0.5" />
      {/* Bar */}
      <line x1="7" y1="12" x2="17" y2="12" />
      {/* Right weight plate */}
      <rect x="17" y="7" width="2" height="10" rx="0.5" />
      <rect x="19" y="9" width="3" height="6" rx="0.5" />
    </svg>
  )
}

// ─── Upload Icon ──────────────────────────────────────────────────────────────

function UploadIcon({ size = 16 }: { size?: number }) {
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
      <polyline points="16,16 12,12 8,16" />
      <line x1="12" y1="12" x2="12" y2="21" />
      <path d="M20.39 18.39A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.3" />
    </svg>
  )
}

// ─── Volume Chart (inline SVG) ────────────────────────────────────────────────

function VolumeChart({ data }: { data: VolumeEntry[] }) {
  if (data.length === 0) {
    return (
      <div className="text-[#5A5A5A] text-xs italic text-center py-8">
        Sin datos de volumen aún.
      </div>
    )
  }

  const W = 600
  const H = 220
  const PAD_L = 48
  const PAD_R = 16
  const PAD_T = 16
  const PAD_B = 32

  const volumes = data.map((d) => d.volume)
  const minV = 0
  const maxV = Math.max(...volumes) * 1.1

  const xScale = (i: number) => PAD_L + (i / (data.length - 1 || 1)) * (W - PAD_L - PAD_R)
  const yScale = (v: number) => PAD_T + (1 - (v - minV) / (maxV - minV || 1)) * (H - PAD_T - PAD_B)

  // Build SVG path
  const points = data.map((d, i) => `${xScale(i)},${yScale(d.volume)}`)
  const linePath = `M ${points.join(' L ')}`
  const areaPath = `${linePath} L ${xScale(data.length - 1)},${H - PAD_B} L ${xScale(0)},${H - PAD_B} Z`

  // X-axis labels (show every N labels to avoid crowding)
  const labelEvery = Math.max(1, Math.floor(data.length / 6))
  const xLabels = data
    .filter((_, i) => i % labelEvery === 0 || i === data.length - 1)
    .map((d, _, arr) => {
      const idx = data.findIndex((x) => x.date === d.date)
      return { date: d.date, x: xScale(idx) }
    })

  // Y-axis ticks
  const yTicks = 4
  const yLabels = Array.from({ length: yTicks + 1 }, (_, i) => {
    const v = minV + ((maxV - minV) * i) / yTicks
    return { v: Math.round(v), y: yScale(v) }
  })

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ maxHeight: 280 }}>
      {/* Grid lines */}
      {yLabels.map(({ v, y }) => (
        <line
          key={v}
          x1={PAD_L}
          x2={W - PAD_R}
          y1={y}
          y2={y}
          stroke="#1C1C1F"
          strokeWidth={1}
        />
      ))}

      {/* Area fill */}
      <path d={areaPath} fill="#A68966" fillOpacity={0.08} />

      {/* Line */}
      <path d={linePath} fill="none" stroke="#A68966" strokeWidth={1.5} />

      {/* Data points */}
      {data.map((d, i) => (
        <circle
          key={i}
          cx={xScale(i)}
          cy={yScale(d.volume)}
          r={2.5}
          fill="#A68966"
        />
      ))}

      {/* X labels */}
      {xLabels.map(({ date, x }) => (
        <text
          key={date}
          x={x}
          y={H - 6}
          textAnchor="middle"
          fontSize={10}
          fill="#5A5A5A"
        >
          {date.substring(5)}
        </text>
      ))}

      {/* Y labels */}
      {yLabels.map(({ v, y }) => (
        <text
          key={v}
          x={PAD_L - 6}
          y={y + 4}
          textAnchor="end"
          fontSize={10}
          fill="#5A5A5A"
        >
          {v >= 1000 ? `${(v / 1000).toFixed(1)}k` : v}
        </text>
      ))}

      {/* Axis */}
      <line x1={PAD_L} x2={PAD_L} y1={PAD_T} y2={H - PAD_B} stroke="#1C1C1F" strokeWidth={1} />
      <line x1={PAD_L} x2={W - PAD_R} y1={H - PAD_B} y2={H - PAD_B} stroke="#1C1C1F" strokeWidth={1} />
    </svg>
  )
}

// ─── 1RM Evolution Chart ───────────────────────────────────────────────────────

function OneRMChart({
  data,
  exercise,
  workouts,
}: {
  data: VolumeEntry[]
  exercise: string
  workouts: WorkoutData[]
}) {
  if (!exercise || workouts.length === 0) {
    return (
      <div className="text-[#5A5A5A] text-xs italic text-center py-8">
        Seleccioná un ejercicio para ver la evolución.
      </div>
    )
  }

  const W = 600
  const H = 220
  const PAD_L = 48
  const PAD_R = 16
  const PAD_T = 16
  const PAD_B = 32

  // Build per-workout max 1RM for selected exercise
  const points: { date: string; x: number; y: number; e1rm: number }[] = []
  let maxE1RM = 0

  workouts.forEach((w, i) => {
    const eligibleSets = w.sets.filter(
      (s) =>
        s.exerciseName === exercise &&
        s.setType !== 'FAILURE_SET' &&
        s.setType !== 'DROPSET_SET' &&
        s.estimated1RM != null
    )
    if (eligibleSets.length === 0) return
    const maxE1rm = Math.max(...eligibleSets.map((s) => s.estimated1RM!))
    const x = PAD_L + (i / (workouts.length - 1 || 1)) * (W - PAD_L - PAD_R)
    const y = PAD_T + (1 - (maxE1rm - 0) / (maxE1RM * 1.1 || 1)) * (H - PAD_T - PAD_B)
    points.push({ date: w.date.substring(0, 10), x, y, e1rm: maxE1rm })
    if (maxE1rm > maxE1RM) maxE1RM = maxE1rm
  })

  if (points.length === 0) {
    return (
      <div className="text-[#5A5A5A] text-xs italic text-center py-8">
        Sin datos de 1RM para {exercise}.
      </div>
    )
  }

  const linePath = `M ${points.map((p) => `${p.x},${p.y}`).join(' L ')}`

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ maxHeight: 280 }}>
      {/* Grid lines */}
      {Array.from({ length: 4 }, (_, i) => {
        const y = PAD_T + ((i * (H - PAD_T - PAD_B)) / 3)
        return <line key={i} x1={PAD_L} x2={W - PAD_R} y1={y} y2={y} stroke="#1C1C1F" strokeWidth={1} />
      })}

      {/* Line */}
      <path d={linePath} fill="none" stroke="#A68966" strokeWidth={1.5} />

      {/* Points */}
      {points.map((p, i) => (
        <circle key={i} cx={p.x} cy={p.y} r={2.5} fill="#A68966" />
      ))}

      {/* Y labels */}
      {Array.from({ length: 4 }, (_, i) => {
        const v = ((3 - i) * maxE1RM * 1.1) / 3
        const y = PAD_T + (i * (H - PAD_T - PAD_B)) / 3
        return (
          <text key={i} x={PAD_L - 6} y={y + 4} textAnchor="end" fontSize={10} fill="#5A5A5A">
            {Math.round(v)}
          </text>
        )
      })}

      {/* Axis */}
      <line x1={PAD_L} x2={PAD_L} y1={PAD_T} y2={H - PAD_B} stroke="#1C1C1F" strokeWidth={1} />
      <line x1={PAD_L} x2={W - PAD_R} y1={H - PAD_B} y2={H - PAD_B} stroke="#1C1C1F" strokeWidth={1} />
    </svg>
  )
}

// ─── CSV Upload Zone ───────────────────────────────────────────────────────────

function CSVUpload({ onSuccess }: { onSuccess: () => void }) {
  const [status, setStatus] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const upload = useCallback(
    async (file: File) => {
      setStatus('uploading')
      const fd = new FormData()
      fd.append('file', file)
      try {
        const res = await fetch('/api/registros/fuerza/import', { method: 'POST', body: fd })
        const json = await res.json()
        if (!res.ok) throw new Error(json.error ?? 'Error en la importación')
        setStatus(`ok:${json.importedCount}:${json.message}`)
        setTimeout(onSuccess, 800)
      } catch (err) {
        setStatus(`error:${err instanceof Error ? err.message : 'Error desconocido'}`)
      }
    },
    [onSuccess]
  )

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      setDragging(false)
      const file = e.dataTransfer.files[0]
      if (file && file.name.endsWith('.csv')) upload(file)
      else setStatus('error:Solo se aceptan archivos .csv')
    },
    [upload]
  )

  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0]
      if (file) upload(file)
    },
    [upload]
  )

  const statusColor = status?.startsWith('ok')
    ? 'text-[#34D399]'
    : status?.startsWith('error')
    ? 'text-[#F87171]'
    : 'text-[#5A5A5A]'

  const statusText = status
    ? status.startsWith('ok')
      ? status.split(':')[2] ?? 'Importado'
      : status.split(':')[1] ?? status
    : null

  return (
    <div
      className={[
        'border border-dashed border-graphite-border rounded p-6 text-center cursor-pointer transition-colors',
        dragging ? 'border-[#A68966]/60 bg-[#A68966]/5' : 'hover:border-[#A68966]/40',
      ].join(' ')}
      onClick={() => inputRef.current?.click()}
      onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
      onDragLeave={() => setDragging(false)}
      onDrop={handleDrop}
    >
      <input
        ref={inputRef}
        type="file"
        accept=".csv"
        className="hidden"
        onChange={handleFileChange}
      />
      <div className="flex flex-col items-center gap-2">
        <UploadIcon size={20} />
        <p className="text-[#A1A1AA] text-xs">
          Arrastrá tu CSV de Hevy aquí o hacé click para seleccionar
        </p>
        {statusText && (
          <p className={`text-xs ${statusColor}`}>{statusText}</p>
        )}
      </div>
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function FuerzaPage() {
  const [metrics, setMetrics] = useState<StrengthMetrics | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedExercise, setSelectedExercise] = useState<string>('')

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/registros/fuerza')
      if (!res.ok) throw new Error('Error al cargar métricas')
      const json = await res.json()
      setMetrics(json)

      // Auto-select first exercise
      const exercises = Array.from(
        new Set(json.workouts.flatMap((w: WorkoutData) => w.sets.map((s) => s.exerciseName)))
      ).sort()
      if (exercises.length > 0 && !selectedExercise) {
        setSelectedExercise(exercises[0] as string)
      }
    } catch {
      setError('No se pudieron cargar las métricas de fuerza.')
    } finally {
      setLoading(false)
    }
  }, [selectedExercise])

  useEffect(() => {
    load()
  }, [load])

  const exercises = metrics
    ? Array.from(new Set(metrics.workouts.flatMap((w) => w.sets.map((s) => s.exerciseName)))).sort()
    : []

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-[#5A5A5A] text-sm animate-pulse">Cargando…</div>
      </div>
    )
  }

  if (error || !metrics) {
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
          <DumbbellIcon size={36} />
          <h1 className="font-serif text-3xl text-[#E3E2E2]">Fuerza</h1>
        </div>
        <div className="h-px bg-gradient-to-r from-[#A68966]/60 via-[#A68966]/20 to-transparent mt-4 mb-3" />
        <p className="text-[11px] tracking-[0.15em] uppercase text-[#5A5A5A]">
          {metrics.workouts.length} entrenamientos · {metrics.personalRecords.length} ejercicios con PR
        </p>
      </div>

      {/* AI Coach Widget */}
      <div className="border border-[#A68966]/40 bg-[#A68966]/5 px-5 py-4 rounded">
        {metrics.coachAdvice ? (
          <p className="text-[#E3E2E2] text-sm leading-relaxed">{metrics.coachAdvice}</p>
        ) : (
          <p className="text-[#5A5A5A] text-xs italic">
            Importa tus entrenamientos para recibir consejos personalizados.
          </p>
        )}
      </div>

      {/* CSV Upload */}
      <div>
        <h2 className="text-[10px] uppercase tracking-[0.15em] text-[#5A5A5A] mb-3">
          Importar desde Hevy
        </h2>
        <CSVUpload onSuccess={load} />
      </div>

      {/* Volume Chart */}
      <div>
        <h2 className="text-[10px] uppercase tracking-[0.15em] text-[#5A5A5A] mb-3">
          Volumen por entrenamiento
        </h2>
        <div className="border border-graphite-border bg-graphite-card p-4">
          <VolumeChart data={metrics.volumeHistory} />
        </div>
      </div>

      {/* 1RM Evolution */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-[10px] uppercase tracking-[0.15em] text-[#5A5A5A]">
            Evolución 1RM estimado
          </h2>
          <select
            value={selectedExercise}
            onChange={(e) => setSelectedExercise(e.target.value)}
            className="bg-graphite-card border border-graphite-border text-[#A1A1AA] text-xs px-2 py-1 rounded focus:outline-none focus:border-[#A68966]/50"
          >
            {exercises.map((ex) => (
              <option key={ex} value={ex}>
                {ex}
              </option>
            ))}
          </select>
        </div>
        <div className="border border-graphite-border bg-graphite-card p-4">
          <OneRMChart
            data={metrics.volumeHistory}
            exercise={selectedExercise}
            workouts={metrics.workouts}
          />
        </div>
      </div>

      {/* PR Table */}
      <div>
        <h2 className="text-[10px] uppercase tracking-[0.15em] text-[#5A5A5A] mb-3">
          Récords personales
        </h2>
        <div className="border border-graphite-border bg-graphite-card overflow-hidden">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-graphite-border">
                <th className="text-left px-4 py-2 text-[10px] uppercase tracking-wider text-[#5A5A5A] font-normal">
                  Ejercicio
                </th>
                <th className="text-right px-4 py-2 text-[10px] uppercase tracking-wider text-[#5A5A5A] font-normal">
                  Peso máx
                </th>
                <th className="text-right px-4 py-2 text-[10px] uppercase tracking-wider text-[#5A5A5A] font-normal">
                  Reps máx
                </th>
                <th className="text-right px-4 py-2 text-[10px] uppercase tracking-wider text-[#5A5A5A] font-normal">
                  1RM est.
                </th>
                <th className="text-right px-4 py-2 text-[10px] uppercase tracking-wider text-[#5A5A5A] font-normal">
                  Fecha
                </th>
              </tr>
            </thead>
            <tbody>
              {metrics.personalRecords.map((pr) => (
                <tr
                  key={pr.exerciseName}
                  className="border-b border-graphite-border last:border-0 hover:bg-[#A68966]/5 transition-colors"
                >
                  <td className="px-4 py-3 text-[#E3E2E2] font-serif">{pr.exerciseName}</td>
                  <td className="px-4 py-3 text-right text-[#A1A1AA]">{pr.maxWeight} kg</td>
                  <td className="px-4 py-3 text-right text-[#A1A1AA]">{pr.maxReps}</td>
                  <td className="px-4 py-3 text-right text-[#A68966] font-medium">
                    {pr.max1RM.toFixed(1)} kg
                  </td>
                  <td className="px-4 py-3 text-right text-[#5A5A5A]">{pr.achievedAt}</td>
                </tr>
              ))}
              {metrics.personalRecords.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-6 text-center text-[#5A5A5A] text-xs italic">
                    Sin récords todavía.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
