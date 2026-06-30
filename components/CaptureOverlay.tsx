'use client'

// Capture Overlay — the zero-friction entry point.
// Triggered by the floating button (mobile) or Cmd/Ctrl+K + Opt/Alt+Space (desktop).
// ponytail: one self-contained client component. No state lib, no portal lib, no
// date lib — native MediaRecorder, a regex chip detector, a setTimeout debounce,
// and a CustomEvent for the draft state. Upgrade pieces only when they hurt.

import { useCallback, useEffect, useRef, useState } from 'react'
import { usePathname } from 'next/navigation'

// ─── Types ────────────────────────────────────────────────────────────────────

type SearchNote = {
  id: string
  title: string
  content: string
  domain: string
  isImportant: boolean
  dueDate: string | null
  createdAt: string
}

type Chips = { dates: string[]; important: boolean }

// ─── Client-side NLP ──────────────────────────────────────────────────────────
// ponytail: keyword list + regex. Detects Spanish date words and "!". A real NLP
///date lib is overkill until we need multilingual date math or ranges.

const DATE_WORDS = [
  'hoy',
  'mañana',
  'pasado mañana',
  'lunes',
  'martes',
  'miércoles',
  'jueves',
  'viernes',
  'sábado',
  'domingo',
  'esta semana',
  'la semana que viene',
  'el mes que viene',
]

const DATE_REGEX =
  /\b(\d{1,2}\s+de\s+(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre))\b/gi

function parseChips(text: string): Chips {
  const lower = text.toLowerCase()
  const dates = new Set<string>()
  for (const w of DATE_WORDS) {
    if (new RegExp(`\\b${w.replace(/\s+/g, '\\s+')}\\b`, 'i').test(lower)) {
      dates.add(w)
    }
  }
  for (const m of lower.matchAll(DATE_REGEX)) dates.add(m[0])
  return { dates: [...dates], important: text.includes('!') }
}

// Dynamic countdown: 3–10s, scaled by word count. ~5 words per second of grace.
function countdownDuration(text: string): number {
  const words = text.trim().split(/\s+/).filter(Boolean).length
  return Math.max(3, Math.min(10, Math.floor(words / 5)))
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function CaptureOverlay() {
  const pathname = usePathname()
  const isAuthPage = pathname === '/login' || pathname === '/signup'

  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')
  const [recording, setRecording] = useState(false)
  const [transcribing, setTranscribing] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [results, setResults] = useState<SearchNote[]>([])
  const [countdown, setCountdown] = useState<number | null>(null)
  const [manualMode, setManualMode] = useState(false)
  const [duration, setDuration] = useState(3)

  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const audioChunksRef = useRef<Blob[]>([])
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const textRef = useRef('')

  const chips = parseChips(text)
  const ringProgress = countdown !== null ? countdown / duration : 0

  // Keep textRef in sync so the stable `submit` always reads the latest text.
  useEffect(() => {
    textRef.current = text
  }, [text])

  // ─── Countdown control ──────────────────────────────────────────────────────
  const stopCountdown = useCallback(() => {
    if (countdownRef.current) {
      clearInterval(countdownRef.current)
      countdownRef.current = null
    }
    setCountdown(null)
  }, [])

  const submit = useCallback(async () => {
    stopCountdown()
    const trimmed = textRef.current.trim()
    if (!trimmed) return
    setSubmitting(true)

    // Draft event → Dashboard renders a loading card while the request is pending.
    const draftId = `draft-${Date.now()}`
    window.dispatchEvent(
      new CustomEvent('zf:draft', {
        detail: {
          id: draftId,
          title: trimmed.slice(0, 80),
          content: trimmed,
          pending: true,
        },
      })
    )

    try {
      const res = await fetch('/api/capture', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: trimmed }),
      })
      const data = await res.json().catch(() => ({}))
      window.dispatchEvent(
        new CustomEvent('zf:draft', {
          detail: {
            id: draftId,
            serverId: data.id,
            pending: false,
            ok: res.ok,
            data,
          },
        })
      )
      if (res.ok) {
        setOpen(false)
        setText('')
        setResults([])
        setManualMode(false)
      }
    } catch {
      // ponytail: silent fail; the draft card stays as a draft for retry.
    } finally {
      setSubmitting(false)
    }
  }, [stopCountdown])

  const startCountdown = useCallback(
    (seconds: number) => {
      stopCountdown()
      setDuration(seconds)
      setCountdown(seconds)
      setManualMode(false)
      let remaining = seconds
      countdownRef.current = setInterval(() => {
        remaining -= 1
        if (remaining <= 0) {
          stopCountdown()
          void submit()
        } else {
          setCountdown(remaining)
        }
      }, 1000)
    },
    [stopCountdown, submit]
  )

  // Any user interaction while the countdown is live → pause into manual mode.
  const pauseCountdown = useCallback(() => {
    if (countdownRef.current) {
      stopCountdown()
      setManualMode(true)
    }
  }, [stopCountdown])

  // ─── Open / close ───────────────────────────────────────────────────────────
  const openOverlay = useCallback(() => {
    setOpen(true)
    setText('')
    setResults([])
    setManualMode(false)
    stopCountdown()
    setTimeout(() => textareaRef.current?.focus(), 60)
  }, [stopCountdown])

  const closeOverlay = useCallback(() => {
    setOpen(false)
    setText('')
    setResults([])
    setManualMode(false)
    stopCountdown()
  }, [stopCountdown])

  // ─── Keyboard shortcuts ─────────────────────────────────────────────────────
  useEffect(() => {
    if (isAuthPage) return
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setOpen((o) => {
          if (o) {
            closeOverlay()
            return false
          }
          openOverlay()
          return true
        })
      } else if (e.altKey && e.code === 'Space') {
        e.preventDefault()
        setOpen((o) => {
          if (o) {
            closeOverlay()
            return false
          }
          openOverlay()
          return true
        })
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [isAuthPage, openOverlay, closeOverlay])

  // ─── Search-as-you-type (debounced) ─────────────────────────────────────────
  // Results are cleared in onChange when the query drops below 2 chars (no
  // setState-in-effect). Here we only fire the debounced fetch when there's a query.
  useEffect(() => {
    if (text.trim().length < 2) return
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(text.trim())}`)
        if (res.ok) setResults(await res.json())
      } catch {
        // ponytail: silent — search is a nice-to-have, not a critical path.
      }
    }, 250)
    return () => clearTimeout(t)
  }, [text])

  // ─── Voice recording (MediaRecorder) ────────────────────────────────────────
  const startRecording = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const mr = new MediaRecorder(stream)
      audioChunksRef.current = []
      mr.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data)
      }
      mr.onstop = async () => {
        const blob = new Blob(audioChunksRef.current, { type: 'audio/webm' })
        stream.getTracks().forEach((t) => t.stop())
        setTranscribing(true)
        try {
          const form = new FormData()
          form.append('audio', blob, 'capture.webm')
          const res = await fetch('/api/capture?transcribeOnly=true', {
            method: 'POST',
            body: form,
          })
          if (res.ok) {
            const data = await res.json()
            const t = typeof data.text === 'string' ? data.text : ''
            setText(t)
            if (t.trim()) startCountdown(countdownDuration(t))
          }
        } catch {
          // ponytail: silent; user can type instead.
        } finally {
          setTranscribing(false)
        }
      }
      mr.start()
      mediaRecorderRef.current = mr
      setRecording(true)
    } catch {
      setRecording(false)
    }
  }, [startCountdown])

  const stopRecording = useCallback(() => {
    mediaRecorderRef.current?.stop()
    setRecording(false)
  }, [])

  // Cleanup any running timer on unmount.
  useEffect(() => {
    return () => {
      if (countdownRef.current) clearInterval(countdownRef.current)
    }
  }, [])

  // ─── Don't render on auth pages (FAB/shortcut would be useless there) ────────
  if (isAuthPage) return null

  // ─── Render ─────────────────────────────────────────────────────────────────

  return (
    <>
      {/* Floating trigger — bottom-center circular button */}
      <button
        type="button"
        onClick={openOverlay}
        aria-label="Capturar nota"
        className="fixed bottom-6 left-1/2 z-40 h-14 w-14 -translate-x-1/2 rounded-full bg-[#A68966] text-black shadow-lg shadow-black/40 transition-transform hover:scale-105 active:scale-95 md:bottom-8 md:left-auto md:right-8 md:translate-x-0"
      >
        <PenIcon />
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 backdrop-blur-sm md:items-center"
          onPointerDown={(e) => {
            if (e.target === e.currentTarget) closeOverlay()
          }}
        >
          <div
            className="w-full rounded-t-3xl border border-[#1A1A1A] bg-[#0A0A0A] px-6 pb-8 pt-6 shadow-2xl md:max-w-lg md:rounded-3xl"
            onPointerDown={pauseCountdown}
            onKeyDown={pauseCountdown}
          >
            {/* Header */}
            <div className="mb-4 flex items-center justify-between">
              <h2 className="font-serif text-xl text-[#E3E2E2]">Capture</h2>
              <button
                type="button"
                onClick={closeOverlay}
                aria-label="Cerrar"
                className="text-[#A1A1AA] transition-colors hover:text-[#E3E2E2]"
              >
                <CloseIcon />
              </button>
            </div>

            {/* Textarea */}
            <textarea
              ref={textareaRef}
              value={text}
              onChange={(e) => {
                setText(e.target.value)
                pauseCountdown()
                if (e.target.value.trim().length < 2) setResults([])
              }}
              placeholder="Escribí o hablá… mañana, importante, 12 de julio"
              rows={4}
              className="w-full resize-none rounded-2xl border border-[#1A1A1A] bg-black px-4 py-3 font-sans text-[15px] leading-relaxed text-[#E3E2E2] outline-none transition focus:border-[#A68966] focus:ring-1 focus:ring-[#A68966]"
            />

            {/* Chips */}
            {(chips.dates.length > 0 || chips.important) && (
              <div className="mt-3 flex flex-wrap gap-2">
                {chips.dates.map((d) => (
                  <Chip key={d} label={`📅 ${d}`} />
                ))}
                {chips.important && (
                  <Chip
                    label="🔥 Importante"
                    onClick={() => setText((t) => t.replace(/!/g, ''))}
                  />
                )}
              </div>
            )}

            {/* Search results (prevent duplicates) */}
            {results.length > 0 && (
              <div className="mt-4 space-y-1.5">
                <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[#5A5A5A]">
                  Notas similares
                </p>
                {results.map((n) => (
                  <button
                    key={n.id}
                    type="button"
                    onClick={closeOverlay}
                    className="block w-full rounded-lg border border-[#161616] bg-black/40 px-3 py-2 text-left transition-colors hover:border-[#A68966]/40"
                  >
                    <p className="truncate text-sm text-[#E3E2E2]">{n.title}</p>
                    <p className="truncate text-xs text-[#5A5A5A]">{n.content}</p>
                  </button>
                ))}
              </div>
            )}

            {/* Actions */}
            <div className="mt-6 flex items-center justify-between">
              {/* Mic */}
              <button
                type="button"
                onClick={recording ? stopRecording : startRecording}
                disabled={transcribing || submitting}
                aria-label={recording ? 'Detener grabación' : 'Grabar voz'}
                className={`flex h-11 w-11 items-center justify-center rounded-full border transition-colors disabled:opacity-40 ${
                  recording
                    ? 'border-red-500/60 bg-red-500/10 text-red-400'
                    : 'border-[#1A1A1A] text-[#A1A1AA] hover:text-[#E3E2E2]'
                }`}
              >
                {transcribing ? <Spinner /> : <MicIcon active={recording} />}
              </button>

              {/* Send (with progress ring when countdown is live) */}
              <SendButton
                progress={ringProgress}
                countdown={countdown}
                manualMode={manualMode}
                disabled={text.trim().length === 0 || submitting || transcribing}
                onClick={() => void submit()}
              />
            </div>

            {/* Hint */}
            <p className="mt-4 text-center text-[11px] text-[#3F3F3F]">
              {recording
                ? 'Grabando… tocá para detener'
                : transcribing
                  ? 'Transcribiendo…'
                  : countdown !== null
                    ? `Envío automático en ${countdown}s · tocá para editar`
                    : 'Cmd+K para abrir · Esc para cerrar'}
            </p>
          </div>
        </div>
      )}
    </>
  )
}

// ─── Small subcomponents ──────────────────────────────────────────────────────

function Chip({ label, onClick }: { label: string; onClick?: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-full border border-[#A68966]/30 bg-[#A68966]/10 px-3 py-1 text-xs text-[#A68966] transition-colors hover:border-[#A68966]/60"
    >
      {label}
    </button>
  )
}

function SendButton({
  progress,
  countdown,
  manualMode,
  disabled,
  onClick,
}: {
  progress: number
  countdown: number | null
  manualMode: boolean
  disabled: boolean
  onClick: () => void
}) {
  const R = 20
  const CIRC = 2 * Math.PI * R
  const offset = CIRC * (1 - progress)
  const showRing = countdown !== null && !manualMode

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="relative flex h-11 w-11 items-center justify-center rounded-full bg-[#A68966] text-black transition-transform hover:scale-105 active:scale-95 disabled:opacity-40"
    >
      {showRing && (
        <svg
          className="absolute inset-0 -rotate-90"
          width="44"
          height="44"
          viewBox="0 0 44 44"
        >
          <circle
            cx="22"
            cy="22"
            r={R}
            fill="none"
            stroke="rgba(0,0,0,0.35)"
            strokeWidth="2"
            strokeDashoffset={offset}
            strokeDasharray={CIRC}
            strokeLinecap="round"
          />
        </svg>
      )}
      <SendIcon />
    </button>
  )
}

// ─── Icons (inline SVG, no icon lib) ──────────────────────────────────────────

function PenIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </svg>
  )
}

function MicIcon({ active }: { active: boolean }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="9" y="2" width="6" height="12" rx="3" />
      <path d="M5 10a7 7 0 0 0 14 0" />
      <line x1="12" y1="19" x2="12" y2="22" />
      {active && <circle cx="12" cy="8" r="1" fill="currentColor" />}
    </svg>
  )
}

function SendIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="22" y1="2" x2="11" y2="13" />
      <polygon points="22 2 15 22 11 13 2 9 22 2" />
    </svg>
  )
}

function CloseIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  )
}

function Spinner() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="animate-spin">
      <path d="M21 12a9 9 0 1 1-6.219-8.56" />
    </svg>
  )
}
