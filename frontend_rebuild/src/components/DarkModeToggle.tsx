import { useEffect, useState } from 'react'
import { Moon, Sun } from 'lucide-react'

const STORAGE_KEY = 'vermilinks-theme'

type ThemeMode = 'light' | 'dark'

const getInitialTheme = (): ThemeMode => {
  const stored = localStorage.getItem(STORAGE_KEY)
  if (stored === 'dark' || stored === 'light') {
    return stored
  }
  const prefersDark = window.matchMedia?.('(prefers-color-scheme: dark)').matches
  return prefersDark ? 'dark' : 'light'
}

const applyTheme = (mode: ThemeMode) => {
  const root = document.documentElement
  if (mode === 'dark') {
    root.classList.add('dark')
  } else {
    root.classList.remove('dark')
  }
}

const DarkModeToggle = () => {
  const [mode, setMode] = useState<ThemeMode>(() => getInitialTheme())

  useEffect(() => {
    applyTheme(mode)
    localStorage.setItem(STORAGE_KEY, mode)
  }, [mode])

  const toggleMode = () => {
    setMode((current) => (current === 'dark' ? 'light' : 'dark'))
  }

  return (
    <button
      type="button"
      onClick={toggleMode}
      className="inline-flex items-center gap-2 rounded-full border border-coffee-200 bg-white/80 px-4 py-2 text-sm font-semibold text-espresso-700 shadow-sm transition hover:bg-coffee-50 dark:border-gray-700 dark:bg-gray-900/70 dark:text-gray-200 dark:hover:bg-gray-800"
      aria-label="Toggle dark mode"
    >
      {mode === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
      {mode === 'dark' ? 'Light' : 'Dark'}
    </button>
  )
}

export default DarkModeToggle
