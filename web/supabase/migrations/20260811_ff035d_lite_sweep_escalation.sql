-- FF-035D: add escalation timestamp + per-institution alert phone.
-- Note: sweep_type, alert_threshold, lite_sweep_cadence_days, last_lite_sweep_at
-- already exist from a prior sprint (see sweep-fork2.ts) — only adding what's missing.

ALTER TABLE enterprise_objectives
  ADD COLUMN IF NOT EXISTS escalated_at TIMESTAMPTZ;

ALTER TABLE enterprise_institutions
  ADD COLUMN IF NOT EXISTS alert_phone TEXT;

COMMENT ON COLUMN enterprise_objectives.escalated_at IS 'Set when an alert threshold auto-escalates this objective from monitoring_lite to focus. Cleared manually is not expected; a fresh escalation overwrites it.';
COMMENT ON COLUMN enterprise_institutions.alert_phone IS 'Per-institution SMS number for internal ops alerts on objective escalation. Falls back to ADMIN_ALERT_PHONE env var if unset.';
