'use client'

// Service Worker registrar — client component mínimo.
// ponytail: solo registra /sw.js una vez por sesión. No hace falta UI:
// los navegadores exponen su propio prompt de instalación. Si el SW falla
// en registrar (entorno sin https, sandbox), lo silenciamos.

import { useEffect } from 'react'

export default function ServiceWorkerRegistrar() {
  useEffect(() => {
    if (typeof window === 'undefined') return
    if (!('serviceWorker' in navigator)) return
    if (process.env.NODE_ENV !== 'production') return

    const onLoad = () => {
      navigator.serviceWorker
        .register('/sw.js', { scope: '/' })
        .catch((err) => {
          console.warn('[pwa] SW registration failed', err)
        })
    }

    // Registrar después de que la página termine de cargar — más rápido TTI.
    if (document.readyState === 'complete') {
      onLoad()
    } else {
      window.addEventListener('load', onLoad, { once: true })
      return () => window.removeEventListener('load', onLoad)
    }
  }, [])

  return null
}
