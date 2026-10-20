-- Read-only verification after applying migrations. Run as the administrator.
select count(*) as total_votes_including_legacy from public.votes;
select count(*) as active_cases from prebi_private.cases where active;
select n.nspname, c.relname, c.relrowsecurity
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where (n.nspname = 'prebi_private' and c.relkind = 'r')
   or (n.nspname = 'public' and c.relname = 'votes');

select role_name,
  has_table_privilege(role_name, 'public.votes', 'select') as can_read_raw_votes,
  has_table_privilege(role_name, 'public.votes', 'insert') as can_insert_raw_votes,
  has_schema_privilege(role_name, 'prebi_private', 'usage') as can_use_private_schema,
  has_function_privilege(role_name, 'prebi_private.start_round(text[],text,text)', 'execute') as can_start,
  has_function_privilege(role_name, 'prebi_private.submit_vote(text,text,text,uuid)', 'execute') as can_submit
from unnest(array['anon','authenticated','service_role','prebi_edge']) as roles(role_name);

select indexname, indexdef from pg_indexes
where schemaname = 'public' and tablename = 'votes'
  and indexname like 'prebi_%';
