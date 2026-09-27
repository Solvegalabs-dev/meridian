'use client';

import Link from 'next/link';
import type { EnterpriseCase, BuyerLoanData, DriftTier } from '@/lib/vertical/verticalTypes';
import { RateLockCountdown } from './RateLockCountdown';
import { BenchmarkBadge } from './BenchmarkBadge';

interface Props {
  caseData: EnterpriseCase;
  loanData: BuyerLoanData;
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

export function BuyerCaseCard({ caseData, loanData, driftTier }: Props) {
  const closeSoon = isCloseDateSoon(loanData.target_close_date);

  return (
    <div className={`border-l-4 ${tierBorder[driftTier]} bg-white rounded-lg shadow-sm hover:shadow-md transition-shadow overflow-hidden`}>
      <Link href={`/enterprise/cases/${caseData.id}`} className="block px-4 py-3">
        {/* Header */}
        <div className="flex items-start justify-between gap-2 mb-1">
          <p className="font-semibold text-gray-900 text-sm truncate flex-1">{loanData.case_name}</p>
          <div className="flex items-center gap-1.5 flex-shrink-0">
            <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-bold text-white ${tierBadge[driftTier]}`}>
              {driftTier}
            </span>
            {loanData.bm && <BenchmarkBadge bm={loanData.bm} />}
          </div>
        </div>

        {/* Target area */}
        <p className="text-xs text-gray-500 mb-2">{loanData.target_area}</p>

        {/* Pre-approval amount */}
        <div className="text-lg font-bold text-gray-900 mb-2">
          {loanData.pre_approval_amount != null ? `$${loanData.pre_approval_amount.toLocaleString()}` : '—'}
          <span className="text-xs text-gray-400 font-normal ml-1">pre-approved</span>
        </div>

        {/* Rate lock countdown */}
        <div className="mb-2">
          <RateLockCountdown rateLockExpires={loanData.rate_lock_expires} />
        </div>

        {/* Close date */}
        <div className="text-xs">
          <span className="text-gray-500">Target close: </span>
          <span className={closeSoon ? 'text-amber-600 font-semibold' : 'text-gray-700'}>
            {fmtDate(loanData.target_close_date)}
          </span>
        </div>
      </Link>
    </div>
  );
}
