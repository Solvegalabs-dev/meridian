import type { EnterpriseCase, VerticalConfig, RealEstateLoanData, ListingLoanData, BuyerLoanData, DriftTier } from '@/lib/vertical/verticalTypes';
import { ListingCaseCard } from './ListingCaseCard';
import { BuyerCaseCard } from './BuyerCaseCard';
import { AutoFinanceCaseCard } from './AutoFinanceCaseCard';

interface Props {
  case: EnterpriseCase;
  verticalConfig: VerticalConfig | null;
  driftTier: DriftTier;
}

export function VerticalCaseCard({ case: c, verticalConfig, driftTier }: Props) {
  if (verticalConfig?.vertical_type === 'real_estate') {
    const ld = c.loan_data as unknown as RealEstateLoanData | undefined;
    const caseType = ld?.case_type ?? 'listing';
    if (caseType === 'buyer') {
      return <BuyerCaseCard caseData={c} loanData={ld as BuyerLoanData} driftTier={driftTier} />;
    }
    return <ListingCaseCard caseData={c} loanData={ld as ListingLoanData} driftTier={driftTier} />;
  }
  return <AutoFinanceCaseCard caseData={c} driftTier={driftTier} />;
}
