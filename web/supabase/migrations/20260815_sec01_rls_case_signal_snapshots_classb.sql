-- SEC-01: case_signal_snapshots — Classification B (institution-scoped)
-- Tighten read policy from TO PUBLIC to TO authenticated on parent + all 18 partitions.
-- Anonymous users already receive zero rows (auth.uid()=NULL matches nothing in enterprise_members),
-- but the policy must not fire for the anon role at all.
-- Write side unchanged: service_role_all correctly restricts writes to the sweep engine.

-- Parent
DROP POLICY IF EXISTS "enterprise_members_read_snapshots" ON public.case_signal_snapshots;
CREATE POLICY "enterprise_members_read_snapshots" ON public.case_signal_snapshots
  FOR SELECT TO authenticated
  USING (institution_id IN (
    SELECT enterprise_members.institution_id FROM enterprise_members
    WHERE enterprise_members.user_id = auth.uid()
  ));

-- 2025_07
DROP POLICY IF EXISTS "enterprise_members_read" ON public.case_signal_snapshots_2025_07;
CREATE POLICY "enterprise_members_read" ON public.case_signal_snapshots_2025_07
  FOR SELECT TO authenticated
  USING (institution_id IN (
    SELECT enterprise_members.institution_id FROM enterprise_members
    WHERE enterprise_members.user_id = auth.uid()
  ));

-- 2025_08
DROP POLICY IF EXISTS "enterprise_members_read" ON public.case_signal_snapshots_2025_08;
CREATE POLICY "enterprise_members_read" ON public.case_signal_snapshots_2025_08
  FOR SELECT TO authenticated
  USING (institution_id IN (
    SELECT enterprise_members.institution_id FROM enterprise_members
    WHERE enterprise_members.user_id = auth.uid()
  ));

-- 2025_09
DROP POLICY IF EXISTS "enterprise_members_read" ON public.case_signal_snapshots_2025_09;
CREATE POLICY "enterprise_members_read" ON public.case_signal_snapshots_2025_09
  FOR SELECT TO authenticated
  USING (institution_id IN (
    SELECT enterprise_members.institution_id FROM enterprise_members
    WHERE enterprise_members.user_id = auth.uid()
  ));

-- 2025_10
DROP POLICY IF EXISTS "enterprise_members_read" ON public.case_signal_snapshots_2025_10;
CREATE POLICY "enterprise_members_read" ON public.case_signal_snapshots_2025_10
  FOR SELECT TO authenticated
  USING (institution_id IN (
    SELECT enterprise_members.institution_id FROM enterprise_members
    WHERE enterprise_members.user_id = auth.uid()
  ));

-- 2025_11
DROP POLICY IF EXISTS "enterprise_members_read" ON public.case_signal_snapshots_2025_11;
CREATE POLICY "enterprise_members_read" ON public.case_signal_snapshots_2025_11
  FOR SELECT TO authenticated
  USING (institution_id IN (
    SELECT enterprise_members.institution_id FROM enterprise_members
    WHERE enterprise_members.user_id = auth.uid()
  ));

-- 2025_12
DROP POLICY IF EXISTS "enterprise_members_read" ON public.case_signal_snapshots_2025_12;
CREATE POLICY "enterprise_members_read" ON public.case_signal_snapshots_2025_12
  FOR SELECT TO authenticated
  USING (institution_id IN (
    SELECT enterprise_members.institution_id FROM enterprise_members
    WHERE enterprise_members.user_id = auth.uid()
  ));

-- 2026_01
DROP POLICY IF EXISTS "enterprise_members_read" ON public.case_signal_snapshots_2026_01;
CREATE POLICY "enterprise_members_read" ON public.case_signal_snapshots_2026_01
  FOR SELECT TO authenticated
  USING (institution_id IN (
    SELECT enterprise_members.institution_id FROM enterprise_members
    WHERE enterprise_members.user_id = auth.uid()
  ));

-- 2026_02
DROP POLICY IF EXISTS "enterprise_members_read" ON public.case_signal_snapshots_2026_02;
CREATE POLICY "enterprise_members_read" ON public.case_signal_snapshots_2026_02
  FOR SELECT TO authenticated
  USING (institution_id IN (
    SELECT enterprise_members.institution_id FROM enterprise_members
    WHERE enterprise_members.user_id = auth.uid()
  ));

-- 2026_03
DROP POLICY IF EXISTS "enterprise_members_read" ON public.case_signal_snapshots_2026_03;
CREATE POLICY "enterprise_members_read" ON public.case_signal_snapshots_2026_03
  FOR SELECT TO authenticated
  USING (institution_id IN (
    SELECT enterprise_members.institution_id FROM enterprise_members
    WHERE enterprise_members.user_id = auth.uid()
  ));

-- 2026_04
DROP POLICY IF EXISTS "enterprise_members_read" ON public.case_signal_snapshots_2026_04;
CREATE POLICY "enterprise_members_read" ON public.case_signal_snapshots_2026_04
  FOR SELECT TO authenticated
  USING (institution_id IN (
    SELECT enterprise_members.institution_id FROM enterprise_members
    WHERE enterprise_members.user_id = auth.uid()
  ));

-- 2026_05
DROP POLICY IF EXISTS "enterprise_members_read" ON public.case_signal_snapshots_2026_05;
CREATE POLICY "enterprise_members_read" ON public.case_signal_snapshots_2026_05
  FOR SELECT TO authenticated
  USING (institution_id IN (
    SELECT enterprise_members.institution_id FROM enterprise_members
    WHERE enterprise_members.user_id = auth.uid()
  ));

-- 2026_06
DROP POLICY IF EXISTS "enterprise_members_read" ON public.case_signal_snapshots_2026_06;
CREATE POLICY "enterprise_members_read" ON public.case_signal_snapshots_2026_06
  FOR SELECT TO authenticated
  USING (institution_id IN (
    SELECT enterprise_members.institution_id FROM enterprise_members
    WHERE enterprise_members.user_id = auth.uid()
  ));

-- 2026_07
DROP POLICY IF EXISTS "enterprise_members_read" ON public.case_signal_snapshots_2026_07;
CREATE POLICY "enterprise_members_read" ON public.case_signal_snapshots_2026_07
  FOR SELECT TO authenticated
  USING (institution_id IN (
    SELECT enterprise_members.institution_id FROM enterprise_members
    WHERE enterprise_members.user_id = auth.uid()
  ));

-- 2026_08
DROP POLICY IF EXISTS "enterprise_members_read" ON public.case_signal_snapshots_2026_08;
CREATE POLICY "enterprise_members_read" ON public.case_signal_snapshots_2026_08
  FOR SELECT TO authenticated
  USING (institution_id IN (
    SELECT enterprise_members.institution_id FROM enterprise_members
    WHERE enterprise_members.user_id = auth.uid()
  ));

-- 2026_09
DROP POLICY IF EXISTS "enterprise_members_read" ON public.case_signal_snapshots_2026_09;
CREATE POLICY "enterprise_members_read" ON public.case_signal_snapshots_2026_09
  FOR SELECT TO authenticated
  USING (institution_id IN (
    SELECT enterprise_members.institution_id FROM enterprise_members
    WHERE enterprise_members.user_id = auth.uid()
  ));

-- 2026_10
DROP POLICY IF EXISTS "enterprise_members_read" ON public.case_signal_snapshots_2026_10;
CREATE POLICY "enterprise_members_read" ON public.case_signal_snapshots_2026_10
  FOR SELECT TO authenticated
  USING (institution_id IN (
    SELECT enterprise_members.institution_id FROM enterprise_members
    WHERE enterprise_members.user_id = auth.uid()
  ));

-- 2026_11
DROP POLICY IF EXISTS "enterprise_members_read" ON public.case_signal_snapshots_2026_11;
CREATE POLICY "enterprise_members_read" ON public.case_signal_snapshots_2026_11
  FOR SELECT TO authenticated
  USING (institution_id IN (
    SELECT enterprise_members.institution_id FROM enterprise_members
    WHERE enterprise_members.user_id = auth.uid()
  ));

-- 2026_12
DROP POLICY IF EXISTS "enterprise_members_read" ON public.case_signal_snapshots_2026_12;
CREATE POLICY "enterprise_members_read" ON public.case_signal_snapshots_2026_12
  FOR SELECT TO authenticated
  USING (institution_id IN (
    SELECT enterprise_members.institution_id FROM enterprise_members
    WHERE enterprise_members.user_id = auth.uid()
  ));
