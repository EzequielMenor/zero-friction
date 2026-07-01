// App route group — owns the sidebar offset wrapper.
export default function AppLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div className="relative z-10 flex-1 flex flex-col md:ml-[220px]">
      <main className="max-w-[720px] mx-auto w-full flex-1 px-6 pb-24 pt-8">
        {children}
      </main>
    </div>
  )
}
