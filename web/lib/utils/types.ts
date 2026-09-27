export interface Profile {
  id: string
  full_name: string | null
  avatar_url: string | null
  tier: 'trial' | 'explorer' | 'accelerator' | 'command'
  tone_pref: 'direct' | 'balanced' | 'encouraging'
  depth_pref: 'brief' | 'standard' | 'detailed'
  trial_ends_at: string | null
  stripe_customer_id: string | null
  onboarded_at: string | null
  sweep_count: number
  created_at: string
  updated_at: string
}

export interface Objective {
  id: string
  user_id: string
  obj_id: string
  title: string
  category: 'career' | 'financial' | 'personal' | 'life'
  outcome: string
  success_condition: string | null
  target_date: string | null
  status: 'active' | 'paused' | 'closed' | 'achieved' | 'abandoned' | 'archived'
  closure_type: 'closed' | 'abandoned' | null
  confidence: number
  confidence_prev: number | null
  sweep_frequency: 'weekly' | 'daily' | 'manual'
  signal_keywords: string[] | null
  notes: string | null
  sort_order: number
  goal_description: string | null
  goal_context: string | null
  // Initial Sweep Pipeline fields (migration: 2026-07-06)
  objective_type: string | null
  deadline_type: 'hard' | 'soft'
  reservation_price: number | null
  context: Record<string, unknown>
  created_at: string
  updated_at: string
}

export interface Signal {
  id: string
  user_id: string
  objective_ids: string[] | null
  sweep_id: string | null
  title: string
  body: string | null
  source: string | null
  source_type: 'news' | 'manual' | 'reddit' | 'linkedin' | null
  relevance: 'high' | 'medium' | 'low'
  signal_type: 'opportunity' | 'risk' | 'neutral' | 'cross_dep' | null
  is_cross_dep: boolean
  is_read: boolean
  created_at: string
}

export interface Sweep {
  id: string
  user_id: string
  status: 'pending' | 'running' | 'complete' | 'failed'
  trigger_type: 'manual' | 'scheduled' | 'webhook'
  objectives_swept: string[] | null
  signal_count: number | null
  summary: string | null
  raw_response: unknown
  tokens_used: number | null
  cost_usd: number | null
  started_at: string | null
  completed_at: string | null
  created_at: string
}

export interface ConfidenceScore {
  id: string
  objective_id: string
  user_id: string
  sweep_id: string | null
  score: number
  factors: {
    signal_quality?: number
    timeline?: number
    blockers?: number
    momentum?: number
  } | null
  signal_gap: string | null
  recommended_actions: string[] | null
  created_at: string
}

export interface Prediction {
  id: string
  user_id: string
  objective_id: string | null
  pred_id: string | null
  statement: string
  confidence_pct: number
  horizon_date: string
  outcome: string | null
  accuracy_score: number | null
  scored_at: string | null
  notes: string | null
  created_at: string
}

export interface JournalEntry {
  id: string
  user_id: string
  entry_number: number
  week_of: string | null
  section_a: string | null
  section_b: string | null
  section_c: { obj: string; action: string; status: string }[] | null
  section_d: { concerns: string; questions: string; key_insight: string } | null
  section_e: string | null
  section_f: string | null
  section_g: string | null
  section_h_rating: number | null
  section_h_notes: string | null
  completed_actions: { action: string; completed: boolean }[] | null
  confidence_updates: Record<string, { prev: number; new: number; reason: string }> | null
  is_complete: boolean
  created_at: string
  updated_at: string
}

export interface RulesFilter {
  id: string
  user_id: string
  objective_id: string
  keywords_high: string[] | null
  keywords_med: string[] | null
  keywords_low: string[] | null
  keywords_block: string[] | null
  source_tiers: {
    tier1: string[]
    tier2: string[]
    tier3: string[]
  } | null
  updated_at: string
}

// FF-001 Calendar Intelligence types
export interface CalendarConnection {
  id: string
  user_id: string
  provider: 'ical' | 'google'
  label: string | null
  is_active: boolean
  sync_status: 'pending' | 'ok' | 'error'
  last_synced_at: string | null
  last_error: string | null
  event_count: number
  created_at: string
  updated_at: string
}

export interface CalendarEventRow {
  id: string
  user_id: string
  connection_id: string
  uid: string | null
  summary: string | null
  description: string | null
  location: string | null
  starts_at: string
  ends_at: string | null
  all_day: boolean
  objective_ids: string[]
  created_at: string
  updated_at: string
}

// Sweep API response types
export interface SweepObjectiveResult {
  id: string
  obj_id: string
  title: string
  confidence_prev: number
  confidence_new: number
  delta: number
  actions: string[]
  cross_deps: string[]
  signal_gap: string
}

export interface SweepResult {
  sweep_id: string
  status: 'complete'
  signal_count: number
  objectives: SweepObjectiveResult[]
  summary: string
}
