-- Administrator-only, explicit approval required. Run on staging after login provisioning.
-- This probe WRITES synthetic data, switches roles, then rolls EVERYTHING back.
-- Review existing triggers first: external/nontransactional effects cannot be rolled back.
-- With psql use -v ON_ERROR_STOP=1; on any error ROLLBACK before further commands.
begin;

-- Needed for SET ROLE on hosted non-superuser administrators; rolled back below.
grant prebi_edge_login to current_user;

do $$
declare
  probe_id text := 'privilege-probe-' || gen_random_uuid()::text;
  seen text[];
begin
  select array_agg(id) into seen from prebi_private.cases where active;
  if coalesce(cardinality(seen), 0) > 100 then
    raise exception 'Probe supports at most 100 existing active cases';
  end if;
  perform set_config('prebi.probe_seen', coalesce(seen, array[]::text[])::text, true);
  perform set_config('prebi.probe_case', probe_id, true);
  perform set_config('prebi.probe_hash', md5(gen_random_uuid()::text) || md5(gen_random_uuid()::text), true);
  insert into prebi_private.cases
    (id, title, context, human_feedback, ai_feedback, reveal_note, discussion_prompt, active)
  values (probe_id, 'Fiktiver Berechtigungstest', 'Nur fuer den SQL-Test.',
    array['Fiktives menschliches Feedback.'], array['Fiktives KI-Feedback.'],
    'Testaufloesung', 'Testfrage?', true);
end $$;

set local role prebi_edge_login;
do $$
declare
  target text;
  result jsonb;
  replay jsonb;
  probe_key uuid := gen_random_uuid();
begin
  if current_user <> 'prebi_edge_login' then raise exception 'Wrong execution role'; end if;
  if exists (select 1 from pg_roles where rolname = current_user
    and (not rolcanlogin or not rolinherit or rolsuper or rolcreaterole or rolcreatedb or rolbypassrls)) then
    raise exception 'Unsafe login attributes';
  end if;
  if not pg_has_role(current_user, 'prebi_edge', 'usage')
    or pg_has_role(current_user, 'prebi_owner', 'member') then
    raise exception 'Unexpected login memberships';
  end if;
  foreach target in array array[
    'prebi_private.cases', 'prebi_private.rounds', 'prebi_private.request_budgets', 'public.votes'
  ] loop
    if has_any_column_privilege(current_user, target, 'select')
      or has_any_column_privilege(current_user, target, 'insert')
      or has_table_privilege(current_user, target, 'update,delete,truncate,references,trigger') then
      raise exception 'Unexpected table/column grant: %', target;
    end if;
    begin
      execute format('select * from %s limit 1', target);
      raise exception 'Unexpected SELECT access: %', target;
    exception when insufficient_privilege then null;
    end;
    begin
      execute format('insert into %s default values', target);
      raise exception 'Unexpected INSERT access: %', target;
    exception when insufficient_privilege then null;
    end;
  end loop;
  begin
    perform prebi_private.case_results(current_setting('prebi.probe_case'));
    raise exception 'Unexpected aggregate function access';
  exception when insufficient_privilege then null;
  end;
  begin
    perform prebi_private.take_budget('start', 120);
    raise exception 'Unexpected budget function access';
  exception when insufficient_privilege then null;
  end;

  result := prebi_private.start_round(current_setting('prebi.probe_seen')::text[],
    current_setting('prebi.probe_hash'), 'B');
  if result->>'caseId' is distinct from current_setting('prebi.probe_case') then
    raise exception 'start_round failed: %', result;
  end if;
  result := prebi_private.submit_vote(current_setting('prebi.probe_hash'), 'B', 'A', probe_key);
  if result->>'humanFeedbackPosition' is distinct from 'B'
    or result #>> '{results,totalVotes}' is distinct from '1'
    or result #>> '{results,authorship,human}' is distinct from '1'
    or result #>> '{results,helpfulness,ai}' is distinct from '1' then
    raise exception 'submit_vote / RLS / aggregates failed: %', result;
  end if;
  replay := prebi_private.submit_vote(current_setting('prebi.probe_hash'), 'B', 'A', probe_key);
  if replay is distinct from result then raise exception 'Idempotency replay failed'; end if;
end $$;
reset role;

do $$
declare browser_role text;
begin
  foreach browser_role in array array['anon', 'authenticated'] loop
    if has_function_privilege(browser_role, 'prebi_private.start_round(text[],text,text)', 'execute')
      or has_function_privilege(browser_role, 'prebi_private.submit_vote(text,text,text,uuid)', 'execute') then
      raise exception 'Unexpected browser EXECUTE grant: %', browser_role;
    end if;
    execute format('set local role %I', browser_role);
    begin
      perform prebi_private.start_round(array[]::text[], repeat('0', 64), 'A');
      raise exception 'Unexpected start_round access for %', browser_role;
    exception when insufficient_privilege then null;
    end;
    begin
      perform prebi_private.submit_vote(repeat('0', 64), 'A', 'A', gen_random_uuid());
      raise exception 'Unexpected submit_vote access for %', browser_role;
    exception when insufficient_privilege then null;
    end;
    reset role;
  end loop;
end $$;

rollback;
