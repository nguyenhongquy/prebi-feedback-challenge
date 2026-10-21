export type FeedbackChoice = 'A' | 'B'
export type AuthorshipGuess = FeedbackChoice | 'unsure'
export type HelpfulnessPreference = FeedbackChoice | 'equal'
export type FeedbackSource = 'human' | 'ai'
export type HelpfulnessReason =
  | 'concrete' | 'personal' | 'precise' | 'clear' | 'encouraging' | 'honest' | 'concise'

export const maxHelpfulnessReasons = 3

// Order is canonical: the backend stores and echoes reasons in this order.
// `label` compares one feedback with the other; `equalLabel` describes both.
export const helpfulnessReasonOptions: { value: HelpfulnessReason; label: string; equalLabel: string }[] = [
  { value: 'concrete', label: 'konkreter', equalLabel: 'konkret' },
  { value: 'personal', label: 'persönlicher', equalLabel: 'persönlich' },
  { value: 'precise', label: 'fachlich genauer', equalLabel: 'fachlich genau' },
  { value: 'clear', label: 'klarer formuliert', equalLabel: 'klar formuliert' },
  { value: 'encouraging', label: 'ermutigender', equalLabel: 'ermutigend' },
  { value: 'honest', label: 'benennt Schwächen ehrlicher', equalLabel: 'benennen Schwächen ehrlich' },
  { value: 'concise', label: 'kürzer, auf den Punkt', equalLabel: 'kurz und auf den Punkt' },
]

export function reasonLabels(vote: Pick<Vote, 'helpfulnessPreference' | 'helpfulnessReasons'>): string[] {
  return helpfulnessReasonOptions
    .filter((option) => vote.helpfulnessReasons?.includes(option.value))
    .map((option) => vote.helpfulnessPreference === 'equal' ? option.equalLabel : option.label)
}

export function normalizeReasons(reasons: readonly HelpfulnessReason[] | undefined): HelpfulnessReason[] {
  return helpfulnessReasonOptions
    .map((option) => option.value)
    .filter((value) => reasons?.includes(value))
}

export class ChallengeApiError extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = 'ChallengeApiError'
    this.code = code
  }
}

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
  totalCases: number
}

export interface Vote {
  authorshipGuess: AuthorshipGuess
  helpfulnessPreference: HelpfulnessPreference
  helpfulnessReasons?: HelpfulnessReason[]
}

export interface VoteDraft {
  authorshipGuess?: AuthorshipGuess
  helpfulnessPreference?: HelpfulnessPreference
  helpfulnessReasons?: HelpfulnessReason[]
}

export function isVoteComplete(vote: VoteDraft | null): vote is Vote {
  return (
    vote?.authorshipGuess !== undefined &&
    vote.helpfulnessPreference !== undefined
  )
}

export interface AggregateResults {
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
  results: AggregateResults
  revealNote: string
  discussionPrompt: string
  isDemo: boolean
}

export interface ChallengeApi {
  startRound(playedCaseIds: string[]): Promise<ChallengeRound | null>
  submitVote(roundId: string, vote: Vote): Promise<RoundResult>
  reset?(): void
}
