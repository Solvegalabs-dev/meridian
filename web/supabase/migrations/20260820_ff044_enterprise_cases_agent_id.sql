-- FF-044: Fusion Multi-Seat Agent Layer + Vertical Template
-- Migration 3: Add agent_id FK to enterprise_cases
-- Filed August 20, 2026 · Solvega Labs LLC

ALTER TABLE enterprise_cases
  ADD COLUMN IF NOT EXISTS agent_id uuid REFERENCES broker_agents(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS enterprise_cases_agent_id_idx ON enterprise_cases(agent_id);

-- NULL is valid: cases without agent assignment visible to broker_owner and admin roles only.
-- ON DELETE SET NULL preserves cases if agent is removed.
