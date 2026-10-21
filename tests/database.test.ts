import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createHandler, hashToken, type Database } from '../supabase/functions/_shared/handler'
import { SupabaseChallengeApi } from '../src/services/supabaseChallengeApi'

const db = new PGlite()
type Result = {
  error?: string
  vote?: { authorshipGuess: string; helpfulnessPreference: string; helpfulnessReasons: string[] | null }
  complete?: boolean
  caseId: string
  title: string
  context: string
  feedbackA: string[]
  feedbackB: string[]
  humanFeedbackPosition: string
  totalCases: number
  results: {
    totalVotes: number
    authorship: { human: number; ai: number; unsure: number }
    helpfulness: { human: number; ai: number; equal: number }
  }
}
let tokenCounter = 0
let legacyVotes: unknown[] = []
const token = () => (++tokenCounter).toString(16).padStart(64, '0')

async function start(seen: string[] = [], position = 'A', hash = token()) {
  const { rows } = await db.query<{ result: Result }>(
    'select prebi_private.start_round($1::text[], $2, $3) as result',
    [seen, hash, position],
  )
  return { hash, result: rows[0].result }
}

// Omitting reasons exercises the legacy 4-argument entry point still used by older Edge deployments.
async function submit(
  hash: string, authorship = 'A', helpfulness = 'B', key = crypto.randomUUID(),
  reasons?: string[] | null,
) {
  const { rows } = reasons === undefined
    ? await db.query<{ result: Result }>(
      'select prebi_private.submit_vote($1, $2, $3, $4::uuid) as result',
      [hash, authorship, helpfulness, key],
    )
    : await db.query<{ result: Result }>(
      'select prebi_private.submit_vote($1, $2, $3, $4::uuid, $5::text[]) as result',
      [hash, authorship, helpfulness, key, reasons],
    )
  return rows[0].result
}

beforeAll(async () => {
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create role audit_reader;
    create role migration_admin login inherit createrole nosuperuser nobypassrls;
    grant anon, authenticated to migration_admin;
    do $$ begin
      execute format('grant create on database %I to migration_admin', current_database());
    end $$;
    grant usage, create on schema public to migration_admin;
    create table public.votes (
      id uuid, case_id text, human_position text, authorship_guess text,
      helpfulness_preference text, created_at timestamptz
    );
    insert into public.votes values (
      gen_random_uuid(), 'legacy-case', 'A', 'unsure', 'equal', now()
    );
    alter table public.votes owner to migration_admin;
    alter table public.votes enable row level security;
    grant select on public.votes to audit_reader, service_role;
    create policy legacy_audit_read on public.votes for select to audit_reader using (true);
  `)
  legacyVotes = (await db.query(`
    select id, case_id, human_position, authorship_guess, helpfulness_preference, created_at
    from public.votes order by id
  `)).rows
  await db.exec('set session authorization migration_admin')
  await db.exec(readFileSync('supabase/preflight.sql', 'utf8'))
  await db.exec(readFileSync('supabase/migrations/202610200001_private_challenge.sql', 'utf8'))
  await db.exec(readFileSync('supabase/migrations/202610210001_helpfulness_reasons.sql', 'utf8'))
  await db.exec(readFileSync('supabase/seed.sql', 'utf8'))
  await db.exec(`
    create role prebi_edge_login login inherit nosuperuser nocreatedb nocreaterole nobypassrls;
    grant prebi_edge to prebi_edge_login;
    set session authorization postgres;
  `)
}, 30_000)

beforeEach(async () => {
  await db.exec(`
    delete from public.votes where round_id is not null;
    delete from prebi_private.rounds;
    delete from prebi_private.request_budgets;
  `)
})
afterAll(async () => { await db.close() })

describe('versioned SQL migration and atomic voting', () => {
  it('preserves pre-existing votes and makes the fictional seed repeatable', async () => {
    const legacy = await db.query<{ count: number }>("select count(*)::int as count from public.votes where case_id = 'legacy-case'")
    expect(legacy.rows[0].count).toBe(1)
    expect((await db.query(`
      select id, case_id, human_position, authorship_guess, helpfulness_preference, created_at
      from public.votes order by id
    `)).rows).toEqual(legacyVotes)
    await db.exec(readFileSync('supabase/seed.sql', 'utf8'))
    const cases = await db.query<{ count: number }>('select count(*)::int as count from prebi_private.cases')
    expect(cases.rows[0].count).toBe(3)
  })

  it.each(['A', 'B'])('shuffles feedback with human in %s without leaking the answer', async (position) => {
    const { hash, result } = await start([], position)
    expect(Object.keys(result).sort()).toEqual([
      'caseId', 'complete', 'context', 'feedbackA', 'feedbackB', 'title', 'totalCases',
    ])
    expect(result.totalCases).toBe(3)
    const cases = await db.query<{ human_feedback: string[]; ai_feedback: string[] }>(
      'select human_feedback, ai_feedback from prebi_private.cases where id = $1', [result.caseId],
    )
    expect(result.feedbackA).toEqual(position === 'A' ? cases.rows[0].human_feedback : cases.rows[0].ai_feedback)
    expect(result.feedbackB).toEqual(position === 'B' ? cases.rows[0].human_feedback : cases.rows[0].ai_feedback)
    expect((await submit(hash)).humanFeedbackPosition).toBe(position)
  })

  it('selects only active unplayed cases and returns completion', async () => {
    const seen: string[] = []
    for (let i = 0; i < 3; i++) {
      const { result } = await start(seen)
      expect(seen).not.toContain(result.caseId)
      seen.push(result.caseId)
    }
    expect((await start(seen)).result).toEqual({ complete: true })
    await db.exec("update prebi_private.cases set active = false where id = 'seminar-gespraech'")
    expect((await start(['stundenbeginn', 'arbeitsauftrag'])).result).toEqual({ complete: true })
    await db.exec("update prebi_private.cases set active = true where id = 'seminar-gespraech'")
  })

  it('normalizes A/B for one case across independent browsers', async () => {
    const seen = ['stundenbeginn', 'arbeitsauftrag']
    const first = await start(seen, 'A')
    const second = await start(seen, 'B')
    const third = await start(seen, 'B')
    const fourth = await start(['seminar-gespraech', 'arbeitsauftrag'])
    await submit(first.hash, 'A', 'B')
    await submit(second.hash, 'A', 'B')
    const result = await submit(third.hash, 'unsure', 'equal')
    expect(result.results).toEqual({
      totalVotes: 3,
      authorship: { human: 1, ai: 1, unsure: 1 },
      helpfulness: { human: 1, ai: 1, equal: 1 },
    })
    expect((await submit(fourth.hash)).results.totalVotes).toBe(1)
  })

  it('counts concurrent identical submissions once and replays the same snapshot', async () => {
    const { hash } = await start()
    const key = crypto.randomUUID()
    const results = await Promise.all(Array.from({ length: 8 }, () => submit(hash, 'A', 'B', key)))
    for (const result of results) expect(result).toEqual(results[0])
    expect(results[0].results.totalVotes).toBe(1)
    const others = await start([], 'B')
    await submit(others.hash)
    await db.query("update prebi_private.rounds set expires_at = now() - interval '1 minute' where token_hash = $1", [hash])
    expect(await submit(hash, 'A', 'B', key)).toEqual(results[0])
    expect(await submit(hash, 'B', 'B', key)).toEqual({ error: 'ALREADY_SUBMITTED' })
    expect(await submit(hash)).toEqual({ error: 'ALREADY_SUBMITTED' })
  })

  it('enforces idempotency uniqueness across rounds', async () => {
    const first = await start()
    const second = await start()
    const key = crypto.randomUUID()
    await submit(first.hash, 'A', 'B', key)
    expect(await submit(second.hash, 'A', 'B', key)).toEqual({ error: 'IDEMPOTENCY_CONFLICT' })
    expect((await submit(second.hash)).results.totalVotes).toBeGreaterThanOrEqual(1)
  })

  it('accepts only one of two competing submissions for the same round', async () => {
    const { hash } = await start()
    const results = await Promise.all([
      submit(hash, 'A', 'A'), submit(hash, 'B', 'B'),
    ])
    expect(results.filter((result) => !result.error)).toHaveLength(1)
    expect(results.filter((result) => result.error === 'ALREADY_SUBMITTED')).toHaveLength(1)
    const saved = await db.query<{ count: number }>(
      'select count(*)::int as count from public.votes where round_id is not null',
    )
    expect(saved.rows[0].count).toBe(1)
  })

  it('rejects expired and unknown rounds without inserting votes', async () => {
    const { hash } = await start()
    await db.query("update prebi_private.rounds set expires_at = now() - interval '1 second' where token_hash = $1", [hash])
    expect(await submit(hash)).toEqual({ error: 'ROUND_EXPIRED' })
    expect(await submit(token())).toEqual({ error: 'ROUND_INVALID' })
    const votes = await db.query<{ count: number }>('select count(*)::int as count from public.votes where round_id is not null')
    expect(votes.rows[0].count).toBe(0)
  })

  it('validates SQL inputs and returns zero-count aggregates', async () => {
    expect((await start(Array.from({ length: 101 }, () => 'case'))).result).toEqual({ error: 'INVALID_INPUT' })
    const { hash, result } = await start()
    expect(await submit(hash, 'human')).toEqual({ error: 'INVALID_INPUT' })
    const counts = await db.query<{ result: Result['results'] }>(
      'select prebi_private.case_results($1) as result', [result.caseId],
    )
    expect(counts.rows[0].result.totalVotes).toBe(0)
  })

  it('stores optional fixed reasons canonically and keeps legacy and old-client votes unasked', async () => {
    const reasoned = await start()
    const key = crypto.randomUUID()
    const result = await submit(reasoned.hash, 'A', 'B', key, ['encouraging', 'concrete'])
    expect(result.vote).toEqual({
      authorshipGuess: 'A', helpfulnessPreference: 'B', helpfulnessReasons: ['concrete', 'encouraging'],
    })
    expect(await submit(reasoned.hash, 'A', 'B', key, ['concrete', 'encouraging'])).toEqual(result)
    expect(await submit(reasoned.hash, 'A', 'B', key, ['concrete'])).toEqual({ error: 'ALREADY_SUBMITTED' })
    expect(await submit(reasoned.hash, 'A', 'B', key)).toEqual({ error: 'ALREADY_SUBMITTED' })

    const none = await start()
    expect((await submit(none.hash, 'unsure', 'equal', crypto.randomUUID(), [])).vote?.helpfulnessReasons).toEqual([])
    const old = await start()
    expect((await submit(old.hash, 'A', 'A')).vote?.helpfulnessReasons).toBeNull()

    const stored = await db.query<{ reasons: string[] | null }>(`
      select helpfulness_reasons as reasons from public.votes order by round_id is null, created_at
    `)
    expect(stored.rows.map((row) => row.reasons)).toEqual([['concrete', 'encouraging'], [], null, null])
  })

  it.each([
    [['free text']], [['clear', 'clear']], [[null]], [Array(6).fill('clear')],
  ])('rejects invalid reasons %j without inserting a vote', async (reasons) => {
    const { hash } = await start()
    expect(await submit(hash, 'A', 'B', crypto.randomUUID(), reasons as string[])).toEqual({ error: 'INVALID_INPUT' })
    const { hash: equalHash } = await start()
    expect(await submit(equalHash, 'A', 'equal', crypto.randomUUID(), ['clear'])).toEqual({ error: 'INVALID_INPUT' })
    expect((await db.query('select 1 from public.votes where round_id is not null')).rows).toHaveLength(0)
    await expect(db.query(
      "insert into public.votes(case_id, human_position, authorship_guess, helpfulness_preference, helpfulness_reasons) values ('x', 'A', 'A', 'equal', array['clear'])",
    )).rejects.toThrow(/prebi_vote_helpfulness_reasons/)
  })

  it('enforces global request budgets without collecting visitor identifiers', async () => {
    await db.exec("insert into prebi_private.request_budgets values ('start', date_trunc('minute', now()), 120)")
    expect((await start()).result).toEqual({ error: 'RATE_LIMITED' })
  })

  it('denies browser roles and grants the Edge role only the two entry points', async () => {
    for (const role of ['anon', 'authenticated', 'prebi_edge', 'prebi_edge_login']) {
      await db.exec(`set role ${role}`)
      try {
        for (const table of ['public.votes', 'prebi_private.cases', 'prebi_private.rounds']) {
          await expect(db.query(`select * from ${table}`)).rejects.toThrow(/permission denied/)
          await expect(db.query(`insert into ${table} default values`)).rejects.toThrow(/permission denied/)
        }
        await expect(db.query("select prebi_private.case_results('seminar-gespraech')")).rejects.toThrow(/permission denied/)
        if (role === 'anon' || role === 'authenticated') {
          await expect(start()).rejects.toThrow(/permission denied/)
          await expect(submit(token())).rejects.toThrow(/permission denied/)
          await expect(submit(token(), 'A', 'B', crypto.randomUUID(), [])).rejects.toThrow(/permission denied/)
        } else {
          const round = await start()
          expect(round.result.caseId).toBeTruthy()
          expect((await submit(round.hash)).error).toBeUndefined()
          const reasoned = await start()
          expect((await submit(reasoned.hash, 'A', 'B', crypto.randomUUID(), ['clear'])).error).toBeUndefined()
        }
      } finally {
        await db.exec('reset role')
      }
    }
  })

  it('preserves the existing votes owner, administrative grants and unrelated policies', async () => {
    const { rows } = await db.query<{ owner: string; service_read: boolean; audit_read: boolean }>(`
      select pg_get_userbyid(relowner) as owner,
        has_table_privilege('service_role', oid, 'select') as service_read,
        has_table_privilege('audit_reader', oid, 'select') as audit_read
      from pg_class where oid = 'public.votes'::regclass
    `)
    expect(rows[0]).toEqual({ owner: 'migration_admin', service_read: true, audit_read: true })
    const policies = await db.query("select 1 from pg_policies where policyname = 'legacy_audit_read'")
    expect(policies.rows).toHaveLength(1)
  })

  it('sets definer ownership, fixed search paths and RLS without browser EXECUTE', async () => {
    const routines = await db.query<{ name: string; owner: string; definer: boolean; config: string[]; anon: boolean; authenticated: boolean }>(`
      select p.proname as name, pg_get_userbyid(p.proowner) as owner,
        p.prosecdef as definer, p.proconfig as config,
        has_function_privilege('anon', p.oid, 'execute') as anon,
        has_function_privilege('authenticated', p.oid, 'execute') as authenticated
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'prebi_private'
    `)
    expect(routines.rows).toHaveLength(5)
    for (const row of routines.rows) {
      expect(row.owner).toBe('prebi_owner')
      expect(row.config).toEqual(['search_path=pg_catalog'])
      expect(row.definer).toBe(['start_round', 'submit_vote'].includes(row.name))
      expect(row.anon).toBe(false)
      expect(row.authenticated).toBe(false)
    }
    const tables = await db.query<{ owner: string; rls: boolean; force: boolean }>(`
      select pg_get_userbyid(relowner) as owner, relrowsecurity as rls, relforcerowsecurity as force
      from pg_class where relnamespace = 'prebi_private'::regnamespace and relkind = 'r'
    `)
    expect(tables.rows).toHaveLength(3)
    for (const table of tables.rows) {
      expect(table).toEqual({ owner: 'prebi_owner', rls: true, force: false })
    }
  })

  it('runs the rollback-only hosted role probe with the provisioned login', async () => {
    const probe = readFileSync('supabase/verify-execution.sql', 'utf8')
    const blocks = [...probe.matchAll(/do \$\$([\s\S]*?)end \$\$;/gi)]
    for (const [, block] of blocks) {
      expect(block).not.toMatch(/\b(?:set(?:\s+local)?|reset)\s+role\b/i)
    }
    for (const role of ['anon', 'authenticated', 'prebi_edge_login']) {
      expect(probe).toMatch(new RegExp(`set local role ${role};\\s*do \\$\\$`, 'i'))
    }
    const membershipsBefore = (await db.query(`
      select roleid, member, grantor, admin_option, inherit_option, set_option
      from pg_auth_members order by roleid, member, grantor
    `)).rows
    await db.exec('set session authorization migration_admin')
    try {
      await db.exec(readFileSync('supabase/verify.sql', 'utf8'))
      await db.exec(probe)
    } finally {
      await db.exec('rollback; set session authorization postgres')
    }
    expect((await db.query('select * from public.votes where round_id is not null')).rows).toHaveLength(0)
    expect((await db.query('select * from prebi_private.rounds')).rows).toHaveLength(0)
    expect((await db.query('select * from prebi_private.request_budgets')).rows).toHaveLength(0)
    expect((await db.query("select * from prebi_private.cases where id like 'privilege-probe-%'")).rows).toHaveLength(0)
    expect((await db.query(`
      select roleid, member, grantor, admin_option, inherit_option, set_option
      from pg_auth_members order by roleid, member, grantor
    `)).rows).toEqual(membershipsBefore)
  })

  it('refuses existing role names before changing objects or permissions', async () => {
    try {
      await expect(db.exec(readFileSync('supabase/migrations/202610200001_private_challenge.sql', 'utf8')))
        .rejects.toThrow(/prebi roles already exist/)
    } finally {
      await db.exec('rollback')
    }
    expect((await db.query('select * from public.votes')).rows).toHaveLength(1)
    expect((await db.query('select * from prebi_private.cases')).rows).toHaveLength(3)
  })
})

describe('HTTP handlers using the real migrated PostgreSQL routines', () => {
  const origin = 'http://localhost:5173'
  const database: Database = {
    async start(seen, hash, position) { return (await start(seen, position, hash)).result },
    async submit(input, hash) {
      return submit(hash, input.authorshipGuess, input.helpfulnessPreference, input.idempotencyKey,
        input.helpfulnessReasons)
    },
  }
  const options = { database, allowedOrigins: [origin], publishableKey: 'sb_publishable_test' }
  const startHandler = createHandler('start', options)
  const submitHandler = createHandler('submit', options)
  function request(body: unknown) {
    return new Request('http://localhost/functions/v1/test', {
      method: 'POST',
      headers: { Origin: origin, apikey: options.publishableKey, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  }

  it('starts and submits without exposing token hashes or private metadata', async () => {
    const response = await startHandler(request({ playedCaseIds: [] }))
    const round = await response.json()
    expect(response.headers.get('access-control-allow-origin')).toBe(origin)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(round.roundToken).toMatch(/^[0-9a-f]{64}$/)
    expect(round.humanFeedbackPosition).toBeUndefined()
    expect(round.revealNote).toBeUndefined()
    const stored = await db.query<{ token_hash: string }>('select token_hash from prebi_private.rounds')
    expect(stored.rows[0].token_hash).toBe(await hashToken(round.roundToken))
    expect(stored.rows[0].token_hash).not.toBe(round.roundToken)
    const payload = { roundToken: round.roundToken, authorshipGuess: 'unsure', helpfulnessPreference: 'equal', idempotencyKey: crypto.randomUUID() }
    const responses = await Promise.all([submitHandler(request(payload)), submitHandler(request(payload))])
    expect(await responses[0].json()).toEqual(await responses[1].json())
  })

  it('shares normalized aggregates across browser adapters and recovers a committed lost response', async () => {
    let loseResponse = true
    const fetcher: typeof fetch = async (input, init) => {
      const req = new Request(input, init)
      req.headers.set('origin', origin)
      const isSubmit = req.url.endsWith('/submit-vote')
      const response = await (isSubmit ? submitHandler : startHandler)(req)
      if (isSubmit && loseResponse) {
        loseResponse = false
        throw new TypeError('Simulated lost response after commit')
      }
      return response
    }
    const first = new SupabaseChallengeApi('https://example.supabase.co', options.publishableKey, fetcher)
    const second = new SupabaseChallengeApi('https://example.supabase.co', options.publishableKey, fetcher)
    const seen = ['stundenbeginn', 'arbeitsauftrag']
    const one = await first.startRound(seen)
    const two = await second.startRound(seen)
    if (!one || !two) throw new Error('Expected two rounds of the same case')
    expect(one.caseId).toBe(two.caseId)
    const vote = { authorshipGuess: 'unsure', helpfulnessPreference: 'equal' } as const
    await expect(first.submitVote(one.id, vote)).rejects.toThrow(/Verbindung/)
    const saved = await first.submitVote(one.id, vote)
    expect(saved.results.totalVotes).toBe(1)
    expect((await second.submitVote(two.id, vote)).results.totalVotes).toBe(2)
    expect((await first.submitVote(one.id, vote)).results.totalVotes).toBe(1)
    const three = await first.startRound([])
    if (!three) throw new Error('Expected a third round')
    const reasoned = await first.submitVote(three.id, {
      authorshipGuess: 'A', helpfulnessPreference: 'B', helpfulnessReasons: ['clear', 'personal'],
    })
    expect(reasoned.vote.helpfulnessReasons).toEqual(['personal', 'clear'])
  })
})
