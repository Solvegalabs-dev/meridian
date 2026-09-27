-- SEC-01: market_signals — Classification C (authenticated market data)
-- Drop the anon_read_signals policy from the parent table.
-- Critical finding: parent had anon_read_signals (qual: true) allowing unauthenticated reads.
-- Partitions already had auth_read_signals only — no change needed on partitions.
-- auth_read_signals on parent is retained (authenticated users may read market data).
-- Writes are service-role-only (sweep engine); service role bypasses RLS.

DROP POLICY IF EXISTS "anon_read_signals" ON public.market_signals;

COMMENT ON TABLE public.market_signals IS 'Classification C: aggregate market/macro signal data. Authenticated read, service-role write only. No PII. No anon access. SEC-01 2026-08-15.';
