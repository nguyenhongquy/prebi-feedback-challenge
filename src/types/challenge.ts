export type FeedbackChoice = 'A' | 'B'
export type AuthorshipGuess = FeedbackChoice | 'unsure'
export type HelpfulnessPreference = FeedbackChoice | 'equal'
export type FeedbackSource = 'human' | 'ai'

export interface SyntheticCase {
  id: string
  title: string
  context: string
  humanFeedback: string[]
  aiFeedback: string[]
  revealNote: string
  discussionPrompt: string
  demoResults: {
    authorship: {
      human: number
      ai: number
      unsure: number
    }
    helpfulness: {
      human: number
      ai: number
      equal: number
    }
    totalVotes: number
  }
}

export interface ChallengeRound {
  id: string
  caseId: string
  title: string
  context: string
  feedbackA: string[]
  feedbackB: string[]
  revealNote: string
  discussionPrompt: string
}

export interface Vote {
  authorshipGuess: AuthorshipGuess
  helpfulnessPreference: HelpfulnessPreference
}

export interface VoteDraft {
  authorshipGuess?: AuthorshipGuess
  helpfulnessPreference?: HelpfulnessPreference
}

export function isVoteComplete(vote: VoteDraft | null): vote is Vote {
  return (
    vote?.authorshipGuess !== undefined &&
    vote.helpfulnessPreference !== undefined
  )
}

export interface DemoResults {
  authorship: {
    human: number
    ai: number
    unsure: number
  }
  helpfulness: {
    human: number
    ai: number
    equal: number
  }
  totalVotes: number
}

export interface RoundResult {
  roundId: string
  humanFeedbackPosition: FeedbackChoice
  vote: Vote
  results: DemoResults
  isDemo: true
}

export interface ChallengeApi {
  startRound(playedCaseIds: string[]): Promise<ChallengeRound | null>
  submitVote(roundId: string, vote: Vote): Promise<RoundResult>
}
