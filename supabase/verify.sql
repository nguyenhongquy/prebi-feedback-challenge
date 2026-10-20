-- Read-only: run as administrator after migration, then again after login provisioning.
-- Missing login means NOT YET VERIFIED, not success. Compare preflight results/backup.
select count(*) as total_votes_including_legacy from public.votes;
select count(*) as active_cases from prebi_private.cases where active;
select n.nspname, c.relname, pg_get_userbyid(c.relowner) as owner,
  c.relrowsecurity, c.relforcerowsecurity, c.relacl
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where (n.nspname = 'prebi_private' and c.relkind = 'r')
   or (n.nspname = 'public' and c.relname = 'votes');
select schemaname, tablename, policyname, roles, permissive, cmd, qual, with_check
from pg_policies
where schemaname = 'prebi_private' or (schemaname = 'public' and tablename = 'votes');

select expected.name, r.oid is not null as role_exists, r.rolcanlogin, r.rolsuper,
  r.rolcreatedb, r.rolcreaterole, r.rolinherit, r.rolbypassrls,
  pg_has_role(r.oid, 'prebi_owner', 'member') as member_of_owner,
  pg_has_role(r.oid, 'prebi_edge', 'usage') as inherits_edge_rights
from unnest(array['anon','authenticated','service_role','prebi_owner',
  'prebi_edge','prebi_edge_login']) expected(name)
left join pg_roles r on r.rolname = expected.name;

select pg_get_userbyid(roleid) as granted_role, pg_get_userbyid(member) as member,
  admin_option
from pg_auth_members
where roleid in (select oid from pg_roles where rolname like 'prebi_%')
   or member in (select oid from pg_roles where rolname like 'prebi_%');

-- Edge login: USAGE true, CREATE false on private schema, no owner membership.
select r.rolname, n.nspname, pg_get_userbyid(n.nspowner) as owner, n.nspacl,
  has_schema_privilege(r.oid, n.oid, 'usage') as can_use,
  has_schema_privilege(r.oid, n.oid, 'create') as can_create
from pg_roles r cross join pg_namespace n
where r.rolname in ('anon','authenticated','prebi_owner','prebi_edge','prebi_edge_login')
  and n.nspname in ('public','prebi_private');

-- All cells false for Edge/browser roles. service_role's old vote ACL is preserved.
select r.rolname, t.name as table_name,
  has_table_privilege(r.oid, t.name, 'select') as can_select,
  has_any_column_privilege(r.oid, t.name, 'select') as can_select_any_column,
  has_table_privilege(r.oid, t.name, 'insert') as can_insert,
  has_any_column_privilege(r.oid, t.name, 'insert') as can_insert_any_column,
  has_table_privilege(r.oid, t.name, 'update,delete,truncate,references,trigger') as other_table_rights
from pg_roles r cross join (values
  ('prebi_private.cases'), ('prebi_private.rounds'), ('prebi_private.request_budgets'), ('public.votes')
) t(name)
where r.rolname in ('anon','authenticated','prebi_edge','prebi_edge_login');

-- Only the two entry points should be executable by Edge/login; browser roles: none.
-- Owner must be prebi_owner; only entry points SECURITY DEFINER; search_path=pg_catalog.
select p.oid::regprocedure as function, pg_get_userbyid(p.proowner) as owner,
  p.prosecdef, p.proconfig, p.proacl, r.rolname,
  has_function_privilege(r.oid, p.oid, 'execute') as can_execute
from pg_proc p join pg_namespace n on n.oid = p.pronamespace cross join pg_roles r
where n.nspname = 'prebi_private'
  and r.rolname in ('anon','authenticated','service_role','prebi_edge','prebi_edge_login');

select indexname, indexdef from pg_indexes
where schemaname = 'public' and tablename = 'votes' and indexname like 'prebi_%';
