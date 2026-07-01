'use client'

import { useCallback, useEffect, useState } from 'react'

// ─── Types ───────────────────────────────────────────────────────────────────

interface Transaction {
  id: string
  amount: number
  description: string
  date: string
  category: string
}

interface CategoryDistribution {
  category: string
  sum: number
  percentage: number
}

interface Subscription {
  id: string
  name: string
  amount: number
  dayOfMonth: number
}

interface FinanzasData {
  transactions: Transaction[]
  totalIncome: number
  totalExpenses: number
  netBalance: number
  categoryDistribution: CategoryDistribution[]
  subscriptions: Subscription[]
  startOfCycle: string
}

// ─── Constants ───────────────────────────────────────────────────────────────

const CATEGORY_COLORS: Record<string, string> = {
  'GASTOS FIJOS': '#A68966',
  'ALIMENTACIÓN': '#6B8E9B',
  'OCIO': '#9B6B8E',
  'TRANSPORTE': '#8E9B6B',
  'INVERSIÓN': '#8E6B9B',
}

const CATEGORY_LABELS: Record<string, string> = {
  'GASTOS FIJOS': 'Gastos Fijos',
  'ALIMENTACIÓN': 'Alimentación',
  'OCIO': 'Ocio',
  'TRANSPORTE': 'Transporte',
  'INVERSIÓN': 'Inversión',
}

// ─── Icons ───────────────────────────────────────────────────────────────────

function WalletIcon({ size = 24 }: { size?: number }) {
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
      <path d="M21 12V7H5a2 2 0 0 1 0-4h14v4" />
      <path d="M3 5v14a2 2 0 0 0 2 2h16v-5" />
      <path d="M18 12a2 2 0 0 0 0 4h4v-4h-4Z" />
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

// ─── Circular Chart ───────────────────────────────────────────────────────────

function CircularChart({ data }: { data: CategoryDistribution[] }) {
  const SIZE = 180
  const CX = SIZE / 2
  const CY = SIZE / 2
  const R = 70
  const INNER_R = 45

  if (data.length === 0 || data.every((d) => d.sum === 0)) {
    return (
      <div className="flex flex-col items-center justify-center" style={{ minHeight: SIZE }}>
        <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`}>
          <circle cx={CX} cy={CY} r={R} fill="none" stroke="#1C1C1F" strokeWidth="20" />
          <circle cx={CX} cy={CY} r={INNER_R} fill="#0D0D0F" />
        </svg>
        <p className="text-[#5A5A5A] text-xs italic mt-4">Sin gastos registrados</p>
      </div>
    )
  }

  let currentAngle = -90 // Start at top

  const segments = data.map((entry) => {
    const angle = (entry.percentage / 100) * 360
    const startAngle = currentAngle
    const endAngle = currentAngle + angle
    currentAngle = endAngle

    const startRad = (startAngle * Math.PI) / 180
    const endRad = (endAngle * Math.PI) / 180

    const x1 = CX + R * Math.cos(startRad)
    const y1 = CY + R * Math.sin(startRad)
    const x2 = CX + R * Math.cos(endRad)
    const y2 = CY + R * Math.sin(endRad)

    const largeArc = angle > 180 ? 1 : 0

    const pathData =
      angle >= 359.9
        ? `M ${CX} ${CY - R} A ${R} ${R} 0 1 1 ${CX - 0.01} ${CY - R} Z`
        : `M ${CX} ${CY - R} A ${R} ${R} 0 ${largeArc} 1 ${x2} ${y2} Z`

    return {
      ...entry,
      pathData,
      color: CATEGORY_COLORS[entry.category.toUpperCase()] ?? '#5A5A5A',
    }
  })

  return (
    <div className="flex flex-col items-center gap-4">
      <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`}>
        {segments.map((seg, i) => (
          <path key={i} d={seg.pathData} fill={seg.color} fillOpacity={0.85} />
        ))}
        <circle cx={CX} cy={CY} r={INNER_R} fill="#0D0D0F" />
        <text
          x={CX}
          y={CY - 6}
          textAnchor="middle"
          dominantBaseline="middle"
          fill="#E3E2E2"
          fontSize="18"
          fontFamily="serif"
        >
          {data.length > 0
            ? data.reduce((acc, d) => acc + d.sum, 0).toLocaleString('es-AR', {
                style: 'currency',
                currency: 'ARS',
                minimumFractionDigits: 0,
                maximumFractionDigits: 0,
              })
            : '$0'}
        </text>
        <text x={CX} y={CY + 14} textAnchor="middle" fill="#5A5A5A" fontSize="9" letterSpacing="0.1em">
          GASTOS
        </text>
      </svg>

      {/* Legend */}
      <div className="flex flex-col gap-1.5 w-full px-2">
        {data.map((entry) => (
          <div key={entry.category} className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div
                className="w-2 h-2 rounded-full"
                style={{ backgroundColor: CATEGORY_COLORS[entry.category.toUpperCase()] ?? '#5A5A5A' }}
              />
              <span className="text-[11px] text-[#A1A1AA]">
                {CATEGORY_LABELS[entry.category.toUpperCase()] ?? entry.category}
              </span>
            </div>
            <span className="text-[11px] text-[#5A5A5A]">{entry.percentage}%</span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── Balance Callout ──────────────────────────────────────────────────────────

function BalanceCallout({
  netBalance,
  totalIncome,
  totalExpenses,
  startOfCycle,
}: {
  netBalance: number
  totalIncome: number
  totalExpenses: number
  startOfCycle: string
}) {
  const formatCurrency = (n: number) =>
    n.toLocaleString('es-AR', {
      style: 'currency',
      currency: 'ARS',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    })

  const startDate = new Date(startOfCycle).toLocaleDateString('es-AR', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })

  const isPositive = netBalance >= 0

  return (
    <div className="border border-[#A68966]/30 bg-[#A68966]/5 px-6 py-5 rounded">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <WalletIcon size={32} />
          <div>
            <p className="text-[10px] tracking-[0.15em] uppercase text-[#5A5A5A]">Balance del ciclo</p>
            <p className="text-[10px] text-[#5A5A5A] mt-0.5">Desde {startDate}</p>
          </div>
        </div>
        <div
          className={`font-serif text-3xl ${isPositive ? 'text-[#34D399]' : 'text-[#F87171]'}`}
        >
          {formatCurrency(netBalance)}
        </div>
      </div>

      <div className="h-px bg-[#1C1C1F] mb-4" />

      <div className="flex gap-8">
        <div>
          <p className="text-[10px] uppercase tracking-wider text-[#5A5A5A]">Ingresos</p>
          <p className="text-[#34D399] text-lg font-serif mt-0.5">{formatCurrency(totalIncome)}</p>
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-wider text-[#5A5A5A]">Gastos</p>
          <p className="text-[#F87171] text-lg font-serif mt-0.5">{formatCurrency(totalExpenses)}</p>
        </div>
      </div>
    </div>
  )
}

// ─── Quick Add Transaction ────────────────────────────────────────────────────

function QuickAddTransaction({ onSuccess }: { onSuccess: () => void }) {
  const [amount, setAmount] = useState('')
  const [description, setDescription] = useState('')
  const [date, setDate] = useState(new Date().toISOString().split('T')[0])
  const [category, setCategory] = useState('GASTOS FIJOS')
  const [isIncome, setIsIncome] = useState(false)
  const [status, setStatus] = useState<string | null>(null)

  const categories = Object.keys(CATEGORY_LABELS)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setStatus(null)

    const numAmount = parseFloat(amount)
    if (isNaN(numAmount) || numAmount <= 0) {
      setStatus('error:El importe debe ser un número positivo')
      return
    }

    try {
      const res = await fetch('/api/registros/finanzas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amount: isIncome ? numAmount : -numAmount,
          description: description.trim() || (isIncome ? 'Ingreso' : 'Gasto'),
          date,
          category,
        }),
      })

      if (!res.ok) {
        const json = await res.json()
        throw new Error(json.error ?? 'Error al registrar')
      }

      setAmount('')
      setDescription('')
      setDate(new Date().toISOString().split('T')[0])
      setStatus('ok:Transacción registrada')
      setTimeout(onSuccess, 600)
    } catch (err) {
      setStatus(`error:${err instanceof Error ? err.message : 'Error desconocido'}`)
    }
  }

  const statusColor = status?.startsWith('ok') ? 'text-[#34D399]' : status?.startsWith('error') ? 'text-[#F87171]' : ''
  const statusText = status?.startsWith('ok') ? status.split(':')[1] : status?.startsWith('error') ? status.split(':')[1] : null

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <h3 className="text-[10px] uppercase tracking-[0.15em] text-[#5A5A5A]">Agregar Transacción</h3>

      {/* Income / Expense toggle */}
      <div className="flex gap-1">
        <button
          type="button"
          onClick={() => setIsIncome(false)}
          className={`flex-1 text-xs py-1.5 border transition-colors ${
            !isIncome
              ? 'border-[#F87171]/60 text-[#F87171] bg-[#F87171]/5'
              : 'border-graphite-border text-[#5A5A5A] hover:border-[#F87171]/30'
          }`}
        >
          Gasto
        </button>
        <button
          type="button"
          onClick={() => setIsIncome(true)}
          className={`flex-1 text-xs py-1.5 border transition-colors ${
            isIncome
              ? 'border-[#34D399]/60 text-[#34D399] bg-[#34D399]/5'
              : 'border-graphite-border text-[#5A5A5A] hover:border-[#34D399]/30'
          }`}
        >
          Ingreso
        </button>
      </div>

      <div className="flex gap-2">
        <input
          type="number"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="Importe"
          step="0.01"
          min="0"
          className="flex-1 bg-graphite-card border border-graphite-border text-[#E3E2E2] text-sm px-3 py-2 rounded focus:outline-none focus:border-[#A68966]/50 placeholder-[#5A5A5A]"
        />
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className="w-36 bg-graphite-card border border-graphite-border text-[#A1A1AA] text-sm px-3 py-2 rounded focus:outline-none focus:border-[#A68966]/50"
        />
      </div>

      <div className="flex gap-2">
        <input
          type="text"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Descripción (opcional)"
          className="flex-1 bg-graphite-card border border-graphite-border text-[#E3E2E2] text-sm px-3 py-2 rounded focus:outline-none focus:border-[#A68966]/50 placeholder-[#5A5A5A]"
        />
        {!isIncome && (
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="w-36 bg-graphite-card border border-graphite-border text-[#A1A1AA] text-sm px-3 py-2 rounded focus:outline-none focus:border-[#A68966]/50"
          >
            {categories.map((cat) => (
              <option key={cat} value={cat}>
                {CATEGORY_LABELS[cat]}
              </option>
            ))}
          </select>
        )}
      </div>

      <button
        type="submit"
        className="w-full border border-[#A68966]/50 text-[#A68966] text-xs uppercase tracking-wider py-2 rounded hover:bg-[#A68966]/10 transition-colors"
      >
        Registrar
      </button>

      {statusText && <p className={`text-xs ${statusColor} text-center`}>{statusText}</p>}
    </form>
  )
}

// ─── Subscriptions Panel ───────────────────────────────────────────────────────

function SubscriptionsPanel({ subscriptions, onDelete, onAdd }: {
  subscriptions: Subscription[]
  onDelete: (id: string) => void
  onAdd: () => void
}) {
  const [name, setName] = useState('')
  const [amount, setAmount] = useState('')
  const [dayOfMonth, setDayOfMonth] = useState('')
  const [status, setStatus] = useState<string | null>(null)

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault()
    setStatus(null)

    const numAmount = parseFloat(amount)
    const numDay = parseInt(dayOfMonth, 10)

    if (!name.trim()) {
      setStatus('error:El nombre es requerido')
      return
    }
    if (isNaN(numAmount) || numAmount <= 0) {
      setStatus('error:El importe debe ser positivo')
      return
    }
    if (isNaN(numDay) || numDay < 1 || numDay > 31) {
      setStatus('error:El día debe ser 1-31')
      return
    }

    try {
      const res = await fetch('/api/subscriptions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), amount: numAmount, dayOfMonth: numDay }),
      })

      if (!res.ok) {
        const json = await res.json()
        throw new Error(json.error ?? 'Error al crear')
      }

      setName('')
      setAmount('')
      setDayOfMonth('')
      setStatus('ok:Suscripción agregada')
      setTimeout(onAdd, 600)
    } catch (err) {
      setStatus(`error:${err instanceof Error ? err.message : 'Error'}`)
    }
  }

  const statusColor = status?.startsWith('ok') ? 'text-[#34D399]' : status?.startsWith('error') ? 'text-[#F87171]' : ''
  const statusText = status?.startsWith('ok') ? status.split(':')[1] : status?.startsWith('error') ? status.split(':')[1] : null

  const formatCurrency = (n: number) =>
    n.toLocaleString('es-AR', { style: 'currency', currency: 'ARS', minimumFractionDigits: 0, maximumFractionDigits: 0 })

  return (
    <div className="space-y-4">
      <h3 className="text-[10px] uppercase tracking-[0.15em] text-[#5A5A5A]">Suscripciones</h3>

      {/* Subscription list */}
      <div className="space-y-2">
        {subscriptions.length === 0 ? (
          <p className="text-[#5A5A5A] text-xs italic">Sin suscripciones activas</p>
        ) : (
          subscriptions.map((sub) => (
            <div
              key={sub.id}
              className="flex items-center justify-between border border-graphite-border bg-graphite-card px-4 py-3"
            >
              <div>
                <p className="text-[#E3E2E2] text-sm font-serif">{sub.name}</p>
                <p className="text-[#5A5A5A] text-xs">
                  {formatCurrency(sub.amount)} · día {sub.dayOfMonth}
                </p>
              </div>
              <button
                onClick={() => onDelete(sub.id)}
                className="text-[#5A5A5A] hover:text-[#F87171] transition-colors p-1"
                title="Eliminar suscripción"
              >
                <TrashIcon size={14} />
              </button>
            </div>
          ))
        )}
      </div>

      {/* Add subscription form */}
      <form onSubmit={handleAdd} className="space-y-2 border-t border-graphite-border pt-4">
        <p className="text-[10px] uppercase tracking-wider text-[#5A5A5A] mb-2">Nueva suscripción</p>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Nombre"
          className="w-full bg-graphite-card border border-graphite-border text-[#E3E2E2] text-sm px-3 py-2 rounded focus:outline-none focus:border-[#A68966]/50 placeholder-[#5A5A5A]"
        />
        <div className="flex gap-2">
          <input
            type="number"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="Importe"
            step="0.01"
            min="0"
            className="flex-1 bg-graphite-card border border-graphite-border text-[#E3E2E2] text-sm px-3 py-2 rounded focus:outline-none focus:border-[#A68966]/50 placeholder-[#5A5A5A]"
          />
          <input
            type="number"
            value={dayOfMonth}
            onChange={(e) => setDayOfMonth(e.target.value)}
            placeholder="Día"
            min="1"
            max="31"
            className="w-20 bg-graphite-card border border-graphite-border text-[#A1A1AA] text-sm px-3 py-2 rounded focus:outline-none focus:border-[#A68966]/50 placeholder-[#5A5A5A]"
          />
        </div>
        <button
          type="submit"
          className="w-full border border-[#A68966]/50 text-[#A68966] text-xs uppercase tracking-wider py-2 rounded hover:bg-[#A68966]/10 transition-colors"
        >
          Agregar
        </button>
        {statusText && <p className={`text-xs ${statusColor} text-center`}>{statusText}</p>}
      </form>
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function FinanzasPage() {
  const [data, setData] = useState<FinanzasData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/registros/finanzas')
      if (!res.ok) throw new Error('Error al cargar')
      const json = await res.json()
      setData(json)
    } catch {
      setError('No se pudieron cargar los datos financieros.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const handleDeleteSubscription = async (id: string) => {
    try {
      const res = await fetch(`/api/subscriptions/${id}`, { method: 'DELETE' })
      if (!res.ok && res.status !== 204) throw new Error('Error al eliminar')
      load()
    } catch {
      // Silently fail — the UI will refresh on next load
    }
  }

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
          <WalletIcon size={36} />
          <h1 className="font-serif text-3xl text-[#E3E2E2]">Finanzas</h1>
        </div>
        <div className="h-px bg-gradient-to-r from-[#A68966]/60 via-[#A68966]/20 to-transparent mt-4 mb-3" />
        <p className="text-[11px] tracking-[0.15em] uppercase text-[#5A5A5A]">
          {data.transactions.length} transacciones en el ciclo actual
        </p>
      </div>

      {/* Balance Callout */}
      <BalanceCallout
        netBalance={data.netBalance}
        totalIncome={data.totalIncome}
        totalExpenses={data.totalExpenses}
        startOfCycle={data.startOfCycle}
      />

      {/* Main grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Category Distribution Chart */}
        <div className="border border-graphite-border bg-graphite-card p-5">
          <h2 className="text-[10px] uppercase tracking-[0.15em] text-[#5A5A5A] mb-4">
            Distribución de gastos
          </h2>
          <CircularChart data={data.categoryDistribution} />
        </div>

        {/* Right column */}
        <div className="space-y-6">
          {/* Quick Add Transaction */}
          <div className="border border-graphite-border bg-graphite-card p-5">
            <QuickAddTransaction onSuccess={load} />
          </div>

          {/* Subscriptions Panel */}
          <div className="border border-graphite-border bg-graphite-card p-5">
            <SubscriptionsPanel
              subscriptions={data.subscriptions}
              onDelete={handleDeleteSubscription}
              onAdd={load}
            />
          </div>
        </div>
      </div>
    </div>
  )
}
