import { syntheticCases } from '../data/syntheticCases'
import type {
  ChallengeApi,
  ChallengeRound,
  FeedbackChoice,
  RoundResult,
  Vote,
} from '../types/challenge'

interface RoundRecord {
  caseId: string
  humanFeedbackPosition: FeedbackChoice
  submitted: boolean
}

export class MockChallengeApi implements ChallengeApi {
  private readonly rounds = new Map<string, RoundRecord>()
  private nextRoundNumber = 1
  private readonly random: () => number

  constructor(random: () => number = Math.random) {
    this.random = random
  }

  async startRound(playedCaseIds: string[]): Promise<ChallengeRound | null> {
    const availableCases = syntheticCases.filter(
      (reflectionCase) => !playedCaseIds.includes(reflectionCase.id),
    )

    if (availableCases.length === 0) return null

    const selectedCase =
      availableCases[Math.floor(this.random() * availableCases.length)]
    const humanFeedbackPosition: FeedbackChoice =
      this.random() < 0.5 ? 'A' : 'B'
    const roundId = `demo-round-${this.nextRoundNumber++}`
    const feedbackA =
      humanFeedbackPosition === 'A'
        ? selectedCase.humanFeedback
        : selectedCase.aiFeedback
    const feedbackB =
      humanFeedbackPosition === 'B'
        ? selectedCase.humanFeedback
        : selectedCase.aiFeedback

    this.rounds.set(roundId, {
      caseId: selectedCase.id,
      humanFeedbackPosition,
      submitted: false,
    })

    return {
      id: roundId,
      caseId: selectedCase.id,
      title: selectedCase.title,
      context: selectedCase.context,
      feedbackA,
      feedbackB,
      totalCases: syntheticCases.length,
    }
  }

  async submitVote(roundId: string, vote: Vote): Promise<RoundResult> {
    const record = this.rounds.get(roundId)

    if (!record) {
      throw new Error('Diese Runde ist nicht mehr verfügbar. Starte bitte eine neue Runde.')
    }
    if (record.submitted) {
      throw new Error('Für diese Runde wurde bereits abgestimmt.')
    }

    const reflectionCase = syntheticCases.find(
      (candidate) => candidate.id === record.caseId,
    )
    if (!reflectionCase) {
      throw new Error('Der Fall für diese Runde konnte nicht gefunden werden.')
    }

    record.submitted = true

    return {
      roundId,
      humanFeedbackPosition: record.humanFeedbackPosition,
      vote,
      results: structuredClone(reflectionCase.demoResults),
      revealNote: reflectionCase.revealNote,
      discussionPrompt: reflectionCase.discussionPrompt,
      isDemo: true,
    }
  }

  reset() {
    this.rounds.clear()
  }
}

export const mockChallengeApi = new MockChallengeApi()
