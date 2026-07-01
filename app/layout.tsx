import type { Metadata, Viewport } from "next";
import { Inter, Playfair_Display } from 'next/font/google';
import "./globals.css";
import CaptureOverlay from '@/components/CaptureOverlay';
import NavMenu from '@/components/NavMenu';
import ServiceWorkerRegistrar from '@/components/pwa/ServiceWorkerRegistrar';
import { ThemeProvider, themeScript } from '@/components/ThemeProvider';

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
  display: 'swap',
});

const playfair = Playfair_Display({
  subsets: ['latin'],
  variable: '--font-playfair',
  display: 'swap',
});

export const metadata: Metadata = {
  title: "Monograph | Zero-Friction OS",
  description: "Sistema operativo personal basado en captura sin fricción.",
  applicationName: "Monograph",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "Monograph",
    statusBarStyle: "black-translucent",
  },
  icons: {
    icon: [
      { url: "/icon-192x192.png", sizes: "192x192", type: "image/png" },
      { url: "/icon-512x512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [
      { url: "/apple-icon-180x180.png", sizes: "180x180", type: "image/png" },
    ],
  },
};

export const viewport: Viewport = {
  themeColor: "#A68966",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="es"
      className={`${inter.variable} ${playfair.variable} antialiased`}
      suppressHydrationWarning
    >
      <head>
        {/* Anti-FOUC: aplica clase .dark antes del primer paint */}
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="min-h-screen bg-bg text-fg-muted font-sans selection:bg-accent selection:text-accent-fg flex flex-col relative">
        <ThemeProvider>
          {/* Noise texture */}
          <div
            className="fixed inset-0 pointer-events-none z-0 opacity-[0.03]"
            style={{ backgroundImage: 'url("data:image/svg+xml,%3Csvg viewBox=\'0 0 200 200\' xmlns=\'http://www.w3.org/2000/svg\'%3E%3Cfilter id=\'noiseFilter\'%3E%3CfeTurbulence type=\'fractalNoise\' baseFrequency=\'0.65\' numOctaves=\'3\' stitchTiles=\'stitch\'/%3E%3C/filter%3E%3Crect width=\'100%25\' height=\'100%25\' filter=\'url(%23noiseFilter)\'/%3E%3C/svg%3E")' }}
          />

          {/* Sidebar nav (desktop) + Bottom bar (mobile) */}
          <NavMenu />

          {/* Route group content — (auth) has no offset; (app) adds its own ml-[220px] */}
          {children}

          {/* Capture Overlay — floating trigger */}
          <CaptureOverlay />

          {/* PWA service worker — solo se registra en producción */}
          <ServiceWorkerRegistrar />
        </ThemeProvider>
      </body>
    </html>
  );
}
