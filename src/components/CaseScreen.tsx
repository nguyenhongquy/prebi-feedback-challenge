import { syntheticCaseCount } from '../data/syntheticCases'
import type { ChallengeRound, VoteDraft } from '../types/challenge'
import { FeedbackCard } from './FeedbackCard'
import { VoteForm } from './VoteForm'

interface CaseScreenProps {
  caseNumber: number
  isSubmitting: boolean
  onSubmit: () => void
  onVoteChange: (vote: VoteDraft) => void
  round: ChallengeRound
  vote: VoteDraft | null
}

export function CaseScreen({
  caseNumber,
  isSubmitting,
  onSubmit,
  onVoteChange,
  round,
  vote,
}: CaseScreenProps) {
  return (
    <section className="case-screen page-section">
      <div className="step-label">
        <span>DEINE RUNDE</span>
        <span className="step-count">Fall {caseNumber} <span aria-hidden="true">/</span> {syntheticCaseCount}</span>
      </div>

      <div className="case-intro">
        <p className="eyebrow">Die Reflexion</p>
        <h1>{round.title}</h1>
        <div className="context-card">
          <span aria-hidden="true" className="context-mark">“</span>
          <p>{round.context}</p>
        </div>
      </div>

      <div className="feedback-heading">
        <div>
          <p className="eyebrow">Zwei Perspektiven</p>
          <h2>Lies beide Rückmeldungen in Ruhe.</h2>
        </div>
        <span className="no-timer">Kein Zeitlimit</span>
      </div>

      <div className="feedback-grid">
        <FeedbackCard label="A" paragraphs={round.feedbackA} />
        <FeedbackCard label="B" paragraphs={round.feedbackB} />
      </div>

      <div className="vote-section">
        <div className="vote-heading">
          <p className="eyebrow">Deine Einschätzung</p>
          <h2>Was denkst du?</h2>
        </div>
        <VoteForm
          isSubmitting={isSubmitting}
          onSubmit={onSubmit}
          onVoteChange={onVoteChange}
          vote={vote}
        />
      </div>
    </section>
  )
}
