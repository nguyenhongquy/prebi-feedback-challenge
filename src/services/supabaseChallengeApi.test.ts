import { describe, expect, it, vi } from 'vitest'
import { SupabaseChallengeApi } from './supabaseChallengeApi'

const roundToken = 'a'.repeat(64)
const vote = { authorshipGuess: 'unsure', helpfulnessPreference: 'equal' } as const
const round = {
  complete: false, roundToken, caseId: 'fictional-case', title: 'Ein fiktiver Fall',
  context: 'Ein vollständig erfundener Kontext.', feedbackA: ['Rückmeldung A'],
  feedbackB: ['Rückmeldung B'], totalCases: 3,
}
const result = {
  humanFeedbackPosition: 'B', vote,
  revealNote: 'Ein fiktiver Vergleich.', discussionPrompt: 'Was hilft dir?',
  results: {
    totalVotes: 1,
    authorship: { human: 0, ai: 0, unsure: 1 },
    helpfulness: { human: 0, ai: 0, equal: 1 },
  }, isDemo: false,
}
const config = ['https://example.supabase.co', 'sb_publishable_test'] as const

describe('Supabase production adapter', () => {
  it('calls public Edge Functions, not the Data API or a JWT authorization header', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json(round))
    const api = new SupabaseChallengeApi(...config, fetcher)
    const response = await api.startRound(['previous-case'])
    expect(response).toEqual({
      id: roundToken, caseId: round.caseId, title: round.title, context: round.context,
      feedbackA: round.feedbackA, feedbackB: round.feedbackB, totalCases: 3,
    })
    expect(fetcher).toHaveBeenCalledWith('https://example.supabase.co/functions/v1/start-round',
      expect.objectContaining({
        body: JSON.stringify({ playedCaseIds: ['previous-case'] }),
        headers: { apikey: config[1], 'Content-Type': 'application/json' },
        credentials: 'omit',
      }))
  })
  it('returns completion explicitly', async () => {
    const api = new SupabaseChallengeApi(...config, vi.fn<typeof fetch>().mockResolvedValue(Response.json({ complete: true })))
    await expect(api.startRound([])).resolves.toBeNull()
  })
  it('reuses the exact idempotency key after a lost response and checks the result', async () => {
    const fetcher = vi.fn<typeof fetch>()
      .mockRejectedValueOnce(new TypeError('Network interrupted'))
      .mockResolvedValue(Response.json(result))
    const api = new SupabaseChallengeApi(...config, fetcher)
    await expect(api.submitVote(roundToken, vote)).rejects.toMatchObject({ code: 'NETWORK' })
    const saved = await api.submitVote(roundToken, vote)
    expect(fetcher.mock.calls[0][1]?.body).toBe(fetcher.mock.calls[1][1]?.body)
    expect(saved).toEqual({ ...result, roundId: roundToken })
  })
  it('does not silently change choices on a possibly saved request', async () => {
    const fetcher = vi.fn<typeof fetch>().mockRejectedValue(new TypeError('Network interrupted'))
    const api = new SupabaseChallengeApi(...config, fetcher)
    await expect(api.submitVote(roundToken, vote)).rejects.toThrow()
    await expect(api.submitVote(roundToken, { ...vote, authorshipGuess: 'A' })).rejects.toMatchObject({ code: 'RETRY_CHOICES' })
    expect(fetcher).toHaveBeenCalledTimes(1)
  })
  it('clears per-round keys only for the current adapter on reset', async () => {
    const firstFetch = vi.fn<typeof fetch>().mockImplementation(async () => Response.json(result))
    const secondFetch = vi.fn<typeof fetch>().mockImplementation(async () => Response.json(result))
    const first = new SupabaseChallengeApi(...config, firstFetch)
    const second = new SupabaseChallengeApi(...config, secondFetch)
    await first.submitVote(roundToken, vote)
    await second.submitVote(roundToken, vote)
    first.reset()
    await first.submitVote(roundToken, vote)
    await second.submitVote(roundToken, vote)
    expect(firstFetch.mock.calls[0][1]?.body).not.toBe(firstFetch.mock.calls[1][1]?.body)
    expect(secondFetch.mock.calls[0][1]?.body).toBe(secondFetch.mock.calls[1][1]?.body)
  })
  it.each(['ROUND_EXPIRED', 'ALREADY_SUBMITTED', 'INVALID_INPUT', 'RATE_LIMITED'])(
    'surfaces %s without demo fallback', async (code) => {
      const api = new SupabaseChallengeApi(...config,
        vi.fn<typeof fetch>().mockResolvedValue(Response.json({ error: { code } }, { status: 400 })))
      await expect(api.submitVote(roundToken, vote)).rejects.toMatchObject({ code })
    },
  )
  it.each([
    { ...result, isDemo: true },
    { ...result, humanFeedbackPosition: 'human' },
    { ...result, results: { ...result.results, totalVotes: 10 } },
    { ...result, vote: { ...vote, authorshipGuess: 'A' } },
  ])('rejects malformed or mismatched results', async (body) => {
    const api = new SupabaseChallengeApi(...config,
      vi.fn<typeof fetch>().mockResolvedValue(Response.json(body)))
    await expect(api.submitVote(roundToken, vote)).rejects.toMatchObject({ code: 'INVALID_RESPONSE' })
  })
  it('rejects credentials and unsafe browser URLs', () => {
    expect(() => new SupabaseChallengeApi(config[0], 'sb_secret_private')).toThrow()
    expect(() => new SupabaseChallengeApi('http://example.com', config[1])).toThrow()
    expect(() => new SupabaseChallengeApi('https://user:password@example.com', config[1])).toThrow()
  })
})
