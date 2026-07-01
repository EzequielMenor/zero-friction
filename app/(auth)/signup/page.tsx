'use client'

import { useState, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'

export default function SignupPage() {
  const router = useRouter()

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [secretCode, setSecretCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      const res = await fetch('/api/auth/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, secretCode }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setError(data.error ?? 'No se pudo crear la cuenta')
        return
      }
      router.replace('/')
      router.refresh()
    } catch {
      setError('Error de red')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex min-h-[80vh] items-center justify-center px-6">
      <div className="w-full max-w-sm">
        <h1 className="font-serif text-3xl text-fg mb-2">Solicitar acceso</h1>
        <p className="text-sm text-fg-muted mb-10">
          Zero-Friction es privado. Ingresá tu código de invitación para crear una cuenta.
        </p>

        <form onSubmit={handleSubmit} className="space-y-5">
          <Field
            label="Email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={setEmail}
            required
          />
          <Field
            label="Contraseña"
            hint="Mínimo 8 caracteres"
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={setPassword}
            required
            minLength={8}
          />
          <Field
            label="Código de invitación"
            type="text"
            autoComplete="off"
            value={secretCode}
            onChange={setSecretCode}
            required
          />

          {error && <p className="text-sm text-red-400">{error}</p>}

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-full bg-accent px-5 py-3 text-sm font-semibold tracking-wide text-black transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {loading ? 'Creando cuenta…' : 'Crear cuenta'}
          </button>
        </form>

        <p className="mt-10 text-center text-sm text-fg-muted">
          ¿Ya tenés cuenta?{' '}
          <a href="/login" className="text-accent hover:underline">
            Ingresar
          </a>
        </p>
      </div>
    </div>
  )
}

type FieldProps = Omit<React.InputHTMLAttributes<HTMLInputElement>, 'onChange' | 'value'> & {
  label: string
  hint?: string
  value: string
  onChange: (v: string) => void
}

function Field({ label, hint, value, onChange, ...rest }: FieldProps) {
  return (
    <label className="block">
      <span className="block text-[11px] font-semibold uppercase tracking-[0.2em] text-fg-muted mb-2">
        {label}
      </span>
      <input
        {...rest}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-md border border-border bg-surface px-4 py-3 text-fg outline-none transition focus:border-accent focus:ring-1 focus:ring-accent"
      />
      {hint && <span className="mt-1.5 block text-xs text-fg-faint">{hint}</span>}
    </label>
  )
}