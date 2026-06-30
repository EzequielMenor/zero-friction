import type { Metadata } from "next";
import { Inter, Playfair_Display } from 'next/font/google';
import "./globals.css";
import CaptureOverlay from '@/components/CaptureOverlay';
import NavMenu from '@/components/NavMenu';

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
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="es"
      className={`${inter.variable} ${playfair.variable} dark antialiased`}
    >
      <body className="min-h-screen bg-[#000000] text-[#A1A1AA] font-sans selection:bg-[#A68966] selection:text-black flex flex-col relative">
        {/* Noise texture */}
        <div
          className="fixed inset-0 pointer-events-none z-0 opacity-[0.03]"
          style={{ backgroundImage: 'url("data:image/svg+xml,%3Csvg viewBox=\'0 0 200 200\' xmlns=\'http://www.w3.org/2000/svg\'%3E%3Cfilter id=\'noiseFilter\'%3E%3CfeTurbulence type=\'fractalNoise\' baseFrequency=\'0.65\' numOctaves=\'3\' stitchTiles=\'stitch\'/%3E%3C/filter%3E%3Crect width=\'100%25\' height=\'100%25\' filter=\'url(%23noiseFilter)\'/%3E%3C/svg%3E")' }}
        />

        {/* Sidebar nav (desktop) + Bottom bar (mobile) */}
        <NavMenu />

        {/* Main content — sidebar offset on desktop, full width on mobile */}
        <div className="relative z-10 flex-1 flex flex-col md:ml-[220px]">
          <main className="max-w-[720px] mx-auto w-full flex-1 px-6 pb-24 pt-8">
            {children}
          </main>
        </div>

        {/* Capture Overlay — floating trigger */}
        <CaptureOverlay />
      </body>
    </html>
  );
}
