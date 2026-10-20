-- Read-only: save these results privately before applying the migration.
select version(), current_user, session_user,
  has_database_privilege(current_user, current_database(), 'create') as can_create_schema,
  has_schema_privilege(current_user, 'public', 'create') as can_create_public_objects;

select rolname, rolcanlogin, rolsuper, rolcreaterole, rolcreatedb, rolinherit, rolbypassrls
from pg_roles
where rolname in (current_user, 'anon', 'authenticated', 'service_role',
  'prebi_owner', 'prebi_edge', 'prebi_edge_login');

select pg_get_userbyid(roleid) as granted_role, pg_get_userbyid(member) as member,
  admin_option
from pg_auth_members
where roleid in (select oid from pg_roles where rolname like 'prebi_%')
   or member in (select oid from pg_roles where rolname like 'prebi_%' or rolname = current_user);

select nspname, pg_get_userbyid(nspowner) as owner, nspacl
from pg_namespace where nspname in ('public', 'prebi_private');

select column_name, data_type, is_nullable, column_default
from information_schema.columns
where table_schema = 'public' and table_name = 'votes'
order by ordinal_position;
select count(*) as existing_vote_count from public.votes;
select pg_get_userbyid(relowner) as owner, relacl, relrowsecurity, relforcerowsecurity,
  pg_has_role(current_user, relowner, 'usage') as administrator_has_owner_privileges
from pg_class where oid = 'public.votes'::regclass;
select attname, attacl from pg_attribute
where attrelid = 'public.votes'::regclass and attnum > 0 and not attisdropped;
select conname, pg_get_constraintdef(oid) as definition
from pg_constraint where conrelid = 'public.votes'::regclass;
select schemaname, tablename, policyname, roles, permissive, cmd, qual, with_check
from pg_policies where schemaname = 'public' and tablename = 'votes';
select tgname, pg_get_triggerdef(oid)
from pg_trigger where tgrelid = 'public.votes'::regclass and not tgisinternal;

-- Hosted default grants and event triggers can differ from a clean PostgreSQL database.
select pg_get_userbyid(defaclrole) as creator, n.nspname, defaclobjtype, defaclacl
from pg_default_acl d left join pg_namespace n on n.oid = d.defaclnamespace;
select evtname, evtevent, evtenabled, evtfoid::regprocedure from pg_event_trigger;
