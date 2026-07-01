'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

// ─── Types ─────────────────────────────────────────────────────────────────────

type NoteStatus = 'DRAFT' | 'NEEDS_REVIEW' | 'ACTIVE' | 'IN_PROGRESS' | 'DONE'

interface Note {
  id: string
  title: string
  content: string
  status: NoteStatus
  isImportant: boolean
  dueDate: string | null
  createdAt: string
  updatedAt: string
  domain: string
  tags: string[]
  suggestedGoals: string[]
}

type CardState =
  | { tag: 'idle' }
  | { tag: 'processing' }
  | { tag: 'error'; message: string }

// SSE payload — debe matchear `NoteProcessedEvent` en lib/draft-events.ts.
interface SSEEvent {
  noteId: string
  domain: string
  status: 'ok' | 'promoted' | 'already_processed'
}

// ─── InboxSection ──────────────────────────────────────────────────────────────

export default function InboxSection({
  showToast,
}: {
  showToast: (message: string, tone?: 'success' | 'error', domain?: string) => void
}) {
  const [cards, setCards] = useState<Note[]>([])
  // Per-card states keyed by note id
  const [cardStates, setCardStates] = useState<Record<string, CardState>>({})

  // Keep a ref in sync so the event listener always reads fresh state.
  const cardsRef = useRef<Note[]>([])
  useEffect(() => {
    cardsRef.current = cards
  }, [cards])

  // ── Mount: fetch all DRAFT notes ──────────────────────────────────────────
  useEffect(() => {
    async function loadDrafts() {
      try {
        const res = await fetch('/api/notes?status=DRAFT')
        if (!res.ok) return
        const notes: Note[] = await res.json()
        setCards(notes)
      } catch {
        // ponytail: silently ignore load failures; user can retry via "Procesar todo"
      }
    }
    void loadDrafts()
  }, [])

  // ── Event listener: prepend single DRAFT when CaptureOverlay creates one ──
  useEffect(() => {
    async function onDraft(e: Event) {
      const noteId = (e as CustomEvent<{ noteId?: string }>).detail?.noteId ?? ''
      if (!noteId) return
      if (cardsRef.current.some((c) => c.id === noteId)) return
      try {
        const res = await fetch(`/api/notes/${noteId}`)
        if (!res.ok) return
        const note: Note = await res.json()
        setCards((prev) => [note, ...prev])
      } catch {
        // Network error — ignore; user can still use "Procesar todo"
      }
    }

    window.addEventListener('zf:draft', onDraft)
    return () => window.removeEventListener('zf:draft', onDraft)
  }, [])

  // ── SSE listener: auto-morph DRAFT card when backend finishes processing ──
  // EventSource se auto-reconecta. Si el server no está disponible, la promesa
  // de open() rechaza — manejamos silenciosamente, "Procesar todo" sigue
  // funcionando como fallback manual.
  useEffect(() => {
    if (typeof window === 'undefined' || typeof EventSource === 'undefined') return

    const es = new EventSource('/api/events')

    es.addEventListener('note-processed', (e) => {
      try {
        const data = JSON.parse((e as MessageEvent).data) as SSEEvent
        if (!data?.noteId) return
        if (!cardsRef.current.some((c) => c.id === data.noteId)) return

        // Quitar la card del UI y limpiar su estado.
        setCards((prev) => prev.filter((c) => c.id !== data.noteId))
        setCardStates((prev) => {
          const next = { ...prev }
          delete next[data.noteId]
          return next
        })

        // Toast contextual según el outcome.
        if (data.status === 'promoted') {
          showToast('Nota enviada a revisión.', 'success')
        } else if (data.status === 'already_processed') {
          showToast('Esta nota ya estaba procesada.', 'success')
        } else {
          showToast(`Guardado en Hub ${data.domain}`.trim(), 'success', data.domain)
        }
      } catch {
        // Payload malformado — ignorar. Próximo evento llegará igual.
      }
    })

    es.onerror = () => {
      // ponytail: EventSource ya reintenta solo. Solo logueamos para debug.
      // El "Procesar todo" sigue siendo la red de seguridad.
    }

    return () => es.close()
  }, [showToast])

  // ── Per-card process handler ──────────────────────────────────────────────
  // El botón "Procesar con IA" per-card ya no existe (Task 4 del plan SSE);
  // "Procesar todo" sigue usando este handler como red de seguridad manual.
  const processCard = useCallback(
    async (noteId: string): Promise<void> => {
      const idx = cardsRef.current.findIndex((c) => c.id === noteId)
      if (idx === -1) return

      setCardStates((prev) => ({ ...prev, [noteId]: { tag: 'processing' } }))

      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 10_000)

      let errorMessage = 'Error desconocido. Reintentá.'

      try {
        const res = await fetch(`/api/notes/${noteId}/process`, {
          method: 'POST',
          signal: controller.signal,
        })
        clearTimeout(timeout)

        if (res.status === 200) {
          // El SSE debería auto-remover la card. Si todavía no llegó el evento,
          // caemos al fallback optimista igual: removemos local + toast.
          const body = (await res.json()) as { note?: { domain?: string } }
          const domain = body.note?.domain ?? ''
          setCards((prev) => prev.filter((c) => c.id !== noteId))
          setCardStates((prev) => {
            const next = { ...prev }
            delete next[noteId]
            return next
          })
          if (domain) showToast(`Guardado en Hub ${domain}`.trim(), 'success', domain)
          return
        } else if (res.status === 409) {
          // Already processed by someone else — remove silently
          setCards((prev) => prev.filter((c) => c.id !== noteId))
          setCardStates((prev) => {
            const next = { ...prev }
            delete next[noteId]
            return next
          })
          return
        } else if (res.status === 502) {
          errorMessage = 'Error del servidor de IA.'
        } else if (res.status === 504) {
          errorMessage = 'Tiempo de espera agotado. Reintentá.'
        }
      } catch {
        clearTimeout(timeout)
        errorMessage = 'Error de red. Reintentá.'
      }

      setCardStates((prev) => ({ ...prev, [noteId]: { tag: 'error', message: errorMessage } }))
    },
    [showToast]
  )

  // ── Global "Procesar todo" ────────────────────────────────────────────────
  const processAll = useCallback(async () => {
    const currentCards = cardsRef.current
    for (const card of currentCards) {
      await processCard(card.id)
    }
  }, [processCard])

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <section className="mt-8">
      {/* Header */}
      <div className="mb-4 flex items-center justify-between">
        <p className="text-[10px] tracking-[0.2em] text-[#A68966] uppercase">INBOX</p>
        {cards.length >= 1 && (
          <button
            onClick={() => void processAll()}
            className="text-[10px] tracking-wider text-[#A68966] uppercase hover:underline"
          >
            Procesar todo
          </button>
        )}
      </div>

      {/* Empty state */}
      {cards.length === 0 && (
        <div
          data-testid="inbox-empty"
          className="border border-graphite-border bg-graphite-card px-4 py-6 text-center"
        >
          <p className="text-sm text-[#5A5A5A] italic">Inbox vacío</p>
        </div>
      )}

      {/* Card list */}
      {cards.length > 0 && (
        <div className="space-y-2">
          {cards.map((card) => (
            <InboxCard
              key={card.id}
              card={card}
              state={cardStates[card.id] ?? { tag: 'idle' }}
            />
          ))}
        </div>
      )}
    </section>
  )
}

// ─── InboxCard ─────────────────────────────────────────────────────────────────

type InboxCardProps = {
  card: Note
  state: CardState
}

function InboxCard({ card, state }: InboxCardProps) {
  return (
    <div data-testid="inbox-card" data-note-id={card.id} className="border border-graphite-border bg-graphite-card px-4 py-3">
      <p className="text-sm text-[#E3E2E2] truncate">{card.title}</p>
      {card.content && (
        <p className="mt-0.5 text-xs text-[#5A5A5A] truncate">{card.content.slice(0, 80)}</p>
      )}

      {/* Action area — solo estados transitorios. El estado idle no tiene
          botón per-card: el SSE auto-morpha la card cuando termina el proceso. */}
      <div className="mt-2 flex items-center gap-2">
        {state.tag === 'processing' && (
          <span className="text-[10px] uppercase tracking-wider text-[#5A5A5A] flex items-center gap-1.5">
            <svg
              className="animate-spin h-3 w-3"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path d="M21 12a9 9 0 1 1-6.219-8.56" />
            </svg>
            Procesando con IA...
          </span>
        )}

        {state.tag === 'error' && (
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-red-400">{state.message}</span>
          </div>
        )}
      </div>
    </div>
  )
}
