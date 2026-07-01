// Bus de eventos para "una nota DRAFT terminó de procesarse".
//
// ponytail: EventEmitter singleton en proceso. Funciona perfecto en dev y en
// deploys single-process. Si el deploy se vuelve multi-instancia o serverless
// con aislamiento de procesos, el upgrade path es: la ruta /process escribe
// en una tabla `pending_notifications`, el handler SSE la polea. Mismo
// shape de eventos, swap del backing store. Por ahora, lo más simple.

import { EventEmitter } from 'node:events'

// ─── Tipos ─────────────────────────────────────────────────────────────────────

export type DraftEventStatus = 'ok' | 'promoted' | 'already_processed'

export interface NoteProcessedEvent {
  noteId: string
  domain: string
  status: DraftEventStatus
  // 'promoted' = DRAFT → NEEDS_REVIEW (AI falló). 'ok' = procesada ok.
}

// ─── Bus singleton ────────────────────────────────────────────────────────────

// globalThis para que HMR en dev no nos cree N copies y perdamos listeners.
type Global = typeof globalThis & { __monographDraftBus?: EventEmitter }
const g = globalThis as Global

function getBus(): EventEmitter {
  if (!g.__monographDraftBus) {
    const bus = new EventEmitter()
    // Por defecto EventEmitter warn-ear a >10 listeners. Con un single-user
    // app, conexiones SSE concurrentes son raras; subimos para que Vercel
    // pre-warm no nos grite.
    bus.setMaxListeners(1000)
    g.__monographDraftBus = bus
  }
  return g.__monographDraftBus
}

// ─── API pública ──────────────────────────────────────────────────────────────

const CHANNEL = 'note-processed'

export function emitNoteProcessed(event: NoteProcessedEvent): void {
  getBus().emit(CHANNEL, event)
}

export function onNoteProcessed(handler: (e: NoteProcessedEvent) => void): () => void {
  const bus = getBus()
  bus.on(CHANNEL, handler)
  // Devolver un unsubscribe listo para `useEffect` cleanup.
  return () => bus.off(CHANNEL, handler)
}
