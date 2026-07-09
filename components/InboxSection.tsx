'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { NoteItem } from '@/lib/types/note'

// ─── Types ─────────────────────────────────────────────────────────────────────

type CardState =
  | { tag: 'idle' }
  | { tag: 'processing' }
  | { tag: 'error'; message: string }

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
  const [cards, setCards] = useState<NoteItem[]>([])
  const [cardStates, setCardStates] = useState<Record<string, CardState>>({})

  const cardsRef = useRef<NoteItem[]>([])
  useEffect(() => {
    cardsRef.current = cards
  }, [cards])

  // ── Mount: fetch all DRAFT notes ──────────────────────────────────────────
  useEffect(() => {
    async function loadDrafts() {
      try {
        const res = await fetch('/api/notes?status=DRAFT')
        if (!res.ok) return
        const notes: NoteItem[] = await res.json()
        setCards(notes)
      } catch {
        // silently ignore
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
        const body = await res.json()
        const note = body.data ?? body
        setCards((prev) => [note, ...prev])
      } catch {
        // Network error — ignore
      }
    }

    window.addEventListener('zf:draft', onDraft)
    return () => window.removeEventListener('zf:draft', onDraft)
  }, [])

  // ── SSE listener ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (typeof window === 'undefined' || typeof EventSource === 'undefined') return

    const es = new EventSource('/api/events')

    es.addEventListener('note-processed', (e) => {
      try {
        const data = JSON.parse((e as MessageEvent).data) as SSEEvent
        if (!data?.noteId) return
        if (!cardsRef.current.some((c) => c.id === data.noteId)) return

        setCards((prev) => prev.filter((c) => c.id !== data.noteId))
        setCardStates((prev) => {
          const next = { ...prev }
          delete next[data.noteId]
          return next
        })

        if (data.status === 'promoted') {
          showToast('Nota enviada a revisión.', 'success')
        } else if (data.status === 'already_processed') {
          showToast('Esta nota ya estaba procesada.', 'success')
        } else {
          showToast(`Guardado en Hub ${data.domain}`.trim(), 'success', data.domain)
        }
      } catch {
        // Payload malformado — ignorar
      }
    })

    es.onerror = () => {
      // EventSource ya reintenta solo
    }

    return () => es.close()
  }, [showToast])

  // ── Per-card process handler ──────────────────────────────────────────────
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
          const body = (await res.json()) as { data?: { note?: { domain?: string } } }
          const domain = body.data?.note?.domain ?? ''
          setCards((prev) => prev.filter((c) => c.id !== noteId))
          setCardStates((prev) => {
            const next = { ...prev }
            delete next[noteId]
            return next
          })
          if (domain) showToast(`Guardado en Hub ${domain}`.trim(), 'success', domain)
          return
        } else if (res.status === 409) {
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
      <div className="mb-4 flex items-center justify-between">
        <p className="text-[10px] tracking-[0.2em] text-accent uppercase">INBOX</p>
        {cards.length >= 1 && (
          <button
            onClick={() => void processAll()}
            className="text-[10px] tracking-wider text-accent uppercase hover:underline"
          >
            Procesar todo
          </button>
        )}
      </div>

      {cards.length === 0 && (
        <div
          data-testid="inbox-empty"
          className="border border-border bg-surface px-4 py-6 text-center"
        >
          <p className="text-sm text-fg-faint italic">Inbox vacío</p>
        </div>
      )}

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
  card: NoteItem
  state: CardState
}

function InboxCard({ card, state }: InboxCardProps) {
  return (
    <div data-testid="inbox-card" data-note-id={card.id} className="border border-border bg-surface px-4 py-3">
      <p className="text-sm text-fg truncate">{card.title}</p>
      {card.content && (
        <p className="mt-0.5 text-xs text-fg-faint truncate">{card.content.slice(0, 80)}</p>
      )}

      <div className="mt-2 flex items-center gap-2">
        {state.tag === 'processing' && (
          <span className="text-[10px] uppercase tracking-wider text-fg-faint flex items-center gap-1.5">
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
