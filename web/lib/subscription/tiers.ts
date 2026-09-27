export const TIERS = {
  trial: {
    label: 'Trial',
    price_monthly: 0,
    price_annual: 0,
    max_objectives: 3,
    sweep_cadence: 'once', // 1 total sweep credit at signup
    max_predictions: 5,
    history_days: 30,
    features: ['Dashboard', 'Manual signals', '1 free sweep'],
  },
  explorer: {
    label: 'Explorer',
    price_monthly: 19,
    price_annual: 190,
    max_objectives: 4, // active-only count
    sweep_cadence: 'weekly',
    max_predictions: 10,
    history_days: 90,
    features: ['All Trial features', 'Weekly sweep', 'Journal', 'Email alerts'],
  },
  accelerator: {
    label: 'Accelerator',
    price_monthly: 49,
    price_annual: 490,
    max_objectives: 8, // active-only count
    sweep_cadence: 'five_weekly',
    max_predictions: null, // unlimited
    history_days: 365,
    features: ['All Explorer features', 'Five weekly sweeps', 'Cross-dependency detection', 'Push + SMS'],
  },
  command: {
    label: 'Command',
    price_monthly: 99,
    price_annual: 990,
    max_objectives: null, // unlimited
    sweep_cadence: 'two_daily',
    max_predictions: null,
    history_days: null, // unlimited
    features: ['All Accelerator features', 'Two daily sweeps', 'API access', 'Custom sources', 'White-glove onboarding'],
  },
} as const

export type TierKey = keyof typeof TIERS

export const SWEEP_CREDIT_BUNDLES = [
  { credits: 5, price: 4, per_credit: 0.80 },
  { credits: 15, price: 10, per_credit: 0.67, best_value: true },
  { credits: 50, price: 25, per_credit: 0.50 },
]

export const ASK_CREDIT_BUNDLES = [
  { credits: 5, price: 4, per_credit: 0.80 },
  { credits: 15, price: 10, per_credit: 0.67, best_value: true },
  { credits: 50, price: 25, per_credit: 0.50 },
]

export function isAlphaBetaAccount(account_type: string): boolean {
  return ['alpha_personal', 'alpha_business', 'beta'].includes(account_type)
}

export function getMaxObjectives(tier: TierKey, account_type: string): number | null {
  if (isAlphaBetaAccount(account_type)) return TIERS.explorer.max_objectives
  return TIERS[tier]?.max_objectives ?? null
}
