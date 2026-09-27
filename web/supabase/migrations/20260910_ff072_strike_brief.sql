-- strike_briefs: one row per generated brief per objective per time window
CREATE TABLE strike_briefs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  objective_id uuid NOT NULL,
  user_id uuid NOT NULL,
  brief_date date NOT NULL,
  time_window text NOT NULL CHECK (time_window IN ('0600', '1100', '1700')),
  domain text NOT NULL,
  synthesis text NOT NULL,
  lead_signal text,
  go_no_go text CHECK (go_no_go IN ('GO', 'NO_GO', 'CONDITIONAL', 'MONITOR')),
  condition_delta text,
  pattern_match_year integer,
  confidence_tier text CHECK (confidence_tier IN ('T1', 'T2', 'T3', 'T4')),
  agent_hits jsonb DEFAULT '[]',
  created_at timestamptz DEFAULT now(),
  UNIQUE(objective_id, brief_date, time_window)
);

ALTER TABLE strike_briefs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users_own_strike_briefs" ON strike_briefs
  FOR ALL USING (auth.uid() = user_id);

CREATE INDEX idx_strike_briefs_objective ON strike_briefs(objective_id);
CREATE INDEX idx_strike_briefs_user_date ON strike_briefs(user_id, brief_date DESC);
CREATE INDEX idx_strike_briefs_domain ON strike_briefs(domain);
