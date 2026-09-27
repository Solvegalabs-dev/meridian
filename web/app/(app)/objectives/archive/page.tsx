import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { ChevronLeft } from 'lucide-react'
import { ArchivedGoalRow } from '@/components/objectives/ArchivedGoalRow'

export default async function ArchivePage() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: objectives } = await supabase
    .from('objectives')
    .select('*, objective_outcomes(outcome_type, outcome_note, actual_completed_at, swept_at_close, prediction_id, recorded_at)')
    .eq('user_id', user.id)
    .in('status', ['closed', 'achieved', 'abandoned', 'archived'])
    .order('updated_at', { ascending: false })

  const goals = objectives ?? []

  return (
    <div>
      <div className="flex items-center gap-3 mb-6">
        <Link href="/objectives" className="flex items-center gap-1 text-[12px]" style={{ color: 'var(--text3)' }}>
          <ChevronLeft size={14} /> Back to goals
        </Link>
      </div>

      <div className="flex items-baseline justify-between mb-4">
        <h1 className="text-[20px] font-semibold" style={{ color: 'var(--text)' }}>Archived Goals</h1>
        <span className="text-[12px]" style={{ color: 'var(--text3)' }}>
          {goals.length} goal{goals.length !== 1 ? 's' : ''}
        </span>
      </div>

      {goals.length === 0 ? (
        <div className="text-center py-16">
          <p className="text-[15px] font-medium mb-2" style={{ color: 'var(--text)' }}>No archived goals yet</p>
          <p className="text-[13px] mb-6" style={{ color: 'var(--text3)' }}>
            Goals you close or abandon will appear here for reference.
          </p>
          <Link href="/objectives" className="text-[13px] font-medium" style={{ color: 'var(--blue)' }}>
            ← Back to active goals
          </Link>
        </div>
      ) : (
        <>
          <div
            className="grid gap-3 px-4 py-2 mb-2 text-[11px] font-semibold uppercase tracking-wide"
            style={{ gridTemplateColumns: '1fr 100px 120px 100px 40px', color: 'var(--text3)' }}
          >
            <span>Goal</span>
            <span>Outcome</span>
            <span>Confidence at close</span>
            <span>Date</span>
            <span />
          </div>
          <div className="flex flex-col gap-2">
            {goals.map(obj => (
              <ArchivedGoalRow key={obj.id} goal={obj} />
            ))}
          </div>
        </>
      )}
    </div>
  )
}
