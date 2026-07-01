'use client'

import { useEffect } from 'react'
import Link from 'next/link'

interface ToastProps {
  message: string
  href?: string
  onDismiss: () => void
}

export function Toast({ message, href, onDismiss }: ToastProps) {
  useEffect(() => {
    const t = setTimeout(onDismiss, 3000)
    return () => clearTimeout(t)
  }, [onDismiss])

  return (
    <div className="fixed bottom-8 right-6 z-50 flex items-center gap-3 bg-graphite-border border border-[#A68966]/40 px-4 py-2 text-sm text-[#E3E2E2] animate-fade-in">
      <span>{message}</span>
      {href && (
        <Link href={href} className="text-[#A68966] hover:underline whitespace-nowrap">
          Ver nota →
        </Link>
      )}
    </div>
  )
}
