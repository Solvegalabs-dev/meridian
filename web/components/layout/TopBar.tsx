'use client'

import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'
import { LogOut, User, Menu } from 'lucide-react'
import { useState } from 'react'
import SweepButton from '@/components/dashboard/SweepButton'
import HelpMenu from '@/components/tutorial/HelpMenu'

interface TopBarProps {
  title?: string
  subtitle?: string
  userEmail?: string
  lastSweepAt?: string | null
  nextSweepAt?: string | null
  onMenuClick?: () => void
  onOpenTutorial?: () => void
  onOpenKeyTerms?: () => void
}

export default function TopBar({
  title = 'Mission Control',
  subtitle,
  userEmail,
  lastSweepAt,
  nextSweepAt,
  onMenuClick,
  onOpenTutorial,
  onOpenKeyTerms,
}: TopBarProps) {
  const router = useRouter()
  const supabase = createClient()
  const [menuOpen, setMenuOpen] = useState(false)

  async function handleSignOut() {
    await supabase.auth.signOut()
    router.push('/login')
    router.refresh()
  }

  return (
    <header className="min-h-14 border-b border-[var(--border)] bg-white flex items-center justify-between px-4 md:px-6 sticky top-0 z-40 gap-3">
      <div className="flex items-center gap-3 min-w-0">
        {/* Hamburger — mobile only */}
        <button
          onClick={onMenuClick}
          className="md:hidden flex-shrink-0 w-9 h-9 flex items-center justify-center rounded-lg text-[var(--text2)] hover:bg-[var(--gray-lt)] transition-colors"
          aria-label="Open menu"
        >
          <Menu size={20} />
        </button>

        <div className="min-w-0">
          <h1 className="text-[15px] font-medium text-[var(--text)] truncate">{title}</h1>
          {subtitle && <p className="text-[11px] text-[var(--text3)] truncate">{subtitle}</p>}
        </div>
      </div>

      <div className="flex items-center gap-2 flex-shrink-0">
        {/* Strike: the phone brief for hunts. Mission Control had no way in before. */}
        <Link
          href="/strike"
          className="text-[13px] font-medium text-[var(--text2)] hover:text-[var(--text)] px-2 py-1.5 rounded-lg hover:bg-[var(--gray-lt)] transition-colors"
        >
          Strike
        </Link>

        <SweepButton lastSweepAt={lastSweepAt} nextSweepAt={nextSweepAt} />

        {/* Help & Tour */}
        {onOpenTutorial && onOpenKeyTerms && (
          <HelpMenu onOpenTutorial={onOpenTutorial} onOpenKeyTerms={onOpenKeyTerms} />
        )}

        {/* User menu — hidden on smallest screens to save space */}
        <div className="relative hidden sm:block">
          <button
            onClick={() => setMenuOpen(!menuOpen)}
            className="w-8 h-8 rounded-full bg-[var(--code-bg)] border border-[var(--border)] flex items-center justify-center hover:bg-[var(--gray-lt)] transition-colors"
          >
            <User size={14} className="text-[var(--text2)]" />
          </button>

          {menuOpen && (
            <div className="absolute right-0 top-10 w-48 bg-white border border-[var(--border)] rounded-xl shadow-lg py-1 z-50">
              {userEmail && (
                <div className="px-3 py-2 text-[11px] text-[var(--text3)] border-b border-[var(--border)]">
                  {userEmail}
                </div>
              )}
              <button
                onClick={handleSignOut}
                className="w-full flex items-center gap-2 px-3 py-2 text-[13px] text-[var(--text2)] hover:bg-[var(--gray-lt)] transition-colors"
              >
                <LogOut size={13} />
                Sign out
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  )
}
