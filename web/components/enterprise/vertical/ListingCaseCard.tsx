'use client';

import { useState } from 'react';
import Link from 'next/link';
import type { EnterpriseCase, ListingLoanData, DriftTier } from '@/lib/vertical/verticalTypes';
import { DOMProgressBar } from './DOMProgressBar';
import { BenchmarkBadge } from './BenchmarkBadge';

interface Props {
  caseData: EnterpriseCase;
  loanData: ListingLoanData;
  driftTier: DriftTier;
}

const tierBorder: Record<DriftTier, string> = {
  CRITICAL: 'border-red-600',
  ALERT: 'border-amber-500',
  CAUTION: 'border-yellow-400',
  STABLE: 'border-green-500',
};

const tierBadge: Record<DriftTier, string> = {
  CRITICAL: 'bg-red-600',
  ALERT: 'bg-amber-500',
  CAUTION: 'bg-yellow-400',
  STABLE: 'bg-green-500',
};

function isCloseDateSoon(dateStr: string): boolean {
  const close = new Date(dateStr);
  const today = new Date();
  const days = Math.ceil((close.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
  return days >= 0 && days < 14;
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export function ListingCaseCard({ caseData, loanData, driftTier }: Props) {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const closeSoon = isCloseDateSoon(loanData.target_close_date);

  return (
    <div className={`border-l-4 ${tierBorder[driftTier]} bg-white rounded-lg shadow-sm hover:shadow-md transition-shadow overflow-hidden`}>
      <Link href={`/enterprise/cases/${caseData.id}`} className="block px-4 pt-3 pb-2">
        {/* Header */}
        <div className="flex items-start justify-between gap-2 mb-1">
          <p className="font-semibold text-gray-900 text-sm truncate flex-1">{loanData.address}</p>
          <div className="flex items-center gap-1.5 flex-shrink-0">
            <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-bold text-white ${tierBadge[driftTier]}`}>
              {driftTier}
            </span>
            {loanData.bm && <BenchmarkBadge bm={loanData.bm} />}
          </div>
        </div>

        {/* Price row */}
        <div className="flex items-center gap-2 mb-2">
          <span className="text-lg font-bold text-gray-900">
            {loanData.list_price != null ? `$${loanData.list_price.toLocaleString()}` : '—'}
          </span>
          <span className="text-xs text-gray-500 bg-gray-100 rounded px-1.5 py-0.5">
            {loanData.price_band}
          </span>
        </div>

        {/* DOM bar */}
        <div className="mb-2">
          <DOMProgressBar daysOnMarket={loanData.days_on_market} />
        </div>

        {/* Close date */}
        <div className="text-xs">
          <span className="text-gray-500">Target close: </span>
          <span className={closeSoon ? 'text-amber-600 font-semibold' : 'text-gray-700'}>
            {fmtDate(loanData.target_close_date)}
          </span>
        </div>
      </Link>

      {/* Tier-2 details toggle */}
      <div className="border-t border-gray-100">
        <button
          onClick={() => setDetailsOpen(o => !o)}
          className="w-full text-left px-4 py-1.5 text-xs text-gray-400 hover:text-gray-600 hover:bg-gray-50 transition-colors"
        >
          {detailsOpen ? 'Hide details ▲' : 'Details ▼'}
        </button>
        {detailsOpen && (
          <div className="px-4 pb-3 grid grid-cols-3 gap-2 text-xs text-gray-600">
            <div><span className="text-gray-400 block">Neighborhood</span>{loanData.neighborhood || '—'}</div>
            <div><span className="text-gray-400 block">ZIP</span>{loanData.zip_code || '—'}</div>
            <div><span className="text-gray-400 block">Price Band</span>{loanData.price_band || '—'}</div>
          </div>
        )}
      </div>
    </div>
  );
}
