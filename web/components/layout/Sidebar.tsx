'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  Home,
  Newspaper,
  Target,
  TrendingUp,
  MessageCircle,
  Settings,
  ChevronRight,
  X,
  Building2,
} from 'lucide-react'
import MeridianArcWordmark from '@/components/brand/MeridianArcWordmark'

const navItems = [
  { href: '/dashboard', label: 'Dashboard', icon: Home },
  { href: '/sweep/latest', label: "This week's brief", icon: Newspaper, activeMatch: '/sweep' },
  { href: '/objectives', label: 'Your goals', icon: Target },
  { href: '/predictions', label: 'Predictions', icon: TrendingUp },
  { href: '/ask', label: 'Ask Meridian', icon: MessageCircle },
  { href: '/enterprise', label: 'Enterprise', icon: Building2 },
  { href: '/settings', label: 'Settings', icon: Settings },
]

interface SidebarProps {
  isOpen?: boolean
  onClose?: () => void
}

export default function Sidebar({ isOpen = false, onClose }: SidebarProps) {
  const pathname = usePathname()

  return (
    <aside
      className={[
        'fixed top-0 left-0 w-60 h-screen bg-navy overflow-y-auto z-50 flex flex-col',
        'transition-transform duration-200 ease-in-out',
        // Mobile: hidden by default, slides in when open
        isOpen ? 'translate-x-0' : '-translate-x-full',
        // Desktop: always visible, override the mobile hidden state
        'md:translate-x-0',
      ].join(' ')}
    >
      {/* Logo + mobile close button */}
      <div className="px-5 py-5 border-b border-white/8 flex items-center justify-between">
        <MeridianArcWordmark size="sm" animate={true} />
        <button
          onClick={onClose}
          className="md:hidden text-white/40 hover:text-white transition-colors p-1 -mr-1"
          aria-label="Close menu"
        >
          <X size={18} />
        </button>
      </div>

      {/* Nav */}
      <nav className="flex-1 py-3">
        <div className="px-5 py-2 text-[8.5px] font-semibold tracking-widest uppercase text-white/28">
          Navigation
        </div>
        {navItems.map(({ href, label, icon: Icon, activeMatch }) => {
          const matchPath = activeMatch ?? href
          const active = pathname === matchPath || pathname.startsWith(matchPath + '/')
          return (
            <Link
              key={href}
              href={href}
              onClick={onClose}
              className={`flex items-center gap-3 px-5 py-2.5 text-[12.5px] transition-all border-l-2 ${
                active
                  ? 'text-white border-l-gold bg-white/4'
                  : 'text-white/55 border-l-transparent hover:text-white hover:border-l-blue-brand'
              }`}
            >
              <Icon size={15} />
              {label}
            </Link>
          )
        })}

        <div className="px-5 py-2 mt-2 text-[8.5px] font-semibold tracking-widest uppercase text-white/28">
          Coming Soon
        </div>
        <div className="flex items-center gap-3 px-5 py-2.5 text-[12.5px] text-white/25 cursor-not-allowed border-l-2 border-l-transparent">
          <ChevronRight size={15} />
          Scenarios
        </div>
      </nav>

    </aside>
  )
}
