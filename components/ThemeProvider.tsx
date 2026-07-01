'use client'

import { createContext, useContext, useEffect, useState } from 'react'

export type Theme = 'dark' | 'light'

interface ThemeContextValue {
  theme: Theme
  setTheme: (t: Theme) => void
  toggleTheme: () => void
}

const ThemeContext = createContext<ThemeContextValue>({
  theme: 'dark',
  setTheme: () => {},
  toggleTheme: () => {},
})

/**
 * Script inline que se inyecta en <head> antes del primer paint.
 * Lee localStorage y aplica la clase .dark. Sin esto hay FOUC.
 *
 * Lógica:
 *   - localStorage('theme') === 'light' → no añade .dark → light
 *   - cualquier otro caso (null, 'dark') → añade .dark → dark
 *   Default = dark preserva comportamiento para usuarios existentes.
 */
export const themeScript = `
(function() {
  try {
    var t = localStorage.getItem('theme');
    if (t !== 'light') document.documentElement.classList.add('dark');
  } catch (e) {}
})();
`

function getStoredTheme(): Theme {
  if (typeof window === 'undefined') return 'dark'
  return (localStorage.getItem('theme') as Theme | null) ?? 'dark'
}

function subscribeToStorage(callback: () => void) {
  window.addEventListener('storage', callback)
  return () => window.removeEventListener('storage', callback)
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  // Inicialización lazy: lee localStorage solo en cliente, default = dark
  const [theme, setThemeState] = useState<Theme>(getStoredTheme)

  // Sincroniza cross-tab: si cambia en otra pestaña, re-renderiza
  useEffect(() => {
    const unsubscribe = subscribeToStorage(() => {
      setThemeState(getStoredTheme())
    })
    return unsubscribe
  }, [])

  function setTheme(t: Theme) {
    setThemeState(t)
    localStorage.setItem('theme', t)
    document.documentElement.classList.toggle('dark', t === 'dark')
  }

  function toggleTheme() {
    setTheme(theme === 'dark' ? 'light' : 'dark')
  }

  return (
    <ThemeContext.Provider value={{ theme, setTheme, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  )
}

export function useTheme() {
  return useContext(ThemeContext)
}
