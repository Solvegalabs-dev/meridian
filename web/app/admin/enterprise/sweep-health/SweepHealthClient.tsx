'use client'

import { useState, useTransition } from 'react'
import { fetchSweepHealth } from './actions'
import type { SweepHealthSummary } from '@/lib/enterprise/sweep-health'

function StatTile({ value, label, color }: { value: number; label: string; color: 'green' | 'red' | 'neutral' }) {
  const valueColor =
    color === 'green' ? 'text-[var(--green)]' :
    color === 'red'   ? 'text-[var(--red)]' :
    'text-[var(--text)]'

  return (
    <div className="px-6 py-5">
      <p className={`text-[28px] font-medium leading-none ${valueColor}`}>{value}</p>
      <p className="text-[11px] text-[var(--text3)] mt-1">{label}</p>
    </div>
  )
}

export default function SweepHealthClient({ initial }: { initial: SweepHealthSummary }) {
  const [data, setData] = useState(initial)
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  const refresh = () => {
    startTransition(async () => {
      const result = await fetchSweepHealth()
      if ('error' in result) {
        setError(result.error)
        return
      }
      setError(null)
      setData(result)
    })
  }

  return (
    <div className="space-y-6 max-w-4xl">
      <div className="flex items-center justify-between">
        <span className="text-[12px] text-[var(--text3)]">Refreshed {new Date(data.fetchedAt).toLocaleTimeString()}</span>
        <button
          onClick={refresh}
          disabled={isPending}
          className="px-4 py-1.5 rounded-lg text-[12px] font-semibold bg-white border border-[var(--border)] text-[var(--text2)] hover:border-[var(--text3)] transition-colors disabled:opacity-50"
        >
          {isPending ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      {error && (
        <div className="rounded-xl border border-[var(--red)] bg-[var(--red-lt)] px-5 py-3">
          <p className="text-[13px] text-[var(--red)]">{error}</p>
        </div>
      )}

      {/* Stat tiles */}
      <div className="bg-white rounded-xl border border-[var(--border)] overflow-hidden">
        <div className="grid grid-cols-3 divide-x divide-[var(--border)]">
          <StatTile value={data.totals.attempted} label="sweeps attempted" color="neutral" />
          <StatTile value={data.totals.succeeded} label="succeeded" color="green" />
          <StatTile value={data.totals.failed} label="failed" color={data.totals.failed > 0 ? 'red' : 'neutral'} />
        </div>
      </div>

      {/* By sweep type */}
      <div className="bg-white rounded-xl border border-[var(--border)] overflow-hidden">
        <div className="px-6 py-3 border-b border-[var(--border)]">
          <p className="text-[13px] font-medium text-[var(--text)]">By sweep type</p>
        </div>
        <table className="w-full text-[12px]">
          <thead>
            <tr className="bg-[var(--gray-lt)]">
              <th className="text-left px-6 py-2 text-[10px] font-semibold uppercase tracking-wider text-[var(--text3)]">Type</th>
              <th className="text-left px-4 py-2 text-[10px] font-semibold uppercase tracking-wider text-[var(--text3)]">Attempted</th>
              <th className="text-left px-4 py-2 text-[10px] font-semibold uppercase tracking-wider text-[var(--text3)]">Succeeded</th>
              <th className="text-left px-4 py-2 text-[10px] font-semibold uppercase tracking-wider text-[var(--text3)]">Failed</th>
            </tr>
          </thead>
          <tbody>
            {Object.entries(data.bySweepType).map(([type, s]) => (
              <tr key={type} className="border-t border-[var(--border)]">
                <td className="px-6 py-2 text-[var(--text)] font-mono">{type}</td>
                <td className="px-4 py-2 text-[var(--text2)]">{s.attempted}</td>
                <td className="px-4 py-2 text-[var(--green)]">{s.succeeded}</td>
                <td className={`px-4 py-2 ${s.failed > 0 ? 'text-[var(--red)] font-medium' : 'text-[var(--text3)]'}`}>{s.failed}</td>
              </tr>
            ))}
            {Object.keys(data.bySweepType).length === 0 && (
              <tr>
                <td colSpan={4} className="px-6 py-4 text-[var(--text3)]">No sweeps in the last {data.windowHours}h.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Recent allSettled rejections */}
      <div className="bg-white rounded-xl border border-[var(--border)] overflow-hidden">
        <div className="px-6 py-3 border-b border-[var(--border)]">
          <p className="text-[13px] font-medium text-[var(--text)]">Recent allSettled rejections</p>
        </div>
        {data.failures.length === 0 ? (
          <p className="px-6 py-4 text-[12px] text-[var(--text3)]">No sweep failures in the last {data.windowHours}h.</p>
        ) : (
          <div className="divide-y divide-[var(--border)]">
            {data.failures.map(f => (
              <div key={f.id} className="px-6 py-3">
                <div className="flex items-center justify-between text-[11px] text-[var(--text3)] mb-1">
                  <span>{f.institution_name} · {f.sweep_type}{f.fork ? ` · ${f.fork}` : ''}{f.objective_id ? ` · objective ${f.objective_id}` : ''}</span>
                  <span>{new Date(f.created_at).toLocaleString()}</span>
                </div>
                <p className="text-[13px] text-[var(--red)] break-words">{f.error_message ?? 'No error message recorded'}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
