import Link from 'next/link';
import type { EnterpriseCase, DriftTier } from '@/lib/vertical/verticalTypes';

interface Props {
  caseData: EnterpriseCase;
  driftTier: DriftTier;
}

const tierBorder: Record<DriftTier, string> = {
  CRITICAL: 'border-red-600',
  ALERT: 'border-amber-500',
  CAUTION: 'border-yellow-400',
  STABLE: 'border-green-500',
};

const tierBadge: Record<DriftTier, string> = {
  CRITICAL: 'bg-red-600 text-white',
  ALERT: 'bg-amber-500 text-white',
  CAUTION: 'bg-yellow-400 text-gray-900',
  STABLE: 'bg-green-500 text-white',
};

export function AutoFinanceCaseCard({ caseData, driftTier }: Props) {
  return (
    <Link
      href={`/enterprise/cases/${caseData.id}`}
      className={`block border-l-4 ${tierBorder[driftTier]} bg-white rounded-lg shadow-sm hover:shadow-md transition-shadow px-4 py-3`}
    >
      <div className="flex items-center justify-between mb-2">
        <span className="font-semibold text-gray-900 text-sm">{caseData.case_ref}</span>
        <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-bold ${tierBadge[driftTier]}`}>
          {driftTier}
        </span>
      </div>
      <div className="text-xs text-gray-500 mb-2">{caseData.region ?? '—'}</div>
      <div className="grid grid-cols-3 gap-2 text-xs">
        <div>
          <span className="text-gray-400 block">FICO Band</span>
          <span className="font-medium text-gray-700">{caseData.fico_band ?? '—'}</span>
        </div>
        <div>
          <span className="text-gray-400 block">LTV</span>
          <span className="font-medium text-gray-700">
            {caseData.ltv_ratio != null ? `${Math.round(caseData.ltv_ratio)}%` : '—'}
          </span>
        </div>
        <div>
          <span className="text-gray-400 block">Status</span>
          <span className="font-medium text-gray-700">{caseData.loan_status ?? '—'}</span>
        </div>
      </div>
    </Link>
  );
}
