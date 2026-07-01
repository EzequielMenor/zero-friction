'use client'

// Capture Overlay — the zero-friction entry point.
// Triggered by the floating button (mobile) or Cmd/Ctrl+K + Opt/Alt+Space (desktop).
// ponytail: one self-contained client component. No state lib, no portal lib, no
// date lib — native MediaRecorder, a regex chip detector, and a CustomEvent for
// the draft state. Upgrade pieces only when they hurt.

import { useCallback, useEffect, useRef, useState } from 'react'
import { usePathname } from 'next/navigation'
import { CalendarIcon, FlameIcon } from '@/components/icons'

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

// ─── Countdown helpers ───────────────────────────────────────────────────────
// ponytail: dinámica simple — más palabras, más tiempo de revisión. La fórmula
// está en el SPEC §3.2; clamp a [3, 10] para que un "hola" no desaparezca al
// toque y un párrafo de 5 líneas no se quede 30s.

const MIN_COUNTDOWN_S = 3
const MAX_COUNTDOWN_S = 10
const TICK_MS = 100

function calcCountdownDuration(text: string): number {
  const words = text.trim().split(/\s+/).filter(Boolean).length
  const seconds = words * 0.8
  return Math.max(MIN_COUNTDOWN_S, Math.min(MAX_COUNTDOWN_S, Math.round(seconds)))
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
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  // ponytail: hint for "I clicked submit with nothing" / "your recording was empty".
  // Stays distinct from errorMessage (errors are from the API; hints are local).
  const [hintMessage, setHintMessage] = useState<string | null>(null)
  // ponytail: countdown post-transcripción. La voz transcrita muestra un ring
  // con segundos restantes antes del auto-send. El usuario cancela tocando el
  // textarea o el botón "Cancelar" → vuelve a modo manual.
  const [countdown, setCountdown] = useState<{ remaining: number; total: number } | null>(null)

  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const audioChunksRef = useRef<Blob[]>([])
  const textRef = useRef('')
  // Referencia al setInterval del countdown — necesitamos el id para cancelarlo
  // desde el escape hatch y desde el cleanup del componente.
  const countdownIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const chips = parseChips(text)

  // Keep textRef in sync so the stable `submit` always reads the latest text.
  useEffect(() => {
    textRef.current = text
  }, [text])

  // ── Countdown lifecycle ────────────────────────────────────────────────────
  // Limpia el interval cuando el componente se desmonta o se cierra el overlay.
  useEffect(() => {
    return () => {
      if (countdownIntervalRef.current) {
        clearInterval(countdownIntervalRef.current)
        countdownIntervalRef.current = null
      }
    }
  }, [])

  const stopCountdown = useCallback(() => {
    if (countdownIntervalRef.current) {
      clearInterval(countdownIntervalRef.current)
      countdownIntervalRef.current = null
    }
    setCountdown(null)
  }, [])

  // ponytail: triggerProcess es solo para el path de audio (Task 5.6) — el
  // submit de texto sigue con la UX manual de "Procesar con IA" desde el inbox.
  const submit = useCallback(
    async (opts: { triggerProcess?: boolean } = {}): Promise<void> => {
      const trimmed = textRef.current.trim()
      // ponytail: empty submit used to silently no-op. Now flash a local hint so
      // the user knows nothing was sent (no API call, no toast, no draft event).
      if (!trimmed) {
        setHintMessage('Escribe o graba algo para capturar.')
        setTimeout(() => setHintMessage(null), 4000)
        return
      }
      setSubmitting(true)

      try {
        // Text capture → instant DRAFT via /api/notes (no AI at capture time).
        // Audio-only path goes through /api/capture via startRecording.
        const res = await fetch('/api/notes', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: trimmed }),
        })

        if (res.status === 201) {
          const result: { id: string } = await res.json()
          // Notify InboxSection to prepend the new DRAFT note.
          window.dispatchEvent(
            new CustomEvent('zf:draft', { detail: { noteId: result.id } })
          )
          // ponytail: fire-and-forget — UI doesn't block on processing; the
          // Inbox card and downstream flows pick it up.
          if (opts.triggerProcess) {
            void fetch(`/api/notes/${result.id}/process`, { method: 'POST' })
          }
          setOpen(false)
          setText('')
          setResults([])
          stopCountdown()
        } else {
          // 4xx/5xx — keep overlay open, surface error inline.
          const err: { error?: string } = await res.json().catch(() => ({}))
          setErrorMessage(err.error ?? 'Error desconocido')
        }
      } catch {
        setErrorMessage('Error de red')
      } finally {
        setSubmitting(false)
      }
    },
    [stopCountdown]
  )

  // ponytail: countdown post-transcripción. Se llama desde el onstop del
  // MediaRecorder cuando llega la transcripción. El usuario tiene 3-10s para
  // cancelar (tocar el textarea, "Cancelar") antes del auto-send.
  const startCountdown = useCallback(
    (transcribedText: string) => {
      // Si ya hay un countdown corriendo, lo limpiamos antes de empezar otro.
      stopCountdown()
      const total = calcCountdownDuration(transcribedText)
      const startedAt = Date.now()
      setCountdown({ remaining: total, total })

      countdownIntervalRef.current = setInterval(() => {
        const elapsed = (Date.now() - startedAt) / 1000
        const remaining = Math.max(0, total - elapsed)
        if (remaining <= 0) {
          // Disparar submit y limpiar.
          if (countdownIntervalRef.current) {
            clearInterval(countdownIntervalRef.current)
            countdownIntervalRef.current = null
          }
          setCountdown(null)
          void submit({ triggerProcess: true })
        } else {
          setCountdown({ remaining, total })
        }
      }, TICK_MS)
    },
    [stopCountdown, submit]
  )

  // ─── Open / close ───────────────────────────────────────────────────────────
  const openOverlay = useCallback(() => {
    setOpen(true)
    setText('')
    setResults([])
    stopCountdown()
    setTimeout(() => textareaRef.current?.focus(), 60)
  }, [stopCountdown])

  const closeOverlay = useCallback(() => {
    setOpen(false)
    setText('')
    setResults([])
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
  // ponytail: Task 5.6 — audio path mirrors the text flow (POST /api/notes)
  // and fires background /api/notes/[id]/process. En vez de submit inmediato,
  // ahora muestra un countdown (Plan 2026-07-01-voice-autosend-timer) — el
  // usuario puede revisar/corregir la transcripción antes del auto-send.
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
            if (t.trim()) {
              // Iniciar countdown en vez de submit inmediato. El usuario tiene
              // 3-10s para revisar; cualquier interacción lo cancela.
              startCountdown(t)
            } else {
              setHintMessage('Escribe o graba algo para capturar.')
              setTimeout(() => setHintMessage(null), 4000)
            }
          }
        } catch {
          // ponytail: silent on network errors so the user can fall back to typing.
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

  // ─── Escape hatch handlers ──────────────────────────────────────────────────
  // Cualquier interacción con el textarea corta el countdown y deja al usuario
  // en modo manual (puede editar y enviar cuando quiera).
  const onTextareaPointerDown = useCallback(() => {
    if (countdown) stopCountdown()
  }, [countdown, stopCountdown])

  const onTextareaChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      if (countdown) stopCountdown()
      setText(e.target.value)
      setErrorMessage(null)
      if (e.target.value.trim().length < 2) setResults([])
    },
    [countdown, stopCountdown]
  )

  // ─── Don't render on auth pages (FAB/shortcut would be useless there) ────────
  if (isAuthPage) return null

  // ─── Render ─────────────────────────────────────────────────────────────────

  return (
    <>
      {/* Floating trigger — precision FAB */}
      <button
        type="button"
        onClick={openOverlay}
        aria-label="Capturar nota"
        className="fixed bottom-6 left-1/2 z-40 size-[52px] -translate-x-1/2 rounded-full bg-accent text-black shadow-lg shadow-black/40 flex items-center justify-center transition-all duration-200 ease-out hover:scale-105 hover:shadow-[0_4px_24px_rgba(166,137,102,0.25)] active:scale-95 md:bottom-8 md:left-auto md:right-8 md:translate-x-0"
      >
        <PenIcon />
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-bg/70 backdrop-blur-sm md:items-center"
          onPointerDown={(e) => {
            if (e.target === e.currentTarget) closeOverlay()
          }}
        >
          <div className="w-full rounded-t-3xl border border-border bg-surface px-6 pb-8 pt-6 shadow-2xl md:max-w-lg md:rounded-3xl">
            {/* Header */}
            <div className="mb-4 flex items-center justify-between">
              <h2 className="font-serif text-xl text-fg">Capture</h2>
              <button
                type="button"
                onClick={closeOverlay}
                aria-label="Cerrar"
                className="text-fg-muted transition-colors hover:text-fg"
              >
                <CloseIcon />
              </button>
            </div>

            {/* Textarea */}
            <textarea
              ref={textareaRef}
              value={text}
              onChange={onTextareaChange}
              onPointerDown={onTextareaPointerDown}
              placeholder="Escribí o hablá… mañana, importante, 12 de julio"
              rows={4}
              className="w-full resize-none rounded-2xl border border-border bg-bg px-4 py-3 font-sans text-[15px] leading-relaxed text-fg outline-none transition focus:border-accent focus:ring-1 focus:ring-accent"
            />

            {/* Chips */}
            {(chips.dates.length > 0 || chips.important) && (
              <div className="mt-3 flex flex-wrap gap-2">
                {chips.dates.map((d) => (
                  <Chip key={d} icon={<CalendarIcon />} label={d} />
                ))}
                {chips.important && (
                  <Chip
                    icon={<FlameIcon />}
                    label="Importante"
                    onClick={() => setText((t) => t.replace(/!/g, ''))}
                  />
                )}
              </div>
            )}

            {/* Inline error */}
            {errorMessage && (
              <p className="mt-2 text-xs text-red-400" role="alert">
                {errorMessage}
              </p>
            )}

            {/* Empty-input hint (Task 5.6). Local state, no API call → no error. */}
            {hintMessage && !errorMessage && (
              <p className="mt-2 text-xs text-amber-400" role="status">
                {hintMessage}
              </p>
            )}

            {/* Search results (prevent duplicates) */}
            {results.length > 0 && (
              <div className="mt-4 space-y-1.5">
                <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-fg-subtle">
                  Notas similares
                </p>
                {results.map((n) => (
                  <button
                    key={n.id}
                    type="button"
                    onClick={closeOverlay}
                    className="block w-full rounded-lg border border-border bg-bg/40 px-3 py-2 text-left transition-colors hover:border-accent/40"
                  >
                    <p className="truncate text-sm text-fg">{n.title}</p>
                    <p className="truncate text-xs text-fg-subtle">{n.content}</p>
                  </button>
                ))}
              </div>
            )}

            {/* Actions */}
            <div className="mt-6 flex items-center justify-between gap-3">
              {/* Mic */}
              <button
                type="button"
                onClick={recording ? stopRecording : startRecording}
                disabled={transcribing || submitting || countdown !== null}
                aria-label={recording ? 'Detener grabación' : 'Grabar voz'}
                className={`flex h-11 w-11 items-center justify-center rounded-full border transition-colors disabled:opacity-40 ${
                  recording
                    ? 'border-red-500/60 bg-red-500/10 text-red-400'
                    : 'border-border text-fg-muted hover:text-fg'
                }`}
              >
                {transcribing ? <Spinner /> : <MicIcon active={recording} />}
              </button>

              {/* Countdown o espacio vacío (entre mic y send) */}
              {countdown ? (
                <div className="flex flex-1 items-center justify-center gap-3">
                  <ProgressRing
                    size={36}
                    strokeWidth={3}
                    progress={countdown.remaining / countdown.total}
                  />
                  <div className="flex flex-col">
                    <span className="text-[10px] uppercase tracking-wider text-fg-muted">
                      Enviando en {Math.ceil(countdown.remaining)}…
                    </span>
                    <button
                      type="button"
                      onClick={stopCountdown}
                      className="text-[10px] uppercase tracking-wider text-accent hover:underline text-left"
                    >
                      Cancelar
                    </button>
                  </div>
                </div>
              ) : (
                <span className="flex-1 text-center text-[10px] uppercase tracking-wider text-fg-subtle">
                  Manual
                </span>
              )}

              {/* Send — disabled durante countdown (auto-modo). En modo manual
                  sigue siendo el botón de submit. */}
              <button
                type="button"
                onClick={() => void submit()}
                disabled={text.trim().length === 0 || submitting || transcribing || countdown !== null}
                aria-label="Enviar"
                className="flex h-11 w-11 items-center justify-center rounded-full bg-accent text-black transition-transform hover:scale-105 active:scale-95 disabled:opacity-40"
              >
                <SendIcon />
              </button>
            </div>

            {/* Hint */}
            <p className="mt-4 text-center text-[11px] text-fg-faint">
              {recording
                ? 'Grabando… tocá para detener'
                : transcribing
                  ? 'Transcribiendo…'
                  : countdown
                    ? 'Tocá el texto o "Cancelar" para revisar antes de enviar'
                    : 'Cmd+K para abrir · Esc para cerrar'}
            </p>
          </div>
        </div>
      )}
    </>
  )
}

// ─── Small subcomponents ──────────────────────────────────────────────────────

function Chip({ icon, label, onClick }: { icon?: React.ReactNode; label: string; onClick?: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-full border border-accent/30 bg-accent/10 px-3 py-1 text-xs text-accent transition-colors hover:border-accent/60 flex items-center gap-1.5"
    >
      {icon}
      {label}
    </button>
  )
}

// ProgressRing — SVG circular con stroke-dashoffset animado vía CSS transition.
// ponytail: SVG nativo, sin framer-motion. El padre pasa `progress` (0..1) y
// el ring se "vacía" o se "llena" según ese ratio. Usamos una transition
// lineal de 100ms para que cada tick del interval se vea smooth sin saltos.
function ProgressRing({
  size,
  strokeWidth,
  progress,
}: {
  size: number
  strokeWidth: number
  progress: number
}) {
  const radius = (size - strokeWidth) / 2
  const circumference = 2 * Math.PI * radius
  const offset = circumference * (1 - Math.max(0, Math.min(1, progress)))
  // Color: dorado cuando hay tiempo, virando a rojo en los últimos 1.5s.
  const isUrgent = progress < 0.2
  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      style={{ transform: 'rotate(-90deg)' }}
      aria-hidden="true"
    >
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke="#1C1C1F"
        strokeWidth={strokeWidth}
      />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke={isUrgent ? '#ef4444' : '#A68966'}
        strokeWidth={strokeWidth}
        strokeDasharray={circumference}
        strokeDashoffset={offset}
        strokeLinecap="round"
        style={{ transition: 'stroke-dashoffset 100ms linear, stroke 200ms linear' }}
      />
    </svg>
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
