import { useContext } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { AppContext } from '../context/AppContext'
import { Sun, Moon, Library, LogOut, Home, RadioTower, ListChecks, Settings, CalendarDays, Sparkles } from 'lucide-react'

export default function Header() {
  const { theme, toggleTheme, user, authRequired, signOut, account, onboarding } = useContext(AppContext)
  const location = useLocation()

  const navLink = (to, label, Icon) => (
    <Link
      to={to}
      className="nav-pill px-3 py-2 rounded-lg text-sm flex items-center gap-2 transition-all"
      data-active={location.pathname === to}
      style={{
        color: location.pathname === to ? 'var(--text)' : 'var(--muted)',
        background: location.pathname === to ? 'rgba(var(--accent-rgb),0.12)' : 'transparent',
      }}
    >
      <Icon size={13} /> {label}
    </Link>
  )

  return (
    <header className="w-full sticky top-0 z-30 border-b glass-header" style={{ borderColor: 'var(--border)' }}>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link to="/" className="flex items-center gap-3">
            <div className="brand-mark w-9 h-9 rounded-lg flex items-center justify-center">
              <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M5 15c2.8-6 6-9 9.5-9C17.2 6 19 7.7 19 10c0 2.6-2.3 4-5.3 3.4" />
                <path d="M4 18c3.7-2 7.1-2.8 10.3-2.3 2.2.3 4 1.2 5.5 2.8" />
              </svg>
            </div>
            <div>
              <h1 className="font-semibold text-lg leading-none tracking-tight">semaje</h1>
              <p className="brand-subtitle hidden sm:block text-[11px]" style={{ color: 'var(--muted)' }}>{account.workspaceName}</p>
            </div>
          </Link>
          <nav className="hidden sm:flex items-center gap-1 ml-4">
            {navLink('/', 'Capture', Home)}
            {navLink('/meetings', 'Meetings', CalendarDays)}
            {navLink('/library', 'Library', Library)}
            {navLink('/settings/intelligence', 'Intelligence', Sparkles)}
            {navLink('/settings/platform', 'Platform', Settings)}
            {!onboarding.completed && navLink('/onboarding', 'Setup', ListChecks)}
          </nav>
        </div>
        <div className="flex items-center gap-2">
          <div className="hidden md:flex items-center gap-2 rounded-full border px-3 py-2 text-xs font-mono"
            style={{ borderColor: 'var(--border)', color: 'var(--muted)', background: 'var(--surface)' }}>
            <RadioTower size={13} style={{ color: 'var(--accent)' }} />
            Self-host ready
          </div>
          <button
            onClick={toggleTheme}
            className="icon-button p-2.5 rounded-lg transition-colors"
            title="Toggle theme"
          >
            {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
          </button>
          {authRequired && user && (
            <button
              onClick={signOut}
              className="icon-button p-2.5 rounded-lg transition-colors"
              title="Sign out"
            >
              <LogOut size={16} />
            </button>
          )}
        </div>
      </div>
    </header>
  )
}
