import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createHandler, hashToken, type Database } from '../supabase/functions/_shared/handler'
import { SupabaseChallengeApi } from '../src/services/supabaseChallengeApi'

const db = new PGlite()
type Result = {
  error?: string
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
const token = () => (++tokenCounter).toString(16).padStart(64, '0')

async function start(seen: string[] = [], position = 'A', hash = token()) {
  const { rows } = await db.query<{ result: Result }>(
    'select prebi_private.start_round($1::text[], $2, $3) as result',
    [seen, hash, position],
  )
  return { hash, result: rows[0].result }
}

async function submit(hash: string, authorship = 'A', helpfulness = 'B', key = crypto.randomUUID()) {
  const { rows } = await db.query<{ result: Result }>(
    'select prebi_private.submit_vote($1, $2, $3, $4::uuid) as result',
    [hash, authorship, helpfulness, key],
  )
  return rows[0].result
}

beforeAll(async () => {
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create table public.votes (
      id uuid, case_id text, human_position text, authorship_guess text,
      helpfulness_preference text, created_at timestamptz
    );
    insert into public.votes values (
      gen_random_uuid(), 'legacy-case', 'A', 'unsure', 'equal', now()
    );
  `)
  await db.exec(readFileSync('supabase/migrations/202610200001_private_challenge.sql', 'utf8'))
  await db.exec(readFileSync('supabase/seed.sql', 'utf8'))
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

  it('enforces global request budgets without collecting visitor identifiers', async () => {
    await db.exec("insert into prebi_private.request_budgets values ('start', date_trunc('minute', now()), 120)")
    expect((await start()).result).toEqual({ error: 'RATE_LIMITED' })
  })

  it('denies browser roles and grants the Edge role only the two entry points', async () => {
    for (const role of ['anon', 'authenticated', 'service_role', 'prebi_edge']) {
      await db.exec(`set role ${role}`)
      await expect(db.query('select * from public.votes')).rejects.toThrow(/permission denied/)
      await expect(db.query('select * from prebi_private.cases')).rejects.toThrow(/permission denied/)
      await db.exec('reset role')
    }
    await db.exec('set role prebi_edge')
    await expect(db.query("select prebi_private.case_results('seminar-gespraech')")).rejects.toThrow(/permission denied/)
    const round = await start()
    expect(round.result.caseId).toBeTruthy()
    expect((await submit(round.hash)).results.totalVotes).toBe(1)
    await db.exec('reset role')
  })
})

describe('HTTP handlers using the real migrated PostgreSQL routines', () => {
  const origin = 'http://localhost:5173'
  const database: Database = {
    async start(seen, hash, position) { return (await start(seen, position, hash)).result },
    async submit(input, hash) {
      return submit(hash, input.authorshipGuess, input.helpfulnessPreference, input.idempotencyKey)
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
  })
})
