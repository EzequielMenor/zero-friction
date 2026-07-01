'use client'

import { usePathname } from 'next/navigation'
import Link from 'next/link'
import { HUBS } from '@/lib/hubs'
import { CalendarIcon, HubIcon, SettingsIcon } from '@/components/icons'
import type { ReactNode } from 'react'

function NavItem({
  href,
  icon,
  label,
  isActive,
  isDesktop,
  children,
}: {
  href: string
  icon?: string
  label: string
  isActive: boolean
  isDesktop: boolean
  children?: ReactNode
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
      {icon ? <HubIcon icon={icon} size={isDesktop ? 16 : 20} /> : children}
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
        className="hidden md:flex fixed left-0 top-0 h-full w-[220px] flex-col bg-graphite/95 backdrop-blur-md border-r border-graphite-border z-30"
        aria-label="Navegación principal"
      >
        {/* Wordmark */}
        <div className="px-6 py-8 border-b border-graphite-border">
          <span className="font-sans text-[11px] font-semibold tracking-[0.2em] text-[#A68966] uppercase">
            Monograph
          </span>
        </div>

        {/* Nav items */}
        <div className="flex flex-col gap-1 px-3 py-6 flex-1">
          {/* Today */}
          <NavItem
            href="/"
            label="Today"
            isActive={pathname === '/'}
            isDesktop
          />
          {/* Calendario */}
          <NavItem
            href="/calendar"
            label="Calendario"
            isActive={pathname === '/calendar'}
            isDesktop
          >
            <CalendarIcon size={16} />
          </NavItem>
          {/* Hubs */}
          {HUBS.map((hub) => {
            const href = `/hubs/${hub.slug}`
            const isActive = pathname === href || pathname.startsWith(`${href}/`)
            return (
              <NavItem
                key={hub.slug}
                href={href}
                icon={hub.icon}
                label={hub.label}
                isActive={isActive}
                isDesktop
              />
            )
          })}
          {/* Mente — neural graph view */}
          <NavItem
            href="/hubs/mente"
            icon="mente"
            label="Mente"
            isActive={pathname === '/hubs/mente'}
            isDesktop
          />
          {/* Ajustes */}
          <NavItem
            href="/settings"
            label="Ajustes"
            isActive={pathname === '/settings'}
            isDesktop
          >
            <SettingsIcon size={16} />
          </NavItem>
        </div>
      </nav>

      {/* Mobile bottom bar — fixed bottom, horizontally scrollable */}
      <nav
        className="md:hidden fixed bottom-0 left-0 right-0 z-30 bg-graphite/95 backdrop-blur-md border-t border-graphite-border flex items-center overflow-x-auto"
        style={{ scrollbarWidth: 'none' } as React.CSSProperties}
        aria-label="Navegación principal"
      >
        {/* Today */}
        <NavItem
          href="/"
          label="Today"
          isActive={pathname === '/'}
          isDesktop={false}
        />
        {/* Calendario */}
        <NavItem
          href="/calendar"
          label="Calendario"
          isActive={pathname === '/calendar'}
          isDesktop={false}
        >
          <CalendarIcon size={20} />
        </NavItem>
        {/* Hubs */}
        {HUBS.map((hub) => {
          const href = `/hubs/${hub.slug}`
          const isActive = pathname === href || pathname.startsWith(`${href}/`)
          return (
            <NavItem
              key={hub.slug}
              href={href}
              icon={hub.icon}
              label={hub.label}
              isActive={isActive}
              isDesktop={false}
            />
          )
        })}
        {/* Mente — neural graph view */}
        <NavItem
          href="/hubs/mente"
          icon="mente"
          label="Mente"
          isActive={pathname === '/hubs/mente'}
          isDesktop={false}
        />
        {/* Ajustes */}
        <NavItem
          href="/settings"
          label="Ajustes"
          isActive={pathname === '/settings'}
          isDesktop={false}
        >
          <SettingsIcon size={20} />
        </NavItem>
      </nav>
    </>
  )
}
