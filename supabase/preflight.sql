-- Read-only. Run as the project database administrator before reviewing/applying migrations.
select column_name, data_type, is_nullable, column_default
from information_schema.columns
where table_schema = 'public' and table_name = 'votes'
order by ordinal_position;

select count(*) as existing_vote_count from public.votes;
select conname, pg_get_constraintdef(oid) as definition
from pg_constraint where conrelid = 'public.votes'::regclass;
select schemaname, tablename, policyname, roles, cmd, qual, with_check
from pg_policies where schemaname = 'public' and tablename = 'votes';
select tgname, pg_get_triggerdef(oid)
from pg_trigger where tgrelid = 'public.votes'::regclass and not tgisinternal;
select rolname, rolcanlogin, rolsuper, rolbypassrls
from pg_roles where rolname in ('prebi_owner', 'prebi_edge', 'prebi_edge_login');
