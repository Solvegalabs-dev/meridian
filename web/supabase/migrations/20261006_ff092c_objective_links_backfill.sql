-- FF-092 Part 1 (data): link orphan objective_profiles to an objectives row.
--
-- Orphans are profiles with objective_id IS NULL. They were created by /strike/new or by a
-- partner before the create route inserted an objectives row, so the sweep, strike_briefs and
-- the objective-keyed paths never saw them. For each orphan that is not completed or missed:
--   owner = profile.user_id, or the partner's service owner when the profile came from a partner
--   a new objectives row is created with the next OBJ-NN for that owner
--   the profile's objective_id is set to that row
-- A profile with no owner at all is skipped and logged by profile id (no coordinates).
--
-- Run once. Re-running is safe: linked profiles no longer match the WHERE clause.
-- Run AFTER 20261006_ff092a_partner_keys.sql (it reads partners.owner_user_id).
--
-- To list the affected profiles before or after running:
--   SELECT id, org_source, partner_id, taxonomy_key, status FROM objective_profiles WHERE objective_id IS NULL;

DO $$
DECLARE
  r           record;
  v_owner     uuid;
  v_num       int;
  v_obj_id    text;
  v_title     text;
  v_target    date;
  v_objective uuid;
BEGIN
  FOR r IN
    SELECT p.id, p.user_id, p.partner_id, p.taxonomy_key, p.hunt_code, p.timing
    FROM objective_profiles p
    WHERE p.objective_id IS NULL
      AND COALESCE(p.status, 'active') NOT IN ('completed', 'missed')
    ORDER BY p.id
  LOOP
    v_owner := r.user_id;
    IF v_owner IS NULL AND r.partner_id IS NOT NULL THEN
      SELECT owner_user_id INTO v_owner FROM partners WHERE id = r.partner_id;
    END IF;

    IF v_owner IS NULL THEN
      RAISE NOTICE 'ff092 backfill skipped profile % (no owner)', r.id;
      CONTINUE;
    END IF;

    SELECT COALESCE(MAX(substring(obj_id FROM '^OBJ-([0-9]+)$')::int), 0) + 1
      INTO v_num
      FROM objectives
      WHERE user_id = v_owner;
    v_obj_id := 'OBJ-' || LPAD(v_num::text, 2, '0');

    v_title := REPLACE(COALESCE(r.taxonomy_key, 'Objective'), '.', ' · ');
    IF r.hunt_code IS NOT NULL THEN
      v_title := v_title || ' · ' || r.hunt_code;
    END IF;

    v_target := CASE
      WHEN (r.timing::jsonb ->> 'trip_end') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
        THEN (r.timing::jsonb ->> 'trip_end')::date
      ELSE NULL
    END;

    INSERT INTO objectives (
      user_id, obj_id, title, category, outcome, target_date,
      status, objective_type, deadline_type, confidence, sort_order
    )
    VALUES (
      v_owner, v_obj_id, v_title, 'personal', 'Complete the ' || v_title || ' objective', v_target,
      'active', r.taxonomy_key, 'hard', 50, v_num
    )
    RETURNING id INTO v_objective;

    UPDATE objective_profiles
    SET objective_id = v_objective,
        user_id = COALESCE(user_id, v_owner)
    WHERE id = r.id;

    RAISE NOTICE 'ff092 backfill linked profile % to objective %', r.id, v_objective;
  END LOOP;
END
$$;
