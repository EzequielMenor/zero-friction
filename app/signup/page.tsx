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
        setError(data.error ?? 'signup failed')
        return
      }
      router.replace('/')
      router.refresh()
    } catch {
      setError('network error')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex min-h-[80vh] items-center justify-center px-6">
      <div className="w-full max-w-sm">
        <h1 className="font-serif text-3xl text-[#E3E2E2] mb-2">Request access</h1>
        <p className="text-sm text-[#A1A1AA] mb-10">
          Zero-Friction is private. Enter your invite code to create an account.
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
            label="Password"
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={setPassword}
            required
            minLength={8}
          />
          <Field
            label="Invite code"
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
            className="w-full rounded-full bg-[#A68966] px-5 py-3 text-sm font-semibold tracking-wide text-black transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {loading ? 'Creating account…' : 'Create account'}
          </button>
        </form>

        <p className="mt-10 text-center text-sm text-[#A1A1AA]">
          Already have an account?{' '}
          <a href="/login" className="text-[#A68966] hover:underline">
            Sign in
          </a>
        </p>
      </div>
    </div>
  )
}

type FieldProps = Omit<React.InputHTMLAttributes<HTMLInputElement>, 'onChange' | 'value'> & {
  label: string
  value: string
  onChange: (v: string) => void
}

function Field({ label, value, onChange, ...rest }: FieldProps) {
  return (
    <label className="block">
      <span className="block text-[11px] font-semibold uppercase tracking-[0.2em] text-[#A1A1AA] mb-2">
        {label}
      </span>
      <input
        {...rest}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-md border border-[#1A1A1A] bg-[#0A0A0A] px-4 py-3 text-[#E3E2E2] outline-none transition focus:border-[#A68966] focus:ring-1 focus:ring-[#A68966]"
      />
    </label>
  )
}