import type { ChallengeRound, FeedbackChoice, RoundResult, Vote } from '../types/challenge'

interface RevealScreenProps {
  onContinue: () => void
  result: RoundResult
  round: ChallengeRound
  vote: Vote
}

function labelForChoice(choice: FeedbackChoice): string {
  return `Feedback ${choice}`
}

export function RevealScreen({
  onContinue,
  result,
  round,
  vote,
}: RevealScreenProps) {
  const otherPosition = result.humanFeedbackPosition === 'A' ? 'B' : 'A'
  const guessedHumanPosition =
    vote.authorshipGuess === 'unsure' ? null : vote.authorshipGuess
  const guessedHumanSource =
    guessedHumanPosition === null
      ? null
      : guessedHumanPosition === result.humanFeedbackPosition
        ? 'das menschliche Feedback'
        : 'das KI-Feedback'
  const helpfulnessSource =
    vote.helpfulnessPreference === 'equal'
      ? 'Beide etwa gleich hilfreich'
      : vote.helpfulnessPreference === result.humanFeedbackPosition
        ? 'Das menschliche Feedback'
        : 'Das KI-Feedback'

  return (
    <section className="reveal-screen page-section">
      <div className="eyebrow"><span className="eyebrow-dot" /> Die Auflösung</div>
      <h1>Der Blick hinter<br /><span>die Rückmeldungen.</span></h1>

      <div className="reveal-answer" aria-live="polite">
        <div className="reveal-answer-icon" aria-hidden="true">✓</div>
        <div>
          <p className="eyebrow">Menschlich verfasst</p>
          <h2>{labelForChoice(result.humanFeedbackPosition)}</h2>
          <p>
            {labelForChoice(otherPosition)} wurde für dieses Beispiel unabhängig
            davon mit KI erstellt.
          </p>
        </div>
      </div>

      <div className="your-vote">
        <p className="eyebrow">Deine Antworten</p>
        <div className="your-vote-row">
          <span>Als menschlich eingeschätzt</span>
          <strong>
            {guessedHumanPosition
              ? `${labelForChoice(guessedHumanPosition)} · ${guessedHumanSource}`
              : 'Ich war unsicher'}
          </strong>
        </div>
        <div className="your-vote-row">
          <span>Hilfreicher gefunden</span>
          <strong>
            {vote.helpfulnessPreference === 'equal'
              ? helpfulnessSource
              : `${labelForChoice(vote.helpfulnessPreference)} · ${helpfulnessSource}`}
          </strong>
        </div>
      </div>

      <div className="editorial-note">
        <p className="eyebrow">Ein Gedanke zum Vergleich</p>
        <p>{round.revealNote}</p>
        <div className="discussion-prompt">
          <span aria-hidden="true">↗</span>
          <p>{round.discussionPrompt}</p>
        </div>
      </div>

      <button className="button button-primary" onClick={onContinue} type="button">
        Demodaten ansehen <span aria-hidden="true">→</span>
      </button>
      <p className="subtle-note">Deine Präferenz ist keine richtige oder falsche Antwort.</p>
    </section>
  )
}
