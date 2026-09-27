import { createServiceClient } from '@/lib/supabase/server'
import { getSweepHealth } from '@/lib/enterprise/sweep-health'
import SweepHealthClient from './SweepHealthClient'

export const dynamic = 'force-dynamic'

export default async function SweepHealthPage() {
  const supabase = createServiceClient()
  const initial = await getSweepHealth(supabase)

  return (
    <div>
      <div className="mb-8">
        <p className="text-[10px] font-semibold uppercase tracking-widest text-[var(--text3)] mb-1">
          Meridian Fusion · Admin
        </p>
        <h1
          className="text-[24px] font-medium text-[var(--text)] leading-tight mb-1"
          style={{ fontFamily: "'EB Garamond', 'Georgia', serif" }}
        >
          Enterprise Sweep Health
        </h1>
        <p className="text-sm text-[var(--text3)]">Last 72 hours across all institutions</p>
      </div>
      <SweepHealthClient initial={initial} />
    </div>
  )
}
