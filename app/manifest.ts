import type { MetadataRoute } from 'next'

// Web App Manifest vía MetadataRoute — Next.js lo sirve como /manifest.webmanifest.
// ponytail: solo lo justo para que el navegador ofrezca "instalar". Iconos
// son los PNGs planos generados en /public. El designer los reemplaza cuando
// quiera; los `sizes` y rutas no cambian.

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Monograph | Zero-Friction OS',
    short_name: 'Monograph',
    description: 'Sistema operativo personal basado en captura sin fricción.',
    start_url: '/',
    display: 'standalone',
    background_color: '#1C1C1E',
    theme_color: '#A68966',
    icons: [
      {
        src: '/icon-192x192.png',
        sizes: '192x192',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/icon-512x512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/icon-512x512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
  }
}
