'use client'

import { useState, useEffect } from 'react'

interface Config {
  llmBaseUrl: string
  llmApiKey: string
  llmModel: string
  embeddingModel: string
}

function Toast({ message, onDismiss }: { message: string; onDismiss: () => void }) {
  useEffect(() => {
    const t = setTimeout(onDismiss, 2500)
    return () => clearTimeout(t)
  }, [onDismiss])
  return (
    <div className="fixed bottom-8 right-6 z-50 bg-graphite-border border border-[#A68966]/40 px-4 py-2 text-sm text-[#E3E2E2] animate-fade-in">
      {message}
    </div>
  )
}

export default function SettingsPage() {
  const [llmBaseUrl, setLlmBaseUrl] = useState('')
  const [llmApiKey, setLlmApiKey] = useState('')
  const [llmModel, setLlmModel] = useState('')
  const [embeddingModel, setEmbeddingModel] = useState('')
  const [loading, setLoading] = useState(true)
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null)
  const [toast, setToast] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/settings', { credentials: 'include' })
      .then((r) => r.json())
      .then((data: Config | null) => {
        if (data) {
          setLlmBaseUrl(data.llmBaseUrl ?? '')
          setLlmApiKey(data.llmApiKey ?? '')
          setLlmModel(data.llmModel ?? '')
          setEmbeddingModel(data.embeddingModel ?? '')
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  async function handleTest() {
    setTestResult(null)
    const res = await fetch('/api/settings/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ llmBaseUrl, llmApiKey, llmModel }),
    })
    const data = await res.json()
    if (data.ok) {
      setTestResult({ ok: true, message: `Conexión exitosa. Modelo: ${data.model}` })
    } else {
      setTestResult({ ok: false, message: data.error ?? 'Error de conexión' })
    }
  }

  async function handleSave() {
    const res = await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ llmBaseUrl, llmApiKey, llmModel, embeddingModel }),
    })
    if (res.ok) {
      const data: Config = await res.json()
      setLlmApiKey(data.llmApiKey ?? '')
      setToast('Ajustes guardados.')
      setTestResult(null)
    }
  }

  if (loading) {
    return (
      <div className="space-y-4 animate-pulse">
        <div className="h-4 w-16 bg-graphite-border rounded" />
        <div className="h-8 w-48 bg-graphite-border rounded" />
        <div className="h-32 bg-graphite-card border border-graphite-border rounded-none mt-6" />
      </div>
    )
  }

  return (
    <>
      <style>{`
        @keyframes fade-in { from { opacity: 0 } to { opacity: 1 } }
        .animate-fade-in { animation: fade-in 200ms ease-out forwards }
      `}</style>

      <p className="text-[10px] tracking-[0.2em] text-[#A68966] uppercase font-semibold">AJUSTES</p>
      <h1 className="font-serif text-3xl text-[#E3E2E2] mt-1">Configuración de IA</h1>
      <p className="text-sm text-[#5A5A5A] mt-1">
        Personalizá el modelo de lenguaje y embeddings para tu cuenta.
      </p>

      <div className="mt-8 space-y-5">
        {/* LLM Base URL */}
        <div>
          <label className="block text-[10px] tracking-[0.15em] uppercase text-[#5A5A5A] mb-1.5">
            LLM Base URL
          </label>
          <input
            type="text"
            value={llmBaseUrl}
            onChange={(e) => setLlmBaseUrl(e.target.value)}
            placeholder="https://api.deepseek.com/v1"
            className="w-full bg-graphite-card border border-graphite-border text-[#E3E2E2] text-sm px-3 py-2.5 focus:outline-none focus:border-[#A68966]/40 transition-colors"
          />
          <p className="text-[10px] text-[#5A5A5A] mt-1">
            Proveedor compatible con OpenAI (DeepSeek, OpenRouter, Groq…).
          </p>
        </div>

        {/* LLM API Key */}
        <div>
          <label className="block text-[10px] tracking-[0.15em] uppercase text-[#5A5A5A] mb-1.5">
            LLM API Key
          </label>
          <input
            type="password"
            value={llmApiKey}
            onChange={(e) => setLlmApiKey(e.target.value)}
            autoComplete="off"
            placeholder="••••••••"
            className="w-full bg-graphite-card border border-graphite-border text-[#E3E2E2] text-sm px-3 py-2.5 focus:outline-none focus:border-[#A68966]/40 transition-colors"
          />
          <p className="text-[10px] text-[#5A5A5A] mt-1">
            Se almacena cifrada. Déjalo como •••••••• para mantener la actual.
          </p>
        </div>

        {/* LLM Model */}
        <div>
          <label className="block text-[10px] tracking-[0.15em] uppercase text-[#5A5A5A] mb-1.5">
            LLM Model
          </label>
          <input
            type="text"
            value={llmModel}
            onChange={(e) => setLlmModel(e.target.value)}
            placeholder="deepseek-chat, gpt-4o-mini"
            className="w-full bg-graphite-card border border-graphite-border text-[#E3E2E2] text-sm px-3 py-2.5 focus:outline-none focus:border-[#A68966]/40 transition-colors"
          />
        </div>

        {/* Embedding Model */}
        <div>
          <label className="block text-[10px] tracking-[0.15em] uppercase text-[#5A5A5A] mb-1.5">
            Embedding Model
          </label>
          <input
            type="text"
            value={embeddingModel}
            onChange={(e) => setEmbeddingModel(e.target.value)}
            placeholder="text-embedding-3-small"
            className="w-full bg-graphite-card border border-graphite-border text-[#E3E2E2] text-sm px-3 py-2.5 focus:outline-none focus:border-[#A68966]/40 transition-colors"
          />
        </div>
      </div>

      {/* Test result */}
      {testResult && (
        <p
          className={`mt-4 text-sm ${testResult.ok ? 'text-[#4ade80]' : 'text-[#f87171]'}`}
        >
          {testResult.message}
        </p>
      )}

      {/* Actions */}
      <div className="mt-6 flex gap-3">
        <button
          onClick={handleTest}
          className="text-[10px] uppercase tracking-wider px-4 py-2.5 border border-graphite-border text-[#7A7A7A] hover:border-[#A68966]/40 hover:text-[#A68966] transition-colors"
        >
          Probar Conexión
        </button>
        <button
          onClick={handleSave}
          className="text-[10px] uppercase tracking-wider px-5 py-2.5 bg-[#A68966] text-black hover:bg-[#b89a78] transition-colors font-semibold"
        >
          Guardar Ajustes
        </button>
      </div>

      {toast && <Toast message={toast} onDismiss={() => setToast(null)} />}
    </>
  )
}
