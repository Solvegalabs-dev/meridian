#!/usr/bin/env npx tsx
/**
 * Item 4 of the FUSION ENTERPRISE SPRINT — token/cost estimation harness.
 * Test harness only, not a production feature. No real data — hardcoded
 * representative case rows matching the CSV spec.
 *
 * Run: npx tsx scripts/enterprise/token-budget-test.ts
 * Requires ANTHROPIC_API_KEY in the environment (or .env.local).
 */
import * as fs from 'fs'
import * as path from 'path'

const envPath = path.join(__dirname, '../../.env.local')
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf-8').split('\n')) {
    const m = line.match(/^([^#=]+)=(.*)$/)
    if (m) process.env[m[1].trim()] = m[2].trim()
  }
}

import { getAnthropicClient } from '../../lib/anthropic/client'
import { OBJECTIVE_SWEEP_PROMPT } from '../../lib/enterprise/sweep-prompts'
import type { CohortPattern, TierChangeProjection } from '../../lib/enterprise/sweep-prompts'
import type { MacroEventSummary } from '../../lib/enterprise/types'

// ── Pricing (per Claude API skill, cached 2026-06-24) ──────────────────────
// $/1M tokens. Sonnet 4.6 is the model used by the real full-sweep code path
// (sweep-fork2.ts); Haiku 4.5 is tested here for comparison even though the
// current "lite" sweep reuses the same Sonnet code path (see FF-035D scope
// note in PR #135) — this projects what a future Haiku-based lite sweep
// would cost.
const PRICING = {
  'claude-sonnet-4-6': { input: 3.0, output: 15.0 },
  'claude-haiku-4-5-20251001': { input: 1.0, output: 5.0 },
} as const

type ModelId = keyof typeof PRICING

function estimateCostUsd(model: ModelId, inputTokens: number, outputTokens: number): number {
  const rate = PRICING[model]
  return (inputTokens / 1_000_000) * rate.input + (outputTokens / 1_000_000) * rate.output
}

// ── Synthetic case data (CSV spec shape, hardcoded representative values) ──

type SyntheticCase = {
  case_ref: string
  region: string
  fico_band: string
  employment_type: string
  origination_date: string
  current_balance: number
  loan_term_months: number
  loan_status: string
  days_past_due: number
}

const BASE_CASES: SyntheticCase[] = [
  { case_ref: 'C-1001', region: 'Midwest', fico_band: '620-659', employment_type: 'w2', origination_date: '2024-03-14', current_balance: 18450, loan_term_months: 60, loan_status: '30dpd', days_past_due: 34 },
  { case_ref: 'C-1002', region: 'Southeast', fico_band: '660-679', employment_type: 'self_employed', origination_date: '2023-11-02', current_balance: 22100, loan_term_months: 72, loan_status: 'current', days_past_due: 0 },
  { case_ref: 'C-1003', region: 'Great Lakes', fico_band: '620-659', employment_type: 'w2', origination_date: '2024-01-20', current_balance: 15300, loan_term_months: 48, loan_status: '60dpd', days_past_due: 61 },
  { case_ref: 'C-1004', region: 'Midwest', fico_band: '700-719', employment_type: 'w2', origination_date: '2023-08-09', current_balance: 27800, loan_term_months: 60, loan_status: 'current', days_past_due: 0 },
  { case_ref: 'C-1005', region: 'Southeast', fico_band: '620-659', employment_type: 'gig', origination_date: '2024-05-30', current_balance: 12900, loan_term_months: 36, loan_status: 'default', days_past_due: 95 },
]

function buildCaseNarrative(c: SyntheticCase): string {
  return [
    `CASE: ${c.case_ref} | FICO: ${c.fico_band} | EMPLOYMENT: ${c.employment_type}`,
    `ORIGINATION: ${c.origination_date} | BALANCE: $${c.current_balance.toLocaleString('en-US')} | TERM: ${c.loan_term_months}mo`,
    '',
    'MACRO CONTEXT AT ORIGINATION (±90 days):',
    '- [3/NEG] Regional auto lending tightening (2024-02-01)',
    '',
    'STATUS HISTORY:',
    `- ${c.origination_date}: current (origination)`,
    `- 2026-06-01: ${c.loan_status}${c.days_past_due > 0 ? ` [${c.days_past_due} days past due]` : ''}`,
  ].join('\n')
}

function buildPopulation(size: number): SyntheticCase[] {
  const population: SyntheticCase[] = []
  for (let i = 0; i < size; i++) {
    population.push({ ...BASE_CASES[i % BASE_CASES.length], case_ref: `C-${2000 + i}` })
  }
  return population
}

const SYNTHETIC_MACRO_EVENTS: MacroEventSummary[] = [
  { id: 'm1', event_date: '2026-06-01', event_category: 'rates', event_name: 'Fed holds rates steady', magnitude: 2, direction: 'neutral', metric_name: 'fed_funds_rate', metric_value: 5.25, metric_unit: '%' },
  { id: 'm2', event_date: '2026-05-15', event_category: 'labor', event_name: 'Regional unemployment ticks up', magnitude: 3, direction: 'negative', metric_name: 'unemployment_rate', metric_value: 4.8, metric_unit: '%' },
]

const SYNTHETIC_COHORTS: CohortPattern[] = [
  { region: 'Midwest', fico_band: '620-659', case_count: 12, delinquent_count: 4, delinquency_rate: 0.33, avg_ltv: 92.4, case_refs: ['C-1001', 'C-1003'], macro_events_at_origination: ['Regional auto lending tightening'] },
]

const SYNTHETIC_PROJECTIONS: TierChangeProjection[] = [
  { case_id: 'C-1003', case_ref: 'C-1003', current_tier: 'caution', projected_tier: 'alert', confidence: 0.7, horizon_days: 30, key_signals: ['rising dpd', 'regional macro headwind'] },
]

function buildPrompt(caseCount: number): string {
  const population = buildPopulation(caseCount)
  const narratives = population.map(buildCaseNarrative)
  return OBJECTIVE_SWEEP_PROMPT({
    objectiveStatement: 'Which cohorts show early signs of delinquency drift, and what should the credit team do about it?',
    objId: 'E-01',
    caseNarratives: narratives,
    highRiskCohorts: SYNTHETIC_COHORTS,
    macroEvents: SYNTHETIC_MACRO_EVENTS,
    projectedChanges: SYNTHETIC_PROJECTIONS,
  })
}

type RunResult = {
  label: string
  model: ModelId
  caseCount: number
  inputTokens: number
  outputTokens: number
  totalTokens: number
  costUsd: number
}

async function runOnce(label: string, model: ModelId, caseCount: number): Promise<RunResult> {
  const client = getAnthropicClient()
  const prompt = buildPrompt(caseCount)

  const response = await client.messages.create({
    model,
    max_tokens: 1500,
    messages: [{ role: 'user', content: prompt }],
  })

  const inputTokens = response.usage.input_tokens
  const outputTokens = response.usage.output_tokens

  return {
    label,
    model,
    caseCount,
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
    costUsd: estimateCostUsd(model, inputTokens, outputTokens),
  }
}

function printTable(results: RunResult[]) {
  const header = ['Label', 'Model', 'Cases', 'Input tok', 'Output tok', 'Total tok', 'Est. cost']
  const rows = results.map(r => [
    r.label,
    r.model,
    String(r.caseCount),
    r.inputTokens.toLocaleString('en-US'),
    r.outputTokens.toLocaleString('en-US'),
    r.totalTokens.toLocaleString('en-US'),
    `$${r.costUsd.toFixed(4)}`,
  ])
  const widths = header.map((h, i) => Math.max(h.length, ...rows.map(r => r[i].length)))
  const line = (cells: string[]) => cells.map((c, i) => c.padEnd(widths[i])).join('  ')
  console.log(line(header))
  console.log(widths.map(w => '-'.repeat(w)).join('  '))
  for (const row of rows) console.log(line(row))
}

async function main() {
  console.log('═══════════════════════════════════════════════════════════')
  console.log('Item 4 — Enterprise Sweep Token Budget Test')
  console.log('═══════════════════════════════════════════════════════════\n')

  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('ANTHROPIC_API_KEY is not set — cannot run live requests. Aborting.')
    process.exit(1)
  }

  const results: RunResult[] = []

  console.log('▶ 5-case sweep (spec baseline), full-sweep model (Sonnet 4.6)...')
  results.push(await runOnce('5-case baseline', 'claude-sonnet-4-6', 5))

  console.log('▶ 5-case sweep, lite-model comparison (Haiku 4.5)...')
  results.push(await runOnce('5-case baseline (Haiku)', 'claude-haiku-4-5-20251001', 5))

  console.log('▶ 50-case sweep, Sonnet 4.6...')
  results.push(await runOnce('50-case', 'claude-sonnet-4-6', 50))

  console.log('▶ 300-case sweep (full batch), Sonnet 4.6...')
  results.push(await runOnce('300-case (full batch)', 'claude-sonnet-4-6', 300))

  console.log('\nResults:\n')
  printTable(results)

  const fullBatch = results.find(r => r.label === '300-case (full batch)')!
  console.log(`\n300-case projected cost per objective sweep: $${fullBatch.costUsd.toFixed(4)}`)
  console.log(`300-case input tokens: ${fullBatch.inputTokens.toLocaleString('en-US')}`)

  if (fullBatch.inputTokens > 8000) {
    console.log(
      '\n⚠ 300-case input exceeds 8,000 tokens — recommend chunking the case-narrative ' +
      'context window (e.g. batch narratives and summarize per-batch, or cap cases-per-sweep ' +
      'and paginate) before this runs at full-portfolio scale. Add a TODO comment in ' +
      'lib/enterprise/sweep-fork2.ts flagging this for the next session.'
    )
  }
}

main().catch(err => {
  console.error('Token budget test failed:', err)
  process.exit(1)
})
