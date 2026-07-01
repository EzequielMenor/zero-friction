'use client'

import { useCallback, useEffect, useState } from 'react'
import { TrashIcon } from '@/components/icons'

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

interface AccountData {
  id: string
  name: string
  initialBalance: number
  currentBalance: number
  currency: string
}

interface FinanzasData {
  transactions: Transaction[]
  totalIncome: number
  totalExpenses: number
  netBalance: number
  categoryDistribution: CategoryDistribution[]
  subscriptions: Subscription[]
  startOfCycle: string
  accounts: AccountData[]
  totalInitialBalance: number
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
          <circle cx={CX} cy={CY} r={R} fill="none" stroke="var(--border-subtle)" strokeWidth="20" />
          <circle cx={CX} cy={CY} r={INNER_R} fill="var(--bg)" />
        </svg>
        <p className="text-fg-faint text-xs italic mt-4">Sin gastos registrados</p>
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
        <circle cx={CX} cy={CY} r={INNER_R} fill="var(--bg)" />
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
              <span className="text-[11px] text-fg-muted">
                {CATEGORY_LABELS[entry.category.toUpperCase()] ?? entry.category}
              </span>
            </div>
            <span className="text-[11px] text-fg-faint">{entry.percentage}%</span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── Accounts Panel ──────────────────────────────────────────────────────────

function AccountsPanel({ accounts, onAdd, onDelete }: {
  accounts: AccountData[]
  onAdd: () => void
  onDelete: (id: string) => void
}) {
  const [name, setName] = useState('')
  const [initialBalance, setInitialBalance] = useState('')
  const [status, setStatus] = useState<string | null>(null)

  const formatCurrency = (n: number) =>
    n.toLocaleString('es-AR', { style: 'currency', currency: 'ARS', minimumFractionDigits: 0, maximumFractionDigits: 0 })

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault()
    setStatus(null)

    if (!name.trim()) {
      setStatus('error:El nombre es requerido')
      return
    }

    const balanceNum = parseFloat(initialBalance) || 0

    try {
      const res = await fetch('/api/accounts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), initialBalance: balanceNum }),
      })

      if (!res.ok) {
        const json = await res.json()
        throw new Error(json.error ?? 'Error al crear')
      }

      setName('')
      setInitialBalance('')
      setStatus('ok:Cuenta creada')
      setTimeout(onAdd, 600)
    } catch (err) {
      setStatus(`error:${err instanceof Error ? err.message : 'Error'}`)
    }
  }

  const statusColor = status?.startsWith('ok') ? 'text-success' : status?.startsWith('error') ? 'text-error' : ''
  const statusText = status?.startsWith('ok') ? status.split(':')[1] : status?.startsWith('error') ? status.split(':')[1] : null

  return (
    <div className="border border-border bg-surface p-5 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-[10px] uppercase tracking-[0.15em] text-fg-faint">Mis Cuentas / Carteras</h2>
      </div>

      {accounts.length === 0 ? (
        <div className="text-center py-4">
          <p className="text-fg-faint text-xs italic mb-3">Sin cuentas creadas. Creá tu primera cuenta para empezar a trackear por separado.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {accounts.map((acc) => (
            <div key={acc.id} className="flex items-center justify-between border border-border px-4 py-3">
              <div>
                <p className="text-fg text-sm font-serif">{acc.name}</p>
                <p className="text-fg-faint text-xs">Inicial: {formatCurrency(acc.initialBalance)}</p>
              </div>
              <div className="text-right">
                <p className={`text-sm font-serif ${acc.currentBalance >= 0 ? 'text-success' : 'text-error'}`}>
                  {formatCurrency(acc.currentBalance)}
                </p>
                <button
                  onClick={() => onDelete(acc.id)}
                  className="text-fg-faint hover:text-error transition-colors text-xs mt-1"
                >
                  Eliminar
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <form onSubmit={handleAdd} className="space-y-2 border-t border-border pt-4">
        <p className="text-[10px] uppercase tracking-wider text-fg-faint mb-2">Nueva cuenta</p>
        <div className="flex gap-2">
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Nombre (ej: Banco Principal)"
            className="flex-1 bg-surface border border-border text-fg text-sm px-3 py-2 rounded focus:outline-none focus:border-accent/50 placeholder-fg-faint"
          />
          <input
            type="number"
            value={initialBalance}
            onChange={(e) => setInitialBalance(e.target.value)}
            placeholder="Saldo inicial"
            step="0.01"
            className="w-32 bg-surface border border-border text-fg text-sm px-3 py-2 rounded focus:outline-none focus:border-accent/50 placeholder-fg-faint"
          />
        </div>
        <button
          type="submit"
          className="w-full border border-accent/50 text-accent text-xs uppercase tracking-wider py-2 rounded hover:bg-accent/10 transition-colors"
        >
          + Nueva Cuenta
        </button>
        {statusText && <p className={`text-xs ${statusColor} text-center`}>{statusText}</p>}
      </form>
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
    <div className="border border-accent/30 bg-accent/5 px-6 py-5 rounded">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <WalletIcon size={32} />
          <div>
            <p className="text-[10px] tracking-[0.15em] uppercase text-fg-faint">Balance del ciclo</p>
            <p className="text-[10px] text-fg-faint mt-0.5">Desde {startDate}</p>
          </div>
        </div>
        <div
          className={`font-serif text-3xl ${isPositive ? 'text-success' : 'text-error'}`}
        >
          {formatCurrency(netBalance)}
        </div>
      </div>

      <div className="h-px bg-border-subtle mb-4" />

      <div className="flex gap-8">
        <div>
          <p className="text-[10px] uppercase tracking-wider text-fg-faint">Ingresos</p>
          <p className="text-success text-lg font-serif mt-0.5">{formatCurrency(totalIncome)}</p>
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-wider text-fg-faint">Gastos</p>
          <p className="text-error text-lg font-serif mt-0.5">{formatCurrency(totalExpenses)}</p>
        </div>
      </div>
    </div>
  )
}

// ─── Quick Add Transaction ────────────────────────────────────────────────────

function QuickAddTransaction({ accounts, onSuccess }: { accounts: AccountData[]; onSuccess: () => void }) {
  const [amount, setAmount] = useState('')
  const [description, setDescription] = useState('')
  const [date, setDate] = useState(new Date().toISOString().split('T')[0])
  const [category, setCategory] = useState('GASTOS FIJOS')
  const [isIncome, setIsIncome] = useState(false)
  const [accountId, setAccountId] = useState('')
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
      const payload: Record<string, unknown> = {
        amount: isIncome ? numAmount : -numAmount,
        description: description.trim() || (isIncome ? 'Ingreso' : 'Gasto'),
        date,
        category,
      }
      if (accountId) {
        payload.accountId = accountId
      }

      const res = await fetch('/api/registros/finanzas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })

      if (!res.ok) {
        const json = await res.json()
        throw new Error(json.error ?? 'Error al registrar')
      }

      setAmount('')
      setDescription('')
      setDate(new Date().toISOString().split('T')[0])
      setAccountId('')
      setStatus('ok:Transacción registrada')
      setTimeout(onSuccess, 600)
    } catch (err) {
      setStatus(`error:${err instanceof Error ? err.message : 'Error desconocido'}`)
    }
  }

  const statusColor = status?.startsWith('ok') ? 'text-success' : status?.startsWith('error') ? 'text-error' : ''
  const statusText = status?.startsWith('ok') ? status.split(':')[1] : status?.startsWith('error') ? status.split(':')[1] : null

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <h3 className="text-[10px] uppercase tracking-[0.15em] text-fg-faint">Agregar Transacción</h3>

      {/* Income / Expense toggle */}
      <div className="flex gap-1">
        <button
          type="button"
          onClick={() => setIsIncome(false)}
          className={`flex-1 text-xs py-1.5 border transition-colors ${
            !isIncome
              ? 'border-error/60 text-error bg-error/5'
              : 'border-border text-fg-faint hover:border-error/30'
          }`}
        >
          Gasto
        </button>
        <button
          type="button"
          onClick={() => setIsIncome(true)}
          className={`flex-1 text-xs py-1.5 border transition-colors ${
            isIncome
              ? 'border-success/60 text-success bg-success/5'
              : 'border-border text-fg-faint hover:border-success/30'
          }`}
        >
          Ingreso
        </button>
      </div>

      {accounts.length > 0 && (
        <select
          value={accountId}
          onChange={(e) => setAccountId(e.target.value)}
          className="w-full bg-surface border border-border text-fg-muted text-sm px-3 py-2 rounded focus:outline-none focus:border-accent/50"
        >
          <option value="">Sin cuenta (opcional)</option>
          {accounts.map((acc) => (
            <option key={acc.id} value={acc.id}>
              {acc.name}
            </option>
          ))}
        </select>
      )}

      <div className="flex gap-2">
        <input
          type="number"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="Importe"
          step="0.01"
          min="0"
          className="flex-1 bg-surface border border-border text-fg text-sm px-3 py-2 rounded focus:outline-none focus:border-accent/50 placeholder-fg-faint"
        />
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className="w-36 bg-surface border border-border text-fg-muted text-sm px-3 py-2 rounded focus:outline-none focus:border-accent/50"
        />
      </div>

      <div className="flex gap-2">
        <input
          type="text"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Descripción (opcional)"
          className="flex-1 bg-surface border border-border text-fg text-sm px-3 py-2 rounded focus:outline-none focus:border-accent/50 placeholder-fg-faint"
        />
        {!isIncome && (
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="w-36 bg-surface border border-border text-fg-muted text-sm px-3 py-2 rounded focus:outline-none focus:border-accent/50"
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
        className="w-full border border-accent/50 text-accent text-xs uppercase tracking-wider py-2 rounded hover:bg-accent/10 transition-colors"
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

  const statusColor = status?.startsWith('ok') ? 'text-success' : status?.startsWith('error') ? 'text-error' : ''
  const statusText = status?.startsWith('ok') ? status.split(':')[1] : status?.startsWith('error') ? status.split(':')[1] : null

  const formatCurrency = (n: number) =>
    n.toLocaleString('es-AR', { style: 'currency', currency: 'ARS', minimumFractionDigits: 0, maximumFractionDigits: 0 })

  return (
    <div className="space-y-4">
      <h3 className="text-[10px] uppercase tracking-[0.15em] text-fg-faint">Suscripciones</h3>

      {/* Subscription list */}
      <div className="space-y-2">
        {subscriptions.length === 0 ? (
          <p className="text-fg-faint text-xs italic">Sin suscripciones activas</p>
        ) : (
          subscriptions.map((sub) => (
            <div
              key={sub.id}
              className="flex items-center justify-between border border-border bg-surface px-4 py-3"
            >
              <div>
                <p className="text-fg text-sm font-serif">{sub.name}</p>
                <p className="text-fg-faint text-xs">
                  {formatCurrency(sub.amount)} · día {sub.dayOfMonth}
                </p>
              </div>
              <button
                onClick={() => onDelete(sub.id)}
                className="text-fg-faint hover:text-error transition-colors p-1"
                title="Eliminar suscripción"
              >
                <TrashIcon size={14} />
              </button>
            </div>
          ))
        )}
      </div>

      {/* Add subscription form */}
      <form onSubmit={handleAdd} className="space-y-2 border-t border-border pt-4">
        <p className="text-[10px] uppercase tracking-wider text-fg-faint mb-2">Nueva suscripción</p>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Nombre"
          className="w-full bg-surface border border-border text-fg text-sm px-3 py-2 rounded focus:outline-none focus:border-accent/50 placeholder-fg-faint"
        />
        <div className="flex gap-2">
          <input
            type="number"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="Importe"
            step="0.01"
            min="0"
            className="flex-1 bg-surface border border-border text-fg text-sm px-3 py-2 rounded focus:outline-none focus:border-accent/50 placeholder-fg-faint"
          />
          <input
            type="number"
            value={dayOfMonth}
            onChange={(e) => setDayOfMonth(e.target.value)}
            placeholder="Día"
            min="1"
            max="31"
            className="w-20 bg-surface border border-border text-fg-muted text-sm px-3 py-2 rounded focus:outline-none focus:border-accent/50 placeholder-fg-faint"
          />
        </div>
        <button
          type="submit"
          className="w-full border border-accent/50 text-accent text-xs uppercase tracking-wider py-2 rounded hover:bg-accent/10 transition-colors"
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

  const handleDeleteAccount = async (id: string) => {
    try {
      const res = await fetch(`/api/accounts/${id}`, { method: 'DELETE' })
      if (!res.ok && res.status !== 204) throw new Error('Error al eliminar')
      load()
    } catch {
      // Silently fail
    }
  }

  const [toast, setToast] = useState<{ kind: 'ok' | 'error'; message: string } | null>(null)

  const handleDeleteTransaction = async (id: string) => {
    // Optimistic local update so the row disappears immediately.
    const previous = data
    setData((prev) =>
      prev ? { ...prev, transactions: prev.transactions.filter((t) => t.id !== id) } : prev
    )

    try {
      const res = await fetch(`/api/registros/finanzas?id=${encodeURIComponent(id)}`, {
        method: 'DELETE',
      })
      if (!res.ok) throw new Error('Error al eliminar')
      setToast({ kind: 'ok', message: 'Transacción eliminada' })
      // Reload to recompute totals / category distribution.
      load()
    } catch (err) {
      // Rollback on failure
      if (previous) setData(previous)
      setToast({
        kind: 'error',
        message: err instanceof Error ? err.message : 'Error desconocido',
      })
    } finally {
      setTimeout(() => setToast(null), 2400)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-fg-faint text-sm animate-pulse">Cargando…</div>
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

  return (
    <div className="space-y-10">
      {/* Header */}
      <div>
        <div className="flex items-center gap-3 mb-2">
          <WalletIcon size={36} />
          <h1 className="font-serif text-3xl text-fg">Finanzas</h1>
        </div>
        <div className="h-px bg-gradient-to-r from-accent/60 via-accent/20 to-transparent mt-4 mb-3" />
        <p className="text-[11px] tracking-[0.15em] uppercase text-fg-faint">
          {data.transactions.length} transacciones en el ciclo actual
        </p>
      </div>

      {/* Accounts Panel */}
      <AccountsPanel
        accounts={data.accounts}
        onAdd={load}
        onDelete={handleDeleteAccount}
      />

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
        <div className="border border-border bg-surface p-5">
          <h2 className="text-[10px] uppercase tracking-[0.15em] text-fg-faint mb-4">
            Distribución de gastos
          </h2>
          <CircularChart data={data.categoryDistribution} />
        </div>

        {/* Right column */}
        <div className="space-y-6">
          {/* Quick Add Transaction */}
          <div className="border border-border bg-surface p-5">
            <QuickAddTransaction accounts={data.accounts} onSuccess={load} />
          </div>

          {/* Subscriptions Panel */}
          <div className="border border-border bg-surface p-5">
            <SubscriptionsPanel
              subscriptions={data.subscriptions}
              onDelete={handleDeleteSubscription}
              onAdd={load}
            />
          </div>
        </div>
      </div>

      {/* Historial de Transacciones */}
      <TransactionsHistory
        transactions={data.transactions}
        onDelete={handleDeleteTransaction}
      />

      {/* Toast */}
      {toast && (
        <div
          className={`fixed bottom-6 right-6 z-50 px-4 py-2 border text-xs uppercase tracking-wider ${
            toast.kind === 'ok'
              ? 'border-success/60 text-success bg-success/10'
              : 'border-error/60 text-error bg-error/10'
          }`}
        >
          {toast.message}
        </div>
      )}
    </div>
  )
}

// ─── Transactions History ─────────────────────────────────────────────────────

function TransactionsHistory({
  transactions,
  onDelete,
}: {
  transactions: Transaction[]
  onDelete: (id: string) => void
}) {
  const formatCurrency = (n: number) =>
    n.toLocaleString('es-AR', {
      style: 'currency',
      currency: 'ARS',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    })

  const formatDate = (iso: string) =>
    new Date(iso).toLocaleDateString('es-AR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    })

  return (
    <div>
      <h2 className="text-[10px] uppercase tracking-[0.15em] text-fg-faint mb-3">
        Historial de Transacciones
      </h2>
      <div className="border border-border bg-surface overflow-hidden">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-border">
              <th className="text-left px-4 py-2 text-[10px] uppercase tracking-wider text-fg-faint font-normal">
                Fecha
              </th>
              <th className="text-left px-4 py-2 text-[10px] uppercase tracking-wider text-fg-faint font-normal">
                Descripción
              </th>
              <th className="text-left px-4 py-2 text-[10px] uppercase tracking-wider text-fg-faint font-normal">
                Categoría
              </th>
              <th className="text-right px-4 py-2 text-[10px] uppercase tracking-wider text-fg-faint font-normal">
                Importe
              </th>
              <th className="text-right px-4 py-2 text-[10px] uppercase tracking-wider text-fg-faint font-normal">
                <span className="sr-only">Acciones</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {transactions.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-fg-faint text-xs italic">
                  Sin transacciones en el ciclo actual.
                </td>
              </tr>
            ) : (
              transactions.map((t) => {
                const isIncome = t.amount > 0
                return (
                  <tr
                    key={t.id}
                    className="border-b border-border last:border-0 hover:bg-accent/5 transition-colors"
                  >
                    <td className="px-4 py-3 text-fg-muted whitespace-nowrap">
                      {formatDate(t.date)}
                    </td>
                    <td className="px-4 py-3 text-fg font-serif">
                      {t.description}
                    </td>
                    <td className="px-4 py-3 text-fg-muted">
                      {CATEGORY_LABELS[t.category.toUpperCase()] ?? t.category}
                    </td>
                    <td
                      className={`px-4 py-3 text-right font-serif ${
                        isIncome ? 'text-success' : 'text-error'
                      }`}
                    >
                      {isIncome ? '+' : '−'}
                      {formatCurrency(Math.abs(t.amount))}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        onClick={() => onDelete(t.id)}
                        className="text-fg-faint hover:text-error transition-colors p-1"
                        title="Eliminar transacción"
                        aria-label="Eliminar transacción"
                      >
                        <TrashIcon size={14} />
                      </button>
                    </td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
