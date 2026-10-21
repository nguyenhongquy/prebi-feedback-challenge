import { describe, expect, it, vi } from 'vitest'
import { createHandler, type Database } from '../supabase/functions/_shared/handler'

const origin = 'http://localhost:5173'
function setup() {
  const database: Database = {
    start: vi.fn(async () => ({ complete: true })),
    submit: vi.fn(async () => ({ error: 'ROUND_EXPIRED' })),
  }
  return {
    database,
    start: createHandler('start', { allowedOrigins: [origin], publishableKey: 'public-test', database }),
    submit: createHandler('submit', { allowedOrigins: [origin], publishableKey: 'public-test', database }),
  }
}
function request(body: unknown, headers: Record<string, string> = {}, method = 'POST') {
  return new Request('https://example.supabase.co/functions/v1/test', {
    method, headers: { Origin: origin, apikey: 'public-test', 'Content-Type': 'application/json', ...headers },
    body: method === 'POST' ? JSON.stringify(body) : undefined,
  })
}
describe('public Edge request boundary', () => {
  it('restricts origins, permits preflight, and rejects unsupported methods or keys', async () => {
    const { start, database } = setup()
    const forbidden = await start(request({}, { Origin: 'https://evil.example' }))
    expect(forbidden.status).toBe(403)
    expect(forbidden.headers.has('access-control-allow-origin')).toBe(false)
    expect((await start(request({}, {}, 'OPTIONS'))).status).toBe(204)
    expect((await start(request({}, {}, 'GET'))).status).toBe(405)
    expect((await start(request({}, { apikey: 'wrong' }))).status).toBe(401)
    expect((await start(request({}, { 'Content-Type': 'text/plain' }))).status).toBe(415)
    expect(database.start).not.toHaveBeenCalled()
  })
  it.each([
    {}, { playedCaseIds: [null] }, { playedCaseIds: ['../case'] },
    { playedCaseIds: Array(101).fill('case') }, { playedCaseIds: [], human_position: 'A' },
  ])('rejects invalid start input %j', async (body) => {
    const { start, database } = setup()
    expect((await start(request(body))).status).toBe(400)
    expect(database.start).not.toHaveBeenCalled()
  })
  it('bounds actual streamed body size, not only content-length', async () => {
    const { start } = setup()
    expect((await start(request({ playedCaseIds: ['x'.repeat(20_000)] }))).status).toBe(413)
  })
  it('rejects malformed JSON', async () => {
    const { start } = setup()
    const req = request({})
    expect((await start(new Request(req, { body: '{' }))).status).toBe(400)
  })
  it.each([
    {}, { roundToken: 'unsigned-answer-A' },
    { roundToken: 'a'.repeat(64), authorshipGuess: 'human', helpfulnessPreference: 'equal', idempotencyKey: crypto.randomUUID() },
    { roundToken: 'a'.repeat(64), authorshipGuess: 'A', helpfulnessPreference: 'equal', idempotencyKey: 'not-a-uuid' },
    ...[
      'clear', ['free text'], ['clear', 'clear'], [null], ['concrete', 'clear', 'honest', 'concise'],
    ].map((helpfulnessReasons) => ({
      roundToken: 'a'.repeat(64), authorshipGuess: 'A', helpfulnessPreference: 'B',
      helpfulnessReasons, idempotencyKey: crypto.randomUUID(),
    })),
    {
      roundToken: 'a'.repeat(64), authorshipGuess: 'A', helpfulnessPreference: 'B',
      helpfulnessReasons: [], comment: 'Freitext', idempotencyKey: crypto.randomUUID(),
    },
  ])('rejects invalid vote %j', async (body) => {
    const { submit, database } = setup()
    expect((await submit(request(body))).status).toBe(400)
    expect(database.submit).not.toHaveBeenCalled()
  })
  it.each([
    [undefined, null],
    [[], []],
    [['encouraging', 'concrete'], ['concrete', 'encouraging']],
    [['concise', 'honest', 'personal'], ['personal', 'honest', 'concise']],
  ])('passes optional reasons %j to the database as %j', async (given, expected) => {
    const { submit, database } = setup()
    const key = crypto.randomUUID()
    await submit(request({
      roundToken: 'c'.repeat(64), authorshipGuess: 'A', helpfulnessPreference: 'B',
      ...(given === undefined ? {} : { helpfulnessReasons: given }), idempotencyKey: key,
    }))
    expect(database.submit).toHaveBeenCalledWith({
      roundToken: 'c'.repeat(64), authorshipGuess: 'A', helpfulnessPreference: 'B',
      helpfulnessReasons: expected, idempotencyKey: key,
    }, expect.stringMatching(/^[0-9a-f]{64}$/))
  })
  it('strips private fields even if a database response accidentally includes them', async () => {
    const { start, database } = setup()
    vi.mocked(database.start).mockResolvedValue({
      complete: false, caseId: 'case', title: 'Fall', context: 'Fiktiv',
      feedbackA: ['A'], feedbackB: ['B'], totalCases: 1,
      humanFeedbackPosition: 'A', token_hash: 'secret', revealNote: 'not yet', active: true,
    })
    const body = await (await start(request({ playedCaseIds: [] }))).json()
    expect(Object.keys(body).sort()).toEqual([
      'caseId', 'complete', 'context', 'feedbackA', 'feedbackB', 'roundToken', 'title', 'totalCases',
    ])
  })
  it.each([
    ['ROUND_INVALID', 404], ['ROUND_EXPIRED', 410],
    ['ALREADY_SUBMITTED', 409], ['IDEMPOTENCY_CONFLICT', 409],
    ['RATE_LIMITED', 429], ['INVALID_INPUT', 400],
  ])('maps %s to HTTP %s', async (code, status) => {
    const { submit, database } = setup()
    vi.mocked(database.submit).mockResolvedValue({ error: code })
    const response = await submit(request({
      roundToken: 'b'.repeat(64), authorshipGuess: 'A',
      helpfulnessPreference: 'B', idempotencyKey: crypto.randomUUID(),
    }))
    expect(response.status).toBe(status)
    expect((await response.json()).error.code).toBe(code)
    if (code === 'RATE_LIMITED') expect(response.headers.get('retry-after')).toBe('60')
  })
  it('returns explicit unavailability without exposing database errors or using demo data', async () => {
    const { start, database } = setup()
    vi.mocked(database.start).mockRejectedValue(new Error('postgres://password-must-not-leak'))
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const response = await start(request({ playedCaseIds: [] }))
      expect(response.status).toBe(503)
      expect(await response.text()).not.toContain('password-must-not-leak')
      expect(log).toHaveBeenCalledWith('prebi start: database operation unavailable')
    } finally { log.mockRestore() }
  })
  it.each(['start', 'submit'] as const)('logs only a fixed production message for %s failures', async (action) => {
    const handlers = setup()
    const secret = 'postgres://private-user:private-password@private-host/private-db'
    vi.mocked(handlers.database[action]).mockRejectedValue(Object.assign(new Error(secret), {
      code: '42501', detail: secret, query: secret, parameters: [secret],
      certificate: secret, roundToken: secret,
    }))
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const body = action === 'start' ? { playedCaseIds: [] } : {
        roundToken: 'b'.repeat(64), authorshipGuess: 'A',
        helpfulnessPreference: 'B', idempotencyKey: crypto.randomUUID(),
      }
      const response = await handlers[action](request(body))
      expect(response.status).toBe(503)
      expect(await response.text()).not.toContain(secret)
      expect(log.mock.calls).toEqual([
        [`prebi ${action}: database operation unavailable`],
      ])
    } finally { log.mockRestore() }
  })
})
