-- FF-044: Fusion Multi-Seat Agent Layer + Vertical Template
-- Migration 1: broker_agents table
-- Filed August 20, 2026 · Solvega Labs LLC

CREATE TABLE IF NOT EXISTS broker_agents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id uuid NOT NULL REFERENCES enterprise_institutions(id) ON DELETE CASCADE,
  full_name text NOT NULL,
  license_number text,
  role text NOT NULL DEFAULT 'agent' CHECK (role IN ('agent','broker_owner','admin')),
  email text,
  active_listing_count integer NOT NULL DEFAULT 0,
  active_buyer_count integer NOT NULL DEFAULT 0,
  invited_at timestamptz NOT NULL DEFAULT now(),
  accepted_at timestamptz,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE broker_agents ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE broker_agents IS 'FF-044: Agent seat layer for Fusion multi-seat vertical deployments. First deployment: BrokerOne Utah real estate. Filed August 20, 2026.';

-- RLS Policies
CREATE POLICY broker_agents_institution_read ON broker_agents
  FOR SELECT USING (
    institution_id IN (
      SELECT institution_id FROM enterprise_members
      WHERE user_id = auth.uid() AND role IN ('broker_owner','admin')
    )
  );

CREATE POLICY broker_agents_self_read ON broker_agents
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM enterprise_cases ec
      WHERE ec.agent_id = broker_agents.id
      AND EXISTS (
        SELECT 1 FROM enterprise_members em
        WHERE em.user_id = auth.uid()
        AND em.institution_id = broker_agents.institution_id
      )
    )
  );
