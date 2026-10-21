import type {
  AuthorshipGuess,
  HelpfulnessPreference,
  HelpfulnessReason,
  VoteDraft,
} from '../types/challenge'
import { helpfulnessReasonOptions, isVoteComplete, normalizeReasons } from '../types/challenge'

interface VoteFormProps {
  isSubmitting: boolean
  isUnavailable?: boolean
  onSubmit: () => void
  onVoteChange: (vote: VoteDraft) => void
  vote: VoteDraft | null
}

const authorshipOptions: { value: AuthorshipGuess; label: string }[] = [
  { value: 'A', label: 'Feedback A' },
  { value: 'B', label: 'Feedback B' },
  { value: 'unsure', label: 'Ich bin unsicher' },
]

const helpfulnessOptions: { value: HelpfulnessPreference; label: string }[] = [
  { value: 'A', label: 'Feedback A' },
  { value: 'B', label: 'Feedback B' },
  { value: 'equal', label: 'Beide etwa gleich' },
]

export function VoteForm({
  isSubmitting,
  isUnavailable = false,
  onSubmit,
  onVoteChange,
  vote,
}: VoteFormProps) {
  function updateAuthorshipGuess(value: AuthorshipGuess) {
    onVoteChange({ ...vote, authorshipGuess: value })
  }

  function updateHelpfulnessPreference(value: HelpfulnessPreference) {
    onVoteChange({
      ...vote,
      helpfulnessPreference: value,
      helpfulnessReasons: value === 'equal' ? [] : vote?.helpfulnessReasons,
    })
  }

  function toggleReason(value: HelpfulnessReason, checked: boolean) {
    const current = vote?.helpfulnessReasons ?? []
    onVoteChange({
      ...vote,
      helpfulnessReasons: normalizeReasons(
        checked ? [...current, value] : current.filter((reason) => reason !== value),
      ),
    })
  }

  const preferredFeedback =
    vote?.helpfulnessPreference === 'A' || vote?.helpfulnessPreference === 'B'
      ? vote.helpfulnessPreference
      : null

  const canSubmit = isVoteComplete(vote)

  return (
    <form
      aria-describedby="vote-instructions"
      className="vote-form"
      onSubmit={(event) => {
        event.preventDefault()
        if (canSubmit && !isSubmitting && !isUnavailable) onSubmit()
      }}
    >
      <fieldset className="vote-question" disabled={isSubmitting || isUnavailable}>
        <legend>
          <span className="question-number">1</span>
          Welches Feedback stammt von Lehrenden?
        </legend>
        <div className="option-row">
          {authorshipOptions.map((option) => (
            <label className="choice-option" key={option.value}>
              <input
                checked={vote?.authorshipGuess === option.value}
                name="authorship"
                onChange={() => updateAuthorshipGuess(option.value)}
                type="radio"
                value={option.value}
              />
              <span>{option.label}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset className="vote-question" disabled={isSubmitting || isUnavailable}>
        <legend>
          <span className="question-number">2</span>
          Welches Feedback findest du hilfreicher?
        </legend>
        <div className="option-row">
          {helpfulnessOptions.map((option) => (
            <label className="choice-option" key={option.value}>
              <input
                checked={vote?.helpfulnessPreference === option.value}
                name="helpfulness"
                onChange={() => updateHelpfulnessPreference(option.value)}
                type="radio"
                value={option.value}
              />
              <span>{option.label}</span>
            </label>
          ))}
        </div>
      </fieldset>

      {preferredFeedback && (
        <fieldset className="vote-question" disabled={isSubmitting || isUnavailable}>
          <legend>
            <span className="question-number">3</span>
            Was macht Feedback {preferredFeedback} für dich hilfreicher?
            <span className="optional-label"> (optional, Mehrfachauswahl)</span>
          </legend>
          <div className="option-row">
            {helpfulnessReasonOptions.map((option) => (
              <label className="choice-option" key={option.value}>
                <input
                  checked={vote?.helpfulnessReasons?.includes(option.value) ?? false}
                  name="helpfulness-reasons"
                  onChange={(event) => toggleReason(option.value, event.target.checked)}
                  type="checkbox"
                  value={option.value}
                />
                <span>{option.label}</span>
              </label>
            ))}
          </div>
        </fieldset>
      )}

      <button
        aria-busy={isSubmitting}
        className="button button-primary"
        disabled={!canSubmit || isSubmitting || isUnavailable}
        type="submit"
      >
        {isUnavailable ? 'Runde nicht verfügbar' : isSubmitting ? 'Wird ausgewertet …' : 'Antworten ansehen'}
        {!isSubmitting && !isUnavailable && <span aria-hidden="true">→</span>}
      </button>
      <p aria-live="polite" className="submission-status" role="status">
        {isSubmitting ? 'Deine Antworten werden ausgewertet. Bitte warte kurz.' : ''}
      </p>
      <p className="form-hint" id="vote-instructions">
        Bitte beantworte die ersten beiden Fragen; die Begründung ist freiwillig. Bei der Herkunft gibt es eine Auflösung –
        welche Rückmeldung hilfreicher ist, entscheidest du.
      </p>
    </form>
  )
}
