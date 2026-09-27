'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

const NAV = [
  { label: 'Overview', href: '/admin' },
  { label: 'Users', href: '/admin/users' },
  { label: 'Sweeps', href: '/admin/sweeps' },
  { label: 'Cohorts', href: '/admin/cohorts' },
  { label: 'Support', href: '/admin/support' },
  { label: 'Enterprise', href: '/admin/enterprise/ingest' },
  { label: 'Sweep Health', href: '/admin/enterprise/sweep-health' },
]

export default function AdminNav() {
  const pathname = usePathname()

  return (
    <div className="flex items-center gap-1 mb-6 border-b border-[var(--border)] pb-4">
      <span className="text-[11px] font-semibold uppercase tracking-widest text-[var(--text3)] mr-4">Admin</span>
      {NAV.map(item => {
        const active = item.href === '/admin'
          ? pathname === '/admin'
          : pathname.startsWith(item.href)
        return (
          <Link
            key={item.href}
            href={item.href}
            className={`px-3 py-1.5 rounded-lg text-[13px] font-medium transition-colors ${
              active
                ? 'bg-navy text-white'
                : 'text-[var(--text3)] hover:text-[var(--text)] hover:bg-[var(--gray-lt)]'
            }`}
          >
            {item.label}
          </Link>
        )
      })}
    </div>
  )
}
