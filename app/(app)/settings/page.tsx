'use client'

import { useState, useEffect } from 'react'

interface Config {
  llmBaseUrl: string
  llmApiKey: string
  llmModel: string
  embeddingModel: string
}

const PROVIDERS = [
  { name: 'OpenAI', url: 'https://api.openai.com/v1' },
  { name: 'DeepSeek', url: 'https://api.deepseek.com/v1' },
  { name: 'OpenRouter', url: 'https://openrouter.ai/api/v1' },
  { name: 'Groq', url: 'https://api.groq.com/openai/v1' },
  { name: 'Together AI', url: 'https://api.together.xyz/v1' },
  { name: 'MiniMax', url: 'https://api.minimax.io/v1' },
  { name: 'OpenCode Zen', url: 'https://opencode.ai/zen/v1' },
  { name: 'OpenCode Go', url: 'https://opencode.ai/zen/go/v1' },
  { name: 'Mistral AI', url: 'https://api.mistral.ai/v1' },
  { name: 'Local (Ollama)', url: 'http://localhost:11434/v1' },
  { name: 'Personalizado', url: null },
] as const

type ProviderName = (typeof PROVIDERS)[number]['name']

const CUSTOM_PROVIDER: ProviderName = 'Personalizado'

function providerFromUrl(url: string): ProviderName {
  const match = PROVIDERS.find((p) => p.url !== null && p.url === url)
  return match ? match.name : CUSTOM_PROVIDER
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
  const [provider, setProvider] = useState<ProviderName>(CUSTOM_PROVIDER)
  const [llmBaseUrl, setLlmBaseUrl] = useState('')
  const [llmApiKey, setLlmApiKey] = useState('')
  const [llmModel, setLlmModel] = useState('')
  const [embeddingModel, setEmbeddingModel] = useState('')
  const [chatModels, setChatModels] = useState<string[]>([])
  const [embeddingModels, setEmbeddingModels] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null)
  const [toast, setToast] = useState<string | null>(null)

  async function fetchModels() {
    if (!llmBaseUrl || !llmApiKey) return
    try {
      const res = await fetch('/api/settings/models', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ llmBaseUrl, llmApiKey }),
      })
      if (res.ok) {
        const data = await res.json()
        setChatModels(data.chatModels ?? [])
        setEmbeddingModels(data.embeddingModels ?? [])
      }
    } catch {
      // silent - dropdowns fall back to text inputs
    }
  }

  function handleProviderChange(name: ProviderName) {
    setProvider(name)
    const match = PROVIDERS.find((p) => p.name === name)
    if (match?.url) {
      setLlmBaseUrl(match.url)
    }
  }

  useEffect(() => {
    fetch('/api/settings', { credentials: 'include' })
      .then((r) => r.json())
      .then(async (data: Config | null) => {
        if (data) {
          const baseUrl = data.llmBaseUrl ?? ''
          const apiKey = data.llmApiKey ?? ''
          setLlmBaseUrl(baseUrl)
          setProvider(providerFromUrl(baseUrl))
          setLlmApiKey(apiKey)
          setLlmModel(data.llmModel ?? '')
          setEmbeddingModel(data.embeddingModel ?? '')
          // Fetch models with saved credentials
          if (baseUrl && apiKey) {
            try {
              const res = await fetch('/api/settings/models', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ llmBaseUrl: baseUrl, llmApiKey: apiKey }),
              })
              if (res.ok) {
                const modelData = await res.json()
                setChatModels(modelData.chatModels ?? [])
                setEmbeddingModels(modelData.embeddingModels ?? [])
              }
            } catch {
              // silent - dropdowns fall back to text inputs
            }
          }
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
      setTestResult({ ok: true, message: 'Conexión exitosa.' })
      // Fetch models after successful test to populate dropdowns
      await fetchModels()
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
        {/* Provider */}
        <div>
          <label className="block text-[10px] tracking-[0.15em] uppercase text-[#5A5A5A] mb-1.5">
            Proveedor
          </label>
          <select
            value={provider}
            onChange={(e) => handleProviderChange(e.target.value as ProviderName)}
            className="w-full bg-graphite-card border border-graphite-border text-[#E3E2E2] text-sm px-3 py-2.5 focus:outline-none focus:border-[#A68966]/40 transition-colors"
          >
            {PROVIDERS.map((p) => (
              <option key={p.name} value={p.name}>{p.name}</option>
            ))}
          </select>
        </div>

        {/* LLM Base URL */}
        <div>
          <label className="block text-[10px] tracking-[0.15em] uppercase text-[#5A5A5A] mb-1.5">
            LLM Base URL
          </label>
          <input
            type="text"
            value={llmBaseUrl}
            onChange={(e) => setLlmBaseUrl(e.target.value)}
            readOnly={provider !== CUSTOM_PROVIDER}
            placeholder={provider === CUSTOM_PROVIDER ? 'https://api.deepseek.com/v1' : ''}
            className={`w-full bg-graphite-card border border-graphite-border text-[#E3E2E2] text-sm px-3 py-2.5 focus:outline-none focus:border-[#A68966]/40 transition-colors ${
              provider !== CUSTOM_PROVIDER ? 'opacity-60 cursor-not-allowed' : ''
            }`}
          />
          <p className="text-[10px] text-[#5A5A5A] mt-1">
            {provider === CUSTOM_PROVIDER
              ? 'Proveedor compatible con OpenAI (DeepSeek, OpenRouter, Groq…).'
              : 'URL fija del proveedor seleccionado. Elegí "Personalizado" para editarla.'}
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
          {chatModels.length > 0 ? (
            <select
              value={llmModel}
              onChange={(e) => setLlmModel(e.target.value)}
              className="w-full bg-graphite-card border border-graphite-border text-[#E3E2E2] text-sm px-3 py-2.5 focus:outline-none focus:border-[#A68966]/40 transition-colors"
            >
              <option value="">Seleccionar modelo...</option>
              {chatModels.map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
          ) : (
            <input
              type="text"
              value={llmModel}
              onChange={(e) => setLlmModel(e.target.value)}
              placeholder="deepseek-chat, gpt-4o-mini"
              className="w-full bg-graphite-card border border-graphite-border text-[#E3E2E2] text-sm px-3 py-2.5 focus:outline-none focus:border-[#A68966]/40 transition-colors"
            />
          )}
        </div>

        {/* Embedding Model */}
        <div>
          <label className="block text-[10px] tracking-[0.15em] uppercase text-[#5A5A5A] mb-1.5">
            Embedding Model
          </label>
          {embeddingModels.length > 0 ? (
            <select
              value={embeddingModel}
              onChange={(e) => setEmbeddingModel(e.target.value)}
              className="w-full bg-graphite-card border border-graphite-border text-[#E3E2E2] text-sm px-3 py-2.5 focus:outline-none focus:border-[#A68966]/40 transition-colors"
            >
              <option value="">Seleccionar modelo...</option>
              {embeddingModels.map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
          ) : (
            <input
              type="text"
              value={embeddingModel}
              onChange={(e) => setEmbeddingModel(e.target.value)}
              placeholder="text-embedding-3-small"
              className="w-full bg-graphite-card border border-graphite-border text-[#E3E2E2] text-sm px-3 py-2.5 focus:outline-none focus:border-[#A68966]/40 transition-colors"
            />
          )}
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
