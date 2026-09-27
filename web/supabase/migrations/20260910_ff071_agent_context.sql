-- agent_objective_context: binds agents to specific objectives at runtime
-- One row per agent+objective pairing. Updated each sweep cycle.
CREATE TABLE agent_objective_context (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_key text NOT NULL REFERENCES agent_configs(agent_key),
  objective_id uuid NOT NULL,
  user_id uuid NOT NULL,
  resolved_geo jsonb NOT NULL DEFAULT '{}',
    -- {state, county, place_id, adjacent_units, watershed}
  resolved_params jsonb NOT NULL DEFAULT '{}',
    -- filled template slots: {state: 'UT', county: 'Duchesne', date_today: '2026-09-10'}
  expansion_applied boolean NOT NULL DEFAULT false,
  context_source text NOT NULL DEFAULT 'objective',
    -- 'objective' | 'domain_profile' | 'institution' | 'combined'
  last_resolved_at timestamptz DEFAULT now(),
  created_at timestamptz DEFAULT now(),
  UNIQUE(agent_key, objective_id)
);

ALTER TABLE agent_objective_context ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users_own_agent_context" ON agent_objective_context
  FOR ALL USING (auth.uid() = user_id);

CREATE INDEX idx_agent_ctx_objective ON agent_objective_context(objective_id);
CREATE INDEX idx_agent_ctx_agent_key ON agent_objective_context(agent_key);
CREATE INDEX idx_agent_ctx_user ON agent_objective_context(user_id);
