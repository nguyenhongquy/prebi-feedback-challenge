-- Additive follow-up: two more fixed reasons, at most three per vote, and reasons
-- may also be given for "equal". Still no free text. Existing votes are not
-- updated; NOT VALID keeps earlier rows (up to five reasons) while new rows must
-- satisfy the new rule.
begin;

alter table public.votes drop constraint prebi_vote_helpfulness_reasons;
alter table public.votes add constraint prebi_vote_helpfulness_reasons check (
  helpfulness_reasons is null
  or (helpfulness_reasons <@ array['concrete', 'personal', 'precise', 'clear', 'encouraging',
      'honest', 'concise']::text[]
    and array_position(helpfulness_reasons, null) is null
    and cardinality(helpfulness_reasons) <= 3)
) not valid;

create or replace function prebi_private.submit_vote(
  p_token_hash text, p_authorship text, p_helpfulness text, p_idempotency_key uuid,
  p_reasons text[]
)
returns jsonb
language plpgsql security definer
set search_path = pg_catalog
as $$
declare
  allowed constant text[] := array['concrete', 'personal', 'precise', 'clear', 'encouraging',
    'honest', 'concise'];
  reasons text[];
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
  if p_reasons is not null then
    if cardinality(p_reasons) > 3
      or array_position(p_reasons, null) is not null
      or not (p_reasons <@ allowed)
      or (select count(distinct reason) from unnest(p_reasons) as given(reason)) <> cardinality(p_reasons) then
      return jsonb_build_object('error', 'INVALID_INPUT');
    end if;
    -- Canonical order makes retries independent of click order.
    reasons := array(
      select reason from unnest(allowed) with ordinality as fixed(reason, position)
      where reason = any(p_reasons) order by position);
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
      and saved_vote.helpfulness_preference = p_helpfulness
      and saved_vote.helpfulness_reasons is not distinct from reasons then
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
    insert into public.votes(case_id, human_position, authorship_guess, helpfulness_preference,
      helpfulness_reasons, round_id, idempotency_key)
      values (current_round.case_id, current_round.human_position, p_authorship, p_helpfulness,
        reasons, current_round.id, p_idempotency_key);
  exception when unique_violation then
    return jsonb_build_object('error', 'IDEMPOTENCY_CONFLICT');
  end;
  result := jsonb_build_object(
    'humanFeedbackPosition', current_round.human_position,
    'vote', jsonb_build_object('authorshipGuess', p_authorship, 'helpfulnessPreference', p_helpfulness,
      'helpfulnessReasons', to_jsonb(reasons)),
    'revealNote', selected_case.reveal_note,
    'discussionPrompt', selected_case.discussion_prompt,
    'results', prebi_private.case_results(current_round.case_id), 'isDemo', false);
  update prebi_private.rounds set submitted_at = clock_timestamp(), response = result
    where id = current_round.id;
  return result;
end $$;

-- CREATE OR REPLACE keeps owner and grants; restated so the result is explicit.
alter function prebi_private.submit_vote(text, text, text, uuid, text[]) owner to prebi_owner;
revoke execute on function prebi_private.submit_vote(text, text, text, uuid, text[])
  from public, anon, authenticated, service_role;
grant execute on function prebi_private.submit_vote(text, text, text, uuid, text[]) to prebi_edge;

commit;
