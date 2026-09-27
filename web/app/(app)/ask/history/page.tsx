import Link from 'next/link'
import { ChevronLeft } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import HistoryClient from './HistoryClient'

export default async function AskHistoryPage() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const { data: rows } = await supabase
    .from('ask_queries')
    .select('id, question, response, web_search_used, credits_used, created_at')
    .eq('user_id', user!.id)
    .not('response', 'is', null)
    .order('created_at', { ascending: false })
    .limit(100)

  return (
    <div className="-m-6 p-6 min-h-[calc(100vh-3.5rem)]" style={{ backgroundColor: 'var(--navy)' }}>
      <div className="flex items-center gap-3 mb-6 max-w-2xl mx-auto">
        <Link href="/ask" aria-label="Back to Ask Meridian" style={{ color: 'var(--ov-text-mid)' }}>
          <ChevronLeft size={20} />
        </Link>
        <p style={{ fontFamily: "'EB Garamond', Georgia, serif", fontStyle: 'italic', fontSize: 16, color: '#fff' }}>
          Ask Meridian · History
        </p>
      </div>

      <HistoryClient rows={rows ?? []} />
    </div>
  )
}
