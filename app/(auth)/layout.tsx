// Auth route group — centered layout with Monograph wordmark header.
// No sidebar offset; auth pages self-center via flex utilities.
export default function AuthLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <>
      {/* Monograph wordmark header — restored from pre-4.1 layout */}
      <header className="w-full top-0 sticky z-40 bg-graphite/90 backdrop-blur-md">
        <div className="max-w-[720px] mx-auto px-6 py-8 flex items-center justify-center border-b border-graphite-border">
          <h1 className="font-sans text-[12px] font-semibold tracking-[0.2em] text-[#A68966] uppercase">
            Monograph
          </h1>
        </div>
      </header>

      {/* Auth pages render their own centered form via flex utilities */}
      {children}
    </>
  )
}
