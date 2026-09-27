export type VerticalType = 'auto_finance' | 'real_estate' | 'healthcare_rcm' | 'staffing';

export interface CaseSchemaField {
  tier: 1 | 2;
  field_name: string;
  field_type: 'text' | 'currency' | 'integer' | 'date';
  display_label: string;
}

export interface VerticalConfig {
  id: string;
  institution_id: string;
  vertical_type: VerticalType;
  case_schema: CaseSchemaField[];
  objective_templates: Record<string, string[]>;
  signal_sources: unknown[];
  ui_theme: Record<string, unknown> | null;
  pricing_model: Record<string, unknown> | null;
  macro_event_categories: string[];
}

// loan_data field shapes for real estate
export interface ListingLoanData {
  case_type: 'listing';
  address: string;
  zip_code: string;
  list_price: number;
  price_band: string;
  neighborhood: string;
  days_on_market: number;
  target_close_date: string; // ISO date
  bm?: string;
}

export interface BuyerLoanData {
  case_type: 'buyer';
  case_name: string;
  target_area: string;
  rate_lock_expires: string; // ISO date
  target_close_date: string; // ISO date
  pre_approval_amount: number;
  bm?: string;
}

export type RealEstateLoanData = ListingLoanData | BuyerLoanData;

// Shared EnterpriseCase type used across vertical components
export interface EnterpriseCase {
  id: string;
  case_ref: string;
  institution_id: string;
  agent_id: string | null;
  in_scope: boolean;
  loan_data: Record<string, unknown> | null;
  // auto-finance fields (may be absent on RE cases)
  region?: string | null;
  fico_band?: string | null;
  vehicle_class?: string | null;
  loan_status?: string | null;
  ltv_ratio?: number | null;
  dti_ratio?: number | null;
  current_balance?: number | null;
  payments_remaining?: number | null;
}

export type DriftTier = 'CRITICAL' | 'ALERT' | 'CAUTION' | 'STABLE';
