import Link from 'next/link'
import { ChevronLeft, HelpCircle } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { getEffectiveTier } from '@/lib/tiers'
import MeridianBeacon from '@/components/brand/MeridianBeacon'
import AskThreadClient from './AskThreadClient'

const ASK_LIMITS: Record<string, number> = {
  command: 20,
  accelerator: 10,
  explorer: 5,
}

export default async function AskPage({ searchParams }: { searchParams: { q?: string } }) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const monthStart = new Date()
  monthStart.setDate(1)
  monthStart.setHours(0, 0, 0, 0)

  const [{ data: objectives }, { data: latestSweep }, { data: profile }, { count: monthlyCount }] = await Promise.all([
    supabase.from('objectives').select('id, title, confidence, confidence_prev, category, status').eq('user_id', user!.id).eq('status', 'active'),
    supabase.from('sweeps').select('summary, raw_response, completed_at').eq('user_id', user!.id).eq('status', 'complete').not('raw_response', 'is', null).order('completed_at', { ascending: false }).limit(1).single(),
    supabase.from('profiles').select('tier, pricing_tier, complimentary_expires_at, ask_credits, account_type').eq('id', user!.id).single(),
    supabase.from('ask_queries').select('id', { count: 'exact', head: true }).eq('user_id', user!.id).gte('created_at', monthStart.toISOString()),
  ])

  const objectiveList = objectives ?? []
  const openingMessage = `I know your ${objectiveList.length} active goal${objectiveList.length !== 1 ? 's' : ''} and everything from your last scan. What do you want to understand?`

  const effectiveTier = profile ? getEffectiveTier(profile) : 'trial'
  const baseLimit = ASK_LIMITS[effectiveTier] ?? 0
  const used = monthlyCount ?? 0
  const remaining = Math.max(0, baseLimit - used)
  const askCredits = profile?.ask_credits ?? 0

  return (
    <div className="-m-6 p-6 min-h-[calc(100vh-3.5rem)]" style={{ backgroundColor: 'var(--navy)' }}>
      <div className="flex items-center gap-3 mb-4 max-w-2xl mx-auto">
        <Link href="/dashboard" aria-label="Back to dashboard" style={{ color: 'var(--ov-text-mid)' }}>
          <ChevronLeft size={20} />
        </Link>
        <MeridianBeacon size={22} variant="gold" animate={false} />
        <p style={{ fontFamily: "'EB Garamond', Georgia, serif", fontStyle: 'italic', fontSize: 16, color: '#fff' }}>
          Ask Meridian
        </p>
        <Link href="/settings?tab=billing" className="ml-auto text-[11px] font-medium" style={{ color: 'var(--ov-text-dim)' }}>
          Credits: {remaining} / {baseLimit}
        </Link>
      </div>

      {/* Description + credit balance */}
      <div className="max-w-2xl mx-auto mb-4 flex items-start justify-between gap-4">
        <p className="text-[12px] leading-relaxed" style={{ color: 'var(--ov-text-mid)' }}>
          Ask anything about your goals or the world. Meridian routes goal questions to its reasoning engine and world questions to live web intelligence — automatically.
        </p>
        <div className="flex-shrink-0 text-right">
          <p className="text-[11px] font-semibold" style={{ color: 'var(--ov-text-dim)' }}>
            Ask Credits
          </p>
          <p className="text-[12px] font-medium" style={{ color: remaining > 0 ? 'var(--ov-text-hi)' : 'var(--ov-amber)' }}>
            {remaining}/{baseLimit} monthly · {askCredits} credit{askCredits !== 1 ? 's' : ''}
          </p>
          <p className="text-[10px] mt-0.5" style={{ color: 'var(--ov-text-dim)' }}>
            Goal questions use 2 credits · World questions use 1 credit
          </p>
          <Link href="/settings#billing" className="text-[10px]" style={{ color: 'var(--gold)' }}>
            Add credits →
          </Link>
          <div className="relative group flex items-center justify-end gap-1 mt-1">
            <Link href="/ask/history" className="text-[10px]" style={{ color: 'var(--gold)' }}>
              History
            </Link>
            <HelpCircle size={10} style={{ color: 'var(--gold)', flexShrink: 0 }} />
            <div
              className="absolute bottom-full right-0 mb-1.5 w-52 px-3 py-2 rounded-lg text-[11px] leading-relaxed pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity z-10"
              style={{ backgroundColor: 'var(--ov-navy-card)', border: '1px solid var(--ov-border-md)', color: 'var(--ov-text-mid)' }}
            >
              View past Ask Meridian conversations for reference.
            </div>
          </div>
        </div>
      </div>

      <AskThreadClient
        openingMessage={openingMessage}
        objectives={objectiveList}
        latestSweep={latestSweep ?? null}
        initialQuestion={searchParams.q}
      />
    </div>
  )
}
