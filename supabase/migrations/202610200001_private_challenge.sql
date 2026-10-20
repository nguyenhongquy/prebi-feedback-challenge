-- Additive migration: existing public.votes rows are never updated or deleted.
begin;

do $$
begin
  if exists (select 1 from pg_roles where rolname in ('prebi_owner', 'prebi_edge', 'prebi_edge_login')) then
    raise exception 'prebi roles already exist; review their attributes, memberships and privileges before migrating';
  end if;
  create role prebi_owner nologin nosuperuser nocreatedb nocreaterole noinherit nobypassrls;
  create role prebi_edge nologin nosuperuser nocreatedb nocreaterole noinherit nobypassrls;
end $$;

-- Supabase's postgres administrator is not a superuser; ownership transfer needs membership.
grant prebi_owner to current_user;
create schema prebi_private authorization prebi_owner;
revoke all on schema prebi_private from public, anon, authenticated, service_role;
grant usage on schema prebi_private to prebi_edge;

create table prebi_private.cases (
  id text primary key check (id ~ '^[a-z0-9-]{1,80}$'),
  title text not null,
  context text not null,
  human_feedback text[] not null check (cardinality(human_feedback) between 1 and 10),
  ai_feedback text[] not null check (cardinality(ai_feedback) between 1 and 10),
  reveal_note text not null,
  discussion_prompt text not null,
  active boolean not null default false
);

create table prebi_private.rounds (
  id uuid primary key default gen_random_uuid(),
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  case_id text not null references prebi_private.cases(id),
  human_position text not null check (human_position in ('A', 'B')),
  expires_at timestamptz not null default (now() + interval '30 minutes'),
  created_at timestamptz not null default now(),
  submitted_at timestamptz,
  -- The snapshot makes lost-response retries deterministic, even after more votes arrive.
  response jsonb,
  check ((submitted_at is null) = (response is null))
);

create index rounds_expiry_idx on prebi_private.rounds(expires_at);
create table prebi_private.request_budgets (
  action text primary key check (action in ('start', 'submit')),
  window_start timestamptz not null,
  requests integer not null
);

alter table prebi_private.cases owner to prebi_owner;
alter table prebi_private.rounds owner to prebi_owner;
alter table prebi_private.request_budgets owner to prebi_owner;
alter table prebi_private.cases enable row level security;
alter table prebi_private.rounds enable row level security;
alter table prebi_private.request_budgets enable row level security;

-- Also supports a fresh local database while retaining the supplied hosted table.
create table if not exists public.votes (
  id uuid primary key default gen_random_uuid(),
  case_id text,
  human_position text,
  authorship_guess text,
  helpfulness_preference text,
  created_at timestamptz default now()
);
alter table public.votes
  alter column id set default gen_random_uuid(),
  alter column created_at set default now(),
  add column round_id uuid references prebi_private.rounds(id),
  add column idempotency_key uuid;

-- NOT VALID preserves legacy rows, but still enforces the rules on every new row.
alter table public.votes add constraint prebi_vote_values check (
  case_id is not null and human_position in ('A', 'B')
  and human_position is not null
  and authorship_guess in ('A', 'B', 'unsure') and authorship_guess is not null
  and helpfulness_preference in ('A', 'B', 'equal') and helpfulness_preference is not null
) not valid;
alter table public.votes add constraint prebi_vote_round_pair check (
  (round_id is null) = (idempotency_key is null)
) not valid;
create unique index prebi_votes_round_unique on public.votes(round_id);
create unique index prebi_votes_idempotency_unique on public.votes(idempotency_key);
create index prebi_votes_case_idx on public.votes(case_id);
alter table public.votes enable row level security;
-- Preserve unrelated administrative integrations, including existing service_role grants.
revoke all on public.votes from public, anon, authenticated, prebi_edge;
grant usage on schema public to prebi_owner;
grant select, insert on public.votes to prebi_owner;
create policy prebi_owner_read on public.votes for select to prebi_owner using (true);
create policy prebi_owner_insert on public.votes for insert to prebi_owner with check (true);

create function prebi_private.take_budget(p_action text, p_limit integer)
returns boolean
language plpgsql
set search_path = pg_catalog
as $$
declare used integer;
begin
  insert into prebi_private.request_budgets as budget (action, window_start, requests)
  values (p_action, date_trunc('minute', clock_timestamp()), 1)
  on conflict (action) do update
    set requests = case
      when budget.window_start < date_trunc('minute', clock_timestamp()) then 1
      else budget.requests + 1 end,
    window_start = date_trunc('minute', clock_timestamp())
  returning requests into used;
  return used <= p_limit;
end $$;

create function prebi_private.case_results(p_case_id text)
returns jsonb
language sql stable
set search_path = pg_catalog
as $$
  select jsonb_build_object(
    'totalVotes', count(*),
    'authorship', jsonb_build_object(
      'human', count(*) filter (where authorship_guess = human_position),
      'ai', count(*) filter (where authorship_guess in ('A', 'B') and authorship_guess <> human_position),
      'unsure', count(*) filter (where authorship_guess = 'unsure')),
    'helpfulness', jsonb_build_object(
      'human', count(*) filter (where helpfulness_preference = human_position),
      'ai', count(*) filter (where helpfulness_preference in ('A', 'B') and helpfulness_preference <> human_position),
      'equal', count(*) filter (where helpfulness_preference = 'equal')))
  from public.votes
  where case_id = p_case_id
    and human_position in ('A', 'B')
    and authorship_guess in ('A', 'B', 'unsure')
    and helpfulness_preference in ('A', 'B', 'equal');
$$;

create function prebi_private.start_round(p_seen text[], p_token_hash text, p_human_position text)
returns jsonb
language plpgsql security definer
set search_path = pg_catalog
as $$
declare selected_case prebi_private.cases; case_count integer;
begin
  if p_seen is null or cardinality(p_seen) > 100
    or exists (select 1 from unnest(p_seen) as seen(id) where id is null or id !~ '^[a-z0-9-]{1,80}$')
    or p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$'
    or p_human_position is null or p_human_position not in ('A', 'B') then
    return jsonb_build_object('error', 'INVALID_INPUT');
  end if;
  if not prebi_private.take_budget('start', 120) then
    return jsonb_build_object('error', 'RATE_LIMITED');
  end if;
  select count(*) into case_count from prebi_private.cases where active;
  select * into selected_case from prebi_private.cases
    where active and not (id = any(p_seen))
    order by random() limit 1;
  if not found then
    return jsonb_build_object('complete', true);
  end if;
  insert into prebi_private.rounds(token_hash, case_id, human_position)
    values (p_token_hash, selected_case.id, p_human_position);
  return jsonb_build_object(
    'complete', false, 'caseId', selected_case.id, 'title', selected_case.title,
    'context', selected_case.context, 'totalCases', case_count,
    'feedbackA', case when p_human_position = 'A' then selected_case.human_feedback else selected_case.ai_feedback end,
    'feedbackB', case when p_human_position = 'B' then selected_case.human_feedback else selected_case.ai_feedback end);
end $$;

create function prebi_private.submit_vote(
  p_token_hash text, p_authorship text, p_helpfulness text, p_idempotency_key uuid
)
returns jsonb
language plpgsql security definer
set search_path = pg_catalog
as $$
declare
  current_round prebi_private.rounds;
  saved_vote public.votes;
  selected_case prebi_private.cases;
  result jsonb;
begin
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$'
    or p_authorship is null or p_authorship not in ('A', 'B', 'unsure')
    or p_helpfulness is null or p_helpfulness not in ('A', 'B', 'equal')
    or p_idempotency_key is null then
    return jsonb_build_object('error', 'INVALID_INPUT');
  end if;
  if not prebi_private.take_budget('submit', 600) then
    return jsonb_build_object('error', 'RATE_LIMITED');
  end if;
  -- Row lock serializes concurrent submissions for the same round.
  select * into current_round from prebi_private.rounds
    where token_hash = p_token_hash for update;
  if not found then return jsonb_build_object('error', 'ROUND_INVALID'); end if;
  if current_round.submitted_at is not null then
    select * into saved_vote from public.votes where round_id = current_round.id;
    if saved_vote.idempotency_key = p_idempotency_key
      and saved_vote.authorship_guess = p_authorship
      and saved_vote.helpfulness_preference = p_helpfulness then
      return current_round.response;
    end if;
    return jsonb_build_object('error', 'ALREADY_SUBMITTED');
  end if;
  if current_round.expires_at <= clock_timestamp() then
    return jsonb_build_object('error', 'ROUND_EXPIRED');
  end if;
  -- Serialize totals per case so each successful response includes its own vote.
  select * into selected_case from prebi_private.cases
    where id = current_round.case_id for update;
  begin
    insert into public.votes(case_id, human_position, authorship_guess, helpfulness_preference, round_id, idempotency_key)
      values (current_round.case_id, current_round.human_position, p_authorship, p_helpfulness, current_round.id, p_idempotency_key);
  exception when unique_violation then
    return jsonb_build_object('error', 'IDEMPOTENCY_CONFLICT');
  end;
  result := jsonb_build_object(
    'humanFeedbackPosition', current_round.human_position,
    'vote', jsonb_build_object('authorshipGuess', p_authorship, 'helpfulnessPreference', p_helpfulness),
    'revealNote', selected_case.reveal_note,
    'discussionPrompt', selected_case.discussion_prompt,
    'results', prebi_private.case_results(current_round.case_id), 'isDemo', false);
  update prebi_private.rounds set submitted_at = clock_timestamp(), response = result
    where id = current_round.id;
  return result;
end $$;

alter function prebi_private.take_budget(text, integer) owner to prebi_owner;
alter function prebi_private.case_results(text) owner to prebi_owner;
alter function prebi_private.start_round(text[], text, text) owner to prebi_owner;
alter function prebi_private.submit_vote(text, text, text, uuid) owner to prebi_owner;
revoke all on all tables in schema prebi_private from public, anon, authenticated, service_role, prebi_edge;
revoke execute on all functions in schema prebi_private from public, anon, authenticated, service_role, prebi_edge;
grant execute on function prebi_private.start_round(text[], text, text) to prebi_edge;
grant execute on function prebi_private.submit_vote(text, text, text, uuid) to prebi_edge;
alter default privileges for role prebi_owner in schema prebi_private revoke execute on functions from public;

commit;
