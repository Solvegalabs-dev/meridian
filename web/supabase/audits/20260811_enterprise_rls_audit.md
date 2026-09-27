# Enterprise RLS Audit — 2026-08-11

Item 3 of the FUSION ENTERPRISE SPRINT. Ran via Supabase MCP against project
`naskidrydhxbxnpplvla`. **No fixes were needed — this is a record of what was
checked, not a remediation.**

## Scope-vs-reality note

The task spec's checklist assumed the cohort-partition key used in enterprise
RLS policies is `org_source` (to be checked against a stale `account_type`
key). Neither concept exists in the enterprise schema: `org_source` is part
of a separate, unrelated invite/cohort-report system (`invite_codes`,
`cohort_report_configs`), and `account_type` only ever appears in a migration
comment about a signup-trigger bug on the *personal* (non-enterprise)
`profiles` table. The actual — and correct — cohort key for every enterprise
table is **`institution_id`**, enforced via a `get_user_institution_id()`
helper function. This audit checks that pattern instead.

## Query 1 — RLS enabled on all `enterprise_%` tables

```sql
SELECT tablename, rowsecurity
FROM pg_tables
WHERE tablename LIKE 'enterprise_%' AND schemaname = 'public';
```

| Table | RLS enabled |
|---|---|
| enterprise_case_history | ✅ true |
| enterprise_cases | ✅ true |
| enterprise_institutions | ✅ true |
| enterprise_macro_events | ✅ true |
| enterprise_members | ✅ true |
| enterprise_objective_results | ✅ true |
| enterprise_objectives | ✅ true |
| enterprise_portfolio_metrics | ✅ true |
| enterprise_predictions | ✅ true |
| enterprise_sweeps | ✅ true |

All 10 enterprise tables have RLS enabled. No `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` needed.

## Query 2 — policy cohort-key check

```sql
SELECT tablename, policyname, cmd, roles, qual
FROM pg_policies
WHERE tablename LIKE 'enterprise_%';
```

| Table | Policy | Cohort key used |
|---|---|---|
| enterprise_case_history | `enterprise_members_read_case_history` | `institution_id = get_user_institution_id()` |
| enterprise_cases | `enterprise_members_read_cases` | `institution_id = get_user_institution_id()` |
| enterprise_institutions | `enterprise_members_read_institutions` | `id = get_user_institution_id()` |
| enterprise_macro_events | `macro_events_authenticated_read` | none — intentionally global reference data (macro events aren't institution-scoped) |
| enterprise_members | `enterprise_members_self_read` | `user_id = auth.uid()` |
| enterprise_objective_results | `obj_results_read` | `institution_id = get_user_institution_id()` |
| enterprise_objectives | `enterprise_members_read_objectives` | `institution_id = get_user_institution_id()` |
| enterprise_portfolio_metrics | `portfolio_metrics_read` | `institution_id = get_user_institution_id()` |
| enterprise_predictions | `enterprise_members_read_predictions` | `institution_id = get_user_institution_id()` |
| enterprise_sweeps | `enterprise_members_read_sweeps` | `institution_id = get_user_institution_id()` |

Every institution-scoped table consistently uses `institution_id =
get_user_institution_id()` for `authenticated`-role `SELECT`. Every table
additionally has a `service_role`-only `ALL` policy for backend jobs
(ingest, sweeps) that bypass per-row scoping intentionally via
`createServiceClient()`. No policy references `account_type`, and no
policy was found using an inconsistent or missing cohort key.

## Conclusion

No RLS gaps found. No migration needed for this item. Recommend closing this
out as "audited, clean" rather than merging speculative changes.
