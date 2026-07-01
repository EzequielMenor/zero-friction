// GET /api/events — stream SSE de "notas procesadas".
//
// Conecta al bus de draft-events y reenvía cada `note-processed` al cliente
// como un evento SSE con nombre. Keepalive cada 25s para que intermediaries
// (proxies, serverless edge) no maten la conexión por idle.
//
// ponytail: la autenticación es por cookie (mismo sistema que el resto de la
// app). Si no hay sesión → 401 al toque. Single-user app: una conexión por
// navegador, no esperamos fan-out masivo.

import type { NextRequest } from 'next/server'
import { cookies } from 'next/headers'
import { AUTH_COOKIE, verifySession } from '@/lib/auth'
import { onNoteProcessed, type NoteProcessedEvent } from '@/lib/draft-events'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs' // EventEmitter nativo de Node.

const KEEPALIVE_MS = 25_000

export async function GET(req: NextRequest): Promise<Response> {
  // Auth — la cookie tiene que matchear la sesión. Sin esto, cualquiera con
  // un EventSource abierto podría leer las notas del usuario.
  const cookieStore = await cookies()
  const token = cookieStore.get(AUTH_COOKIE)?.value
  const session = token ? verifySession(token) : null
  if (!session) {
    return new Response('unauthenticated', { status: 401 })
  }

  // req.signal avisa cuando el cliente corta la conexión.
  const signal = req.signal

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder()

      // Helper: serializa un evento SSE con nombre.
      const send = (event: string, data: unknown) => {
        const payload =
          `event: ${event}\n` +
          `data: ${JSON.stringify(data)}\n\n`
        try {
          controller.enqueue(encoder.encode(payload))
        } catch {
          // Stream ya cerrado — el cleanup se encarga.
        }
      }

      // Saludo inicial para que el cliente sepa que la conexión está viva.
      // EventSource lo entrega como un message genérico, lo ignoramos en el
      // listener porque solo nos interesa 'note-processed'.
      send('connected', { ts: Date.now() })

      // Suscribirse al bus.
      const unsubscribe = onNoteProcessed((evt: NoteProcessedEvent) => {
        send('note-processed', evt)
      })

      // Keepalive periódico (comentario SSE — el cliente lo ignora).
      const keepalive = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(': keepalive\n\n'))
        } catch {
          // Stream cerrado.
        }
      }, KEEPALIVE_MS)

      // Cleanup cuando el cliente cierra (navegador, navegación, etc).
      const cleanup = () => {
        clearInterval(keepalive)
        unsubscribe()
        try {
          controller.close()
        } catch {
          // Ya estaba cerrado.
        }
      }

      if (signal) {
        if (signal.aborted) {
          cleanup()
        } else {
          signal.addEventListener('abort', cleanup, { once: true })
        }
      }
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      // X-Accel-Buffering desactiva buffering en nginx (relevante si hay
      // un reverse proxy delante; inocuo si no).
      'X-Accel-Buffering': 'no',
    },
  })
}
