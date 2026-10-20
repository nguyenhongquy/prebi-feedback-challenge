# Phase 2: Supabase setup and validation

## Status and approval boundary

The repository contains deployable source, **not an applied or deployed backend**.
No hosted database has been contacted, no credentials have been read, no existing
votes have been changed, and GitHub Pages deployment is not configured here.

Before executing any hosted step below, the project owner must review and approve
it. Keep the Data API and automatic table exposure **disabled**. Do not run
`supabase db reset` against a hosted project, and do not paste credentials into chat.

Only the three existing fictional cases are seeded. Real student/educator content
is out of scope pending editorial, permission, and institutional privacy approval.
The sample texts and seed are already public in the repository: source inspection
can identify these fictional examples. Production bundle secrecy protects the
API contract, not the secrecy of already-published sample content.

## Architecture and privacy

```text
React -- HTTPS + public apikey --> public Edge Functions
                                    |
                         PostgreSQL transaction pooler (TLS)
                                    |
                         restricted prebi_edge_login
                                    |
                 prebi_private.start_round / submit_vote
                                    |
                   private cases, rounds, public.votes (RLS)
```

- No Supabase JS client or REST/Data API is needed. Postgres.js 3.4.7 uses
  parameterized SQL, `prepare: false` for transaction pooling, one connection per
  isolate, short idle lifetime, and verified TLS on hosted connections.
- The browser sends the **publishable** key in `apikey`, not as a user JWT.
  Both functions have `verify_jwt = false`. The function checks the configured
  public key and exact origin. These checks are not proof of visitor identity.
- `prebi_edge` can execute only the two controlled routines. It cannot read or
  write tables or invoke the internal aggregates/budget routines. The NOLOGIN
  `prebi_owner` owns the private schema/tables and SECURITY DEFINER routines; it
  can only SELECT/INSERT the existing votes table, subject to its named policies.
  Functions have a fixed `pg_catalog` search path and fully qualified table names.
  Ownership transfer requires the migration administrator to own the objects and
  be able to SET ROLE to `prebi_owner`; that new owner needs CREATE in the target
  schema. The migration grants owner membership to its administrator and makes
  `prebi_owner` the private schema owner. The Edge login never receives owner
  membership. These are PostgreSQL prerequisites, not proof of hosted deployment.
  Private-table owners bypass ordinary RLS (not FORCE RLS); existing votes retain
  their original owner, so the definer uses explicit SELECT/INSERT policies there.
  Existing restrictive vote policies or hosted event triggers may still block it.
- `start-round` returns an opaque 256-bit random token, case ID, title, context,
  A/B paragraphs and active case count. It does not return source labels, reveal
  notes, internal IDs, token hashes, timestamps, or unpublished case metadata.
  Only SHA-256 token hashes are stored. Rounds expire after 30 minutes.
- Submission locks the round, inserts one vote, normalizes A/B to sources, saves
  a response snapshot and commits atomically. Unique round/idempotency indexes
  provide defense in depth. The case lock serializes same-case totals.
- A same-key/same-choice retry returns the **original snapshot**, including after
  the pending-round expiration. It does not increment totals. Changed choices or
  a different key on a submitted round return 409; a key reused across rounds
  also returns 409. Later visitors see newer totals when they submit. Results
  are not live-refreshing; there is intentionally no public raw-results endpoint.
- The adapter retains each round's UUID idempotency key and original choices
  in memory for retries. Reloading loses that pending request; no permanent
  visitor ID, cookie, fingerprint, or analytics is introduced.
- No IP addresses, names, contact information, or device data are stored in
  application tables. Supabase infrastructure may produce its own request logs:
  review its logging/retention separately. The handlers never log raw errors,
  connection strings, submitted bodies, or tokens.
- Bounds: 16 KiB streamed JSON body, at most 100 seen IDs (80 characters each),
  strict fields/enums, UUID-v4 idempotency keys, 15-second browser timeout.
- A database-wide minute budget permits 120 starts and 600 submissions (including
  retries). It stores only action/minute/count, no visitor identifier. It works
  across isolates, but is a coarse booth-scale safeguard, not strong anti-bot
  protection. CORS is bypassable by non-browser clients; an attacker can exhaust
  the shared budget. Review platform limits and monitor before a public launch.
- Reset clears only the current tab's progress and adapter state. It does not
  delete already submitted anonymous votes or affect other sessions. Late
  responses cannot restore the previous visitor's UI.

## 1. Review and apply migrations (project owner)

1. Back up/export the existing votes with your usual Supabase process.
2. Run [preflight.sql](./supabase/preflight.sql) in the SQL editor or using an
   administrator connection. Save its output privately with the backup: role
   attributes/memberships, schema and column ACLs, table owner/ACLs, RLS/FORCE RLS,
   policies, defaults, constraints and triggers. The administrator needs CREATEROLE,
   CREATE on the database/private schema, and ownership rights on existing votes.
   Any existing `prebi_owner`, `prebi_edge` or `prebi_edge_login` now makes the
   migration fail before changing objects; do not silently reuse an unrelated role.
   Stop if existing column grants/inherited browser permissions, restrictive RLS
   policies, triggers, or a different table owner need a separately reviewed change.
3. Review [the migration](./supabase/migrations/202610200001_private_challenge.sql).
   It adds schema/tables/routines, nullable round and idempotency fields, indexes,
   and access restrictions. It changes column defaults for future inserts only.
   Existing rows are not backfilled, overwritten, or deleted. NOT VALID checks
   preserve legacy rows while validating new writes. Legacy rows with valid
   choices and matching case IDs are included in aggregates; malformed legacy
   values are excluded from both totals and categories.
   Intentional permission changes are limited to the new private objects, owner
   membership for the migration administrator, `prebi_owner` SELECT/INSERT plus
   its two vote policies, and revoking table privileges on votes from PUBLIC,
   anon, authenticated and the new Edge role. Revoking PUBLIC also affects roles
   relying on PUBLIC grants: identify these in preflight and approve that impact.
   Existing `service_role` and other explicit grants, vote ownership, and existing
   policies are preserved. `service_role` may therefore still read existing votes;
   it is never a browser credential and has no access to the new private schema.
   Existing column-level or inherited grants are not silently rewritten; the
   post-migration checks must show no residual browser/Edge raw-table access.
4. After approval, either paste the migration into the Supabase SQL editor
   **once**, or use the CLI migration workflow:

   ```sh
   npx supabase login
   npx supabase link --project-ref YOUR_PROJECT_REF
   npx supabase db push --dry-run
   npx supabase db push
   ```

   The CLI steps require your Supabase account/database credentials. The SQL
   editor and CLI are alternatives: do not apply the same migration twice. If
   using the editor, reconcile migration history before later CLI pushes.
5. Run [seed.sql](./supabase/seed.sql) in the SQL editor after separately reviewing
   it. `ON CONFLICT DO NOTHING` preserves existing cases and never touches votes.
   Seeding is deliberately not hidden inside the production migration.
6. Run [verify.sql](./supabase/verify.sql) and compare its output to preflight.
   Existing vote counts and the backup's original six vote fields must be
   unchanged; a matching count alone does not prove preservation. Existing owner,
   grants and policies must differ only as documented above. Browser roles must
   have no routine execution or table/column privileges; `service_role` must have
   no private-routine execution. Only Edge and its login inherit the two entry
   point grants (in addition to owner/administrator rights). The login will show
   as missing until step 2: this means **not yet verified**, not success.

Review locks/index creation on a live database before applying. This initial
booth-scale migration uses a transaction and ordinary indexes, not concurrent
index creation; schedule a maintenance window if the votes table is already large.
Do not replace or drop the old table.

## 2. Provision a restricted PostgreSQL login (project owner)

After migration approval, create the separate server login using an administrator
SQL editor session. Replace the placeholder **locally**, with a unique generated
password; never commit the resulting SQL or share it in chat.

```sql
create role prebi_edge_login
  login inherit nosuperuser nocreatedb nocreaterole nobypassrls
  password 'REPLACE_WITH_A_UNIQUE_GENERATED_PASSWORD';
grant prebi_edge to prebi_edge_login;
grant connect on database postgres to prebi_edge_login;
alter role prebi_edge_login set statement_timeout = '10s';
alter role prebi_edge_login set lock_timeout = '5s';
```

Provision with a fresh role, not an existing application login. On PostgreSQL 16+,
membership INHERIT/SET options also matter: the verification must show that the
login actually inherits `prebi_edge` rights, not merely that a membership exists.
No login may inherit or SET ROLE to `prebi_owner`. The migration administrator is
an intentional exception; it must be trusted and must never be used by an Edge
Function. Inspect all other login memberships and PUBLIC/default privileges too.

Do **not** grant `prebi_owner`, `postgres`, `service_role`, or table privileges to
this login. Supabase's documented custom-role pooler username is
`prebi_edge_login.YOUR_PROJECT_REF`; take the actual pooler host and transaction
port (normally 6543) from Dashboard **Connect → Transaction pooler**. Percent-encode
reserved password characters. Verify the new login through the pooler. If your
project's pooler cannot authenticate custom roles, stop: do not substitute the
administrator password or enable the Data API as a workaround.

### Hosted privilege and execution acceptance (not performed by this repository)

1. Rerun [verify.sql](./supabase/verify.sql) after provisioning. Expect the login
   to have LOGIN/INHERIT, no SUPERUSER/CREATEROLE/CREATEDB/BYPASSRLS, inherited Edge
   rights, and no owner membership. Edge/login need USAGE but not CREATE on the
   private schema. All table/column access cells for Edge and browser roles must
   be false; only the two entry functions should have Edge/login EXECUTE.
2. Check that all four routines are owned by `prebi_owner`, have
   `search_path=pg_catalog`, and only the entry points are SECURITY DEFINER.
   Private tables must be owned by `prebi_owner`, have RLS enabled and not FORCE
   RLS. Votes must keep their old owner and RLS, with the new owner policies.
3. After explicit approval, run [verify-execution.sql](./supabase/verify-execution.sql)
   as the staging administrator. It temporarily grants login membership for
   SET ROLE, creates a uniquely named fictional case, checks actual denied
   SELECT/INSERT and helper access, executes both entry points as
   `prebi_edge_login`, verifies normalized counts/replay, and rejects browser
   invocation. Everything, including the temporary grant, is rolled back.
   With psql use `-X -v ON_ERROR_STOP=1 -f supabase/verify-execution.sql`.
   On failure issue ROLLBACK before continuing. Review triggers first: external
   effects are not rollback-safe. Run in staging, not during live voting.
4. SET ROLE tests do **not** prove password authentication, TLS, pooler routing or
   Edge runtime access. Connect separately through the transaction pooler using
   the actual restricted login (credentials entered locally, never in chat,
   command arguments or committed files). Verify `current_user` and `session_user`
   are `prebi_edge_login`, then run this rollback-only staging smoke test:

   ```sql
   begin;
   do $$
   declare
     token_hash text := md5(gen_random_uuid()::text) || md5(gen_random_uuid()::text);
     started jsonb;
     submitted jsonb;
   begin
     if current_user <> 'prebi_edge_login' then raise exception 'Wrong login'; end if;
     started := prebi_private.start_round(array[]::text[], token_hash, 'A');
     if started->>'caseId' is null then raise exception 'Start failed: %', started; end if;
     submitted := prebi_private.submit_vote(token_hash, 'A', 'equal', gen_random_uuid());
     if submitted->>'humanFeedbackPosition' is distinct from 'A'
       or submitted #>> '{results,totalVotes}' is null then
       raise exception 'Submit/RLS failed: %', submitted;
     end if;
   end $$;
   rollback;
   ```

   This needs active seeded cases and an available request budget, writes only
   within its rolled-back transaction, and still requires trigger review.
5. The administrator must also verify the hosted Dashboard Data API setting is
   disabled. SQL role checks and local `config.toml` cannot prove that hosted
   gateway setting. Direct PostgreSQL execution requires neither PostgREST nor
   exposed schemas. Finally test actual Edge HTTP calls with Data API still off,
   plus independent-connection concurrency, before approving launch.

## 3. Configure server secrets and deploy functions (project owner)

Copy [the server env example](./supabase/functions/.env.example) to
`supabase/functions/.env.local` (git-ignored). Set:

| Secret | Value |
|---|---|
| `PREBI_DATABASE_URL` | Restricted-login transaction pooler URL; database credential, server-only |
| `PREBI_PUBLISHABLE_KEY` | Public `sb_publishable_…` project key; matches browser configuration |
| `PREBI_ALLOWED_ORIGINS` | Comma-separated exact origins, no paths or trailing slash |

For example, origins can include `http://localhost:5173`,
`http://127.0.0.1:5173`, and `https://nguyenhongquy.github.io`. The repository path
is **not** part of an Origin; CORS cannot distinguish repositories on the same
GitHub Pages host. Remove local origins from the hosted allowlist if not needed.

After you approve setting secrets and publishing the endpoints:

```sh
npx supabase secrets set --env-file supabase/functions/.env.local
npx supabase functions deploy start-round --no-verify-jwt
npx supabase functions deploy submit-vote --no-verify-jwt
```

The functions are intentionally anonymous to visitors. They do not create
Supabase Auth users. `PREBI_PUBLISHABLE_KEY` is not a secret authentication
boundary, and no service-role key is used. Review function gateway settings if
a preflight or public-key request is rejected; do not send the publishable key
as a Bearer JWT.

Each function has its own `deno.json` and generated lockfile so deployment resolves
the pinned PostgreSQL driver independently of the frontend's npm dependencies.

## 4. Frontend configuration

```sh
cp .env.example .env.local
```

Set `.env.local`:

```dotenv
VITE_API_MODE=supabase
VITE_SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_REPLACE_ME
```

Restart Vite. These values are public, build-time inputs. **Never** put the
database URL/password, access token, `sb_secret_…` key, or service-role JWT in
any `VITE_` variable. Production mode performs no Data API calls and does not
import fictional answer mappings. The active case count comes from the server.

To keep a separate, explicitly non-submitting offline demonstration, build/run
with `VITE_API_MODE=mock`. That mode keeps demo notices and simulated totals.
There is no automatic failover from real voting to mock data: outages are shown
in German with a retry; expired rounds offer a new round. A non-submitting
fallback can be prepared as a separately labelled mock build for the booth.

```sh
npm run dev
npm run build
```

The GitHub Pages base remains `/prebi-feedback-challenge/`. **Do not deploy to
GitHub Pages yet.**

## 5. Local tests without any project credentials

```sh
npm install
npm test
npm run lint
npm run build
npm run check:functions
npm run test:production-bundle
```

PGlite executes the real migration/seed and PL/pgSQL routines in an isolated
in-memory PostgreSQL database. Tests cover legacy preservation, role restrictions,
A/B order and reveal, no answer leakage, unplayed selection, invalid/expired
rounds, unique keys, normalization, overlapping HTTP retries, lost responses,
empty counts, global budgets, session reset and two independent adapters sharing
case totals. Component tests cover real/demo labels and privacy.

PGlite serializes queries in one embedded connection: Promise-based concurrency
tests exercise idempotency and atomic functions but **do not prove multi-connection
lock behavior**. Test true concurrent hosted/staging connections before launch.
Deno checks the actual runtime imports. The bundle check builds with fake public
configuration and verifies that no mock adapter/case mapping is shipped; it
overwrites only generated `dist/`. Run `npm run build` afterwards to restore your
chosen build mode. No tests require hosted credentials.

The database suite now migrates as a non-superuser CREATEROLE administrator with
ownership/schema grants, then tests an inheriting LOGIN role, explicit browser
EXECUTE denial, direct SELECT/INSERT denial, and successful definer writes/reads
under RLS. It also executes the verification scripts and checks unchanged legacy
vote fields, original ownership, administrative grants and an existing policy.
This exercises PostgreSQL privilege semantics, but does not recreate Supabase's
hosted admin memberships, event triggers, default ACLs, version or pooler.

Regenerate the fictional seed only when changing approved synthetic fixtures:

```sh
npm run seed:generate
```

### Optional full local Supabase stack

Requires Docker and Supabase CLI, neither is required by `npm test`.
Only run these commands against the disposable local stack:

```sh
npx supabase start
npx supabase db reset --local
```

The local reset is destructive to **local test data only**; it applies the
migration and fictional seed. Create the restricted login locally as above.
Use a URL such as
`postgresql://prebi_edge_login:LOCAL_PASSWORD@host.docker.internal:54322/postgres`
from the function container, using your CLI's actual local database port.
Local connections alone disable TLS. Put the local public key and this local
connection in the ignored server env file:

```sh
npx supabase functions serve --env-file supabase/functions/.env.local --no-verify-jwt
```

Use `VITE_SUPABASE_URL=http://127.0.0.1:54321` and the same local public key.
The Data API remains disabled in [config.toml](./supabase/config.toml).

## 6. Required staging acceptance checks

After project owner approval and setup:

1. Verify both functions respond to allowed-origin OPTIONS and reject other
   origins, missing/wrong keys, malformed/oversized JSON and invalid choices.
2. Confirm the start payload has only the documented case/round fields.
3. Complete rounds in two separate browsers. New submissions must show the
   shared same-case totals with correct source normalization.
4. Send several simultaneous identical POSTs to `submit-vote` from independent
   clients using one token/key: exactly one vote row must be inserted and every
   response must match. Retry after deliberately discarding the first response.
5. Reuse the token with different choices/key: 409, no extra row. Test expired
   unsubmitted rounds: 410, no row. Previously saved same-key requests retain
   their original response snapshot.
6. Verify raw-table/routine access is denied to browser roles, Data API remains
   off, and the Edge login cannot SELECT/INSERT tables directly.
7. On 375/390px phones, tablet and booth laptop, verify voting, reveal, counts,
   another round, completion, reset, slow requests, errors and lost-response retry.
8. Reset during an outstanding request: old data must not reappear. Other
   browser sessions and already saved aggregate votes must remain intact.

## Production configuration checklist and remaining risks

- [ ] Migration/preflight/backup reviewed by project owner; existing votes preserved.
- [ ] Fictional seed explicitly approved; real material has separate review.
- [ ] Least-privilege custom login tested through transaction pooler; verified TLS.
- [ ] Secrets stored server-side; no secrets in browser build or source control.
- [ ] Data API/exposure remain off; RLS, schema and function privileges verified.
- [ ] Both functions deployed with public invocation; exact CORS origins verified.
- [ ] Frontend uses production mode and correct public URL/key.
- [ ] Public build checked for mock case/answer-key leakage.
- [ ] Live multi-connection concurrency, gateway/pooler and failure checks completed.
- [ ] Institutional privacy/retention/hosting approval obtained before public use.
- [ ] Database-backed global budgets/connection load tested for expected traffic.
- [ ] Separate offline mock demo prepared and clearly labelled if needed.
- [ ] HTTPS mobile and screen-reader checks completed before eventual Pages release.

Pending-round expiry prevents old submissions but does not delete stored data.
Decide and document a retention period with the institution before launch. Any
cleanup must preserve submitted rounds as long as their retry snapshots are
needed; votes reference rounds and will block unsafe round deletion. No automatic
deletion or scheduled retention job is installed. Regularly review expired pending
round growth; choose an approved maintenance policy separately.

The global budgets protect database work only after basic HTTP validation and
are intentionally coarse. This public anonymous activity cannot guarantee one
vote per human and is not a research-grade instrument.

### Upstream references

- [Supabase PostgreSQL connections and pooler selection](https://supabase.com/docs/guides/database/connecting-to-postgres)
- [Edge Functions PostgreSQL access](https://supabase.com/docs/guides/functions/connect-to-postgres)
- [Public function invocation and keys](https://supabase.com/docs/guides/functions/auth)
- [Supabase PostgreSQL roles](https://supabase.com/docs/guides/database/postgres/roles)
- [PostgreSQL ownership transfer requirements](https://www.postgresql.org/docs/current/sql-alterfunction.html)
- [PostgreSQL RLS owner bypass and FORCE RLS](https://www.postgresql.org/docs/current/ddl-rowsecurity.html)
