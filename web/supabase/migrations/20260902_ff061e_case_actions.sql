-- FF-061E: Case Action Tracker
-- Stores broker-logged actions per case, fed into sweep context

create table if not exists enterprise_case_actions (
  id             uuid primary key default gen_random_uuid(),
  institution_id uuid not null references enterprise_institutions(id) on delete cascade,
  case_ref       text not null,
  objective_id   uuid references enterprise_objectives(id) on delete set null,
  action_text    text not null,
  action_date    date not null default current_date,
  outcome        text check (outcome in ('pending', 'complete', 'no_response', 'abandoned')),
  outcome_note   text,
  outcome_date   date,
  scored         boolean not null default false,
  created_by     text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

alter table enterprise_case_actions enable row level security;

create policy "members can read own institution actions"
  on enterprise_case_actions for select
  using (
    institution_id in (
      select institution_id from enterprise_members where user_id = auth.uid()
    )
  );

create policy "members can insert own institution actions"
  on enterprise_case_actions for insert
  with check (
    institution_id in (
      select institution_id from enterprise_members where user_id = auth.uid()
    )
  );

create policy "members can update own institution actions"
  on enterprise_case_actions for update
  using (
    institution_id in (
      select institution_id from enterprise_members where user_id = auth.uid()
    )
  );

create index if not exists enterprise_case_actions_institution_ref_idx
  on enterprise_case_actions (institution_id, case_ref);
