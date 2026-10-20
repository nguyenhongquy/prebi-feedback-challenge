import { describe, expect, it } from 'vitest'
import { MockChallengeApi } from './mockChallengeApi'
import {
  loadPlayedCaseIds,
  resetSessionProgress,
  savePlayedCaseIds,
  type SessionStorageLike,
} from './sessionProgress'
import type { Vote } from '../types/challenge'
import { isVoteComplete } from '../types/challenge'

function sequenceRandom(...values: number[]) {
  let index = 0
  return () => values[index++] ?? 0
}

const sampleVote: Vote = {
  authorshipGuess: 'B',
  helpfulnessPreference: 'A',
}

describe('vote validation', () => {
  it('requires both answers before enabling submission', () => {
    expect(isVoteComplete(null)).toBe(false)
    expect(isVoteComplete({ authorshipGuess: 'A' })).toBe(false)
    expect(isVoteComplete({ helpfulnessPreference: 'equal' })).toBe(false)
    expect(
      isVoteComplete({
        authorshipGuess: 'unsure',
        helpfulnessPreference: 'equal',
      }),
    ).toBe(true)
  })
})

describe('MockChallengeApi', () => {
  it('randomizes feedback order and reveals the correct source position', async () => {
    const api = new MockChallengeApi(sequenceRandom(0.1, 0.2))
    const round = await api.startRound([])

    expect(round).not.toBeNull()
    if (!round) throw new Error('Expected a round to be available')

    expect(round.feedbackA).toEqual(
      expect.arrayContaining(['Du nimmst gut wahr, dass du eigene Gedanken hattest und dich trotzdem zurückgezogen hast. Was genau hat dir in dem Moment geholfen, deine Gedanken zu sortieren?']),
    )
    const result = await api.submitVote(round.id, sampleVote)
    expect(result.humanFeedbackPosition).toBe('A')
    expect(result.vote).toEqual(sampleVote)
    expect(result.results.totalVotes).toBe(27)
    expect(result.isDemo).toBe(true)
  })

  it('can place human feedback in B on another independently randomized round', async () => {
    const api = new MockChallengeApi(sequenceRandom(0.1, 0.8))
    const round = await api.startRound([])

    expect(round).not.toBeNull()
    if (!round) throw new Error('Expected a round to be available')

    const result = await api.submitVote(round.id, sampleVote)
    expect(result.humanFeedbackPosition).toBe('B')
    expect(round.feedbackB).toContain(
      'Du nimmst gut wahr, dass du eigene Gedanken hattest und dich trotzdem zurückgezogen hast. Was genau hat dir in dem Moment geholfen, deine Gedanken zu sortieren?',
    )
  })

  it('does not repeat a case before all cases have been played', async () => {
    const api = new MockChallengeApi(() => 0)
    const playedCaseIds: string[] = []

    for (let index = 0; index < 3; index += 1) {
      const round = await api.startRound(playedCaseIds)
      expect(round).not.toBeNull()
      if (!round) throw new Error('Expected another unplayed case')
      expect(playedCaseIds).not.toContain(round.caseId)
      playedCaseIds.push(round.caseId)
    }

    expect(new Set(playedCaseIds).size).toBe(3)
    await expect(api.startRound(playedCaseIds)).resolves.toBeNull()
  })

  it('rejects a second vote in the same round', async () => {
    const api = new MockChallengeApi(() => 0)
    const round = await api.startRound([])
    if (!round) throw new Error('Expected a round to be available')

    await api.submitVote(round.id, sampleVote)
    await expect(api.submitVote(round.id, sampleVote)).rejects.toThrow(
      'Für diese Runde wurde bereits abgestimmt.',
    )
  })
})

describe('session progress', () => {
  it('does not clear progress in another browser session', () => {
    function createStorage(): SessionStorageLike {
      const values = new Map<string, string>()
      return {
        getItem: (key) => values.get(key) ?? null,
        setItem: (key, value) => { values.set(key, value) },
        removeItem: (key) => { values.delete(key) },
      }
    }
    const firstSession = createStorage()
    const secondSession = createStorage()
    savePlayedCaseIds(firstSession, ['seminar-gespraech'])
    savePlayedCaseIds(secondSession, ['stundenbeginn'])

    resetSessionProgress(firstSession)

    expect(loadPlayedCaseIds(firstSession)).toEqual([])
    expect(loadPlayedCaseIds(secondSession)).toEqual(['stundenbeginn'])
  })

  it('clears the current visitor progress on reset', () => {
    const values = new Map<string, string>()
    const storage: SessionStorageLike = {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, value),
      removeItem: (key) => values.delete(key),
    }

    savePlayedCaseIds(storage, ['seminar-gespraech', 'stundenbeginn'])
    expect(loadPlayedCaseIds(storage)).toEqual([
      'seminar-gespraech',
      'stundenbeginn',
    ])

    resetSessionProgress(storage)
    expect(loadPlayedCaseIds(storage)).toEqual([])
  })
})
