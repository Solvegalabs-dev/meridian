-- agent_configs: one row per agent definition
CREATE TABLE agent_configs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_key text NOT NULL UNIQUE,
  vertical text NOT NULL,
  domain text NOT NULL,
  display_name text NOT NULL,
  description text,
  source_url_template text NOT NULL,
  threshold_type text NOT NULL,
  threshold_value numeric,
  threshold_keywords text[],
  cadence_minutes integer NOT NULL DEFAULT 1440,
  geo_scope text[],
  event_category text NOT NULL,
  event_source_prefix text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  requires_ai boolean NOT NULL DEFAULT false,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- agent_run_log: one row per execution
CREATE TABLE agent_run_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_key text NOT NULL REFERENCES agent_configs(agent_key),
  ran_at timestamptz DEFAULT now(),
  result text NOT NULL,
  event_id uuid,
  duration_ms integer,
  threshold_value_observed numeric,
  error_message text,
  geo_context jsonb
);

-- RLS
ALTER TABLE agent_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_run_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_agent_configs" ON agent_configs
  FOR ALL USING (true);

CREATE POLICY "service_role_agent_run_log" ON agent_run_log
  FOR ALL USING (true);

-- Indexes
CREATE INDEX idx_agent_run_log_agent_key ON agent_run_log(agent_key);
CREATE INDEX idx_agent_run_log_ran_at ON agent_run_log(ran_at DESC);
CREATE INDEX idx_agent_configs_vertical ON agent_configs(vertical);
CREATE INDEX idx_agent_configs_domain ON agent_configs(domain);
