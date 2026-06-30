'use client'

import { usePathname } from 'next/navigation'
import Link from 'next/link'
import { HUBS } from '@/lib/hubs'

function NavItem({
  href,
  emoji,
  label,
  isActive,
  isDesktop,
}: {
  href: string
  emoji: string
  label: string
  isActive: boolean
  isDesktop: boolean
}) {
  return (
    <Link
      href={href}
      className={[
        'flex items-center gap-2.5 transition-colors duration-150',
        isDesktop
          ? 'px-3 py-2 text-xs border-l-2 border-transparent hover:border-[#A68966]/40'
          : 'flex-col py-2 px-3 text-center text-[10px]',
        isActive
          ? isDesktop
            ? 'border-[#A68966] text-[#A68966]'
            : 'text-[#A68966]'
          : 'text-[#5A5A5A] hover:text-[#A68966]/80',
      ].join(' ')}
      style={isDesktop && isActive ? { borderLeftColor: '#A68966' } : undefined}
    >
      {emoji && <span className="text-base leading-none">{emoji}</span>}
      <span
        className={isDesktop ? 'tracking-[0.12em] uppercase' : 'tracking-[0.1em] uppercase mt-0.5'}
      >
        {label}
      </span>
    </Link>
  )
}

export default function NavMenu() {
  const pathname = usePathname()
  const isAuthPage = pathname === '/login' || pathname === '/signup'

  if (isAuthPage) return null

  return (
    <>
      {/* Desktop sidebar — fixed left */}
      <nav
        className="hidden md:flex fixed left-0 top-0 h-full w-[220px] flex-col bg-[#000000]/95 backdrop-blur-md border-r border-[#1A1A1A] z-30"
        aria-label="Navegación principal"
      >
        {/* Wordmark */}
        <div className="px-6 py-8 border-b border-[#1A1A1A]">
          <span className="font-sans text-[11px] font-semibold tracking-[0.2em] text-[#A68966] uppercase">
            Monograph
          </span>
        </div>

        {/* Nav items */}
        <div className="flex flex-col gap-1 px-3 py-6 flex-1">
          {/* Today */}
          <NavItem
            href="/"
            emoji=""
            label="Today"
            isActive={pathname === '/'}
            isDesktop
          />
          {/* Hubs */}
          {HUBS.map((hub) => {
            const href = `/hubs/${hub.slug}`
            const isActive = pathname === href || pathname.startsWith(`${href}/`)
            return (
              <NavItem
                key={hub.slug}
                href={href}
                emoji={hub.emoji}
                label={hub.label}
                isActive={isActive}
                isDesktop
              />
            )
          })}
        </div>
      </nav>

      {/* Mobile bottom bar — fixed bottom, horizontally scrollable */}
      <nav
        className="md:hidden fixed bottom-0 left-0 right-0 z-30 bg-[#000000]/95 backdrop-blur-md border-t border-[#1A1A1A] flex items-center overflow-x-auto"
        style={{ scrollbarWidth: 'none' } as React.CSSProperties}
        aria-label="Navegación principal"
      >
        {/* Today */}
        <NavItem
          href="/"
          emoji=""
          label="Today"
          isActive={pathname === '/'}
          isDesktop={false}
        />
        {/* Hubs */}
        {HUBS.map((hub) => {
          const href = `/hubs/${hub.slug}`
          const isActive = pathname === href || pathname.startsWith(`${href}/`)
          return (
            <NavItem
              key={hub.slug}
              href={href}
              emoji={hub.emoji}
              label={hub.label}
              isActive={isActive}
              isDesktop={false}
            />
          )
        })}
      </nav>
    </>
  )
}
