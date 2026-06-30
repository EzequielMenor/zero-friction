import type { Metadata } from "next";
import { Inter, Playfair_Display } from 'next/font/google';
import "./globals.css";

// 1. Configuramos nuestras tipografías "Bespoke"
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

// 2. Metadatos de la aplicación (útil para la PWA)
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
      // Aplicamos las variables CSS de las fuentes y forzamos el modo oscuro
      className={`${inter.variable} ${playfair.variable} dark antialiased`}
    >
      {/* 3. Estilos base del body: fondo negro, texto gris elegante y selección dorada */}
      <body className="min-h-screen bg-[#000000] text-[#A1A1AA] font-sans selection:bg-[#A68966] selection:text-black flex flex-col relative">
        
        {/* 4. Textura de ruido de película (Global) */}
        <div 
          className="fixed inset-0 pointer-events-none z-0 opacity-[0.03]" 
          style={{ backgroundImage: 'url("data:image/svg+xml,%3Csvg viewBox=\'0 0 200 200\' xmlns=\'http://www.w3.org/2000/svg\'%3E%3Cfilter id=\'noiseFilter\'%3E%3CfeTurbulence type=\'fractalNoise\' baseFrequency=\'0.65\' numOctaves=\'3\' stitchTiles=\'stitch\'/%3E%3C/filter%3E%3Crect width=\'100%25\' height=\'100%25\' filter=\'url(%23noiseFilter)\'/%3E%3C/svg%3E")' }}
        />

        {/* 5. Header Global (Visible en todos los dominios) */}
        <header className="w-full top-0 sticky z-40 bg-[#000000]/90 backdrop-blur-md">
          <div className="max-w-[720px] mx-auto px-6 py-8 flex items-center justify-center border-b border-[#1A1A1A]">
            <h1 className="font-sans text-[12px] font-semibold tracking-[0.2em] text-[#A68966] uppercase">
              Monograph
            </h1>
          </div>
        </header>

        {/* 6. Contenedor Dinámico (Aquí se renderizará el page.tsx de cada Hub) */}
        <main className="relative z-10 max-w-[720px] mx-auto w-full flex-1 px-6 pb-24 pt-8">
          {children}
        </main>

        {/* TODO: Aquí inyectaremos el Menú Flotante (FAB) en el siguiente paso */}
      </body>
    </html>
  );
}