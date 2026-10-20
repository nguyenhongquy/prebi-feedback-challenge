import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { MockChallengeApi } from '../services/mockChallengeApi'
import type { Vote, VoteDraft } from '../types/challenge'
import { CaseScreen } from './CaseScreen'
import { ResultsBars } from './ResultsBars'
import { ResultsScreen } from './ResultsScreen'
import { RevealScreen } from './RevealScreen'
import { VoteForm } from './VoteForm'

const noop = () => {}

function renderVoteForm(vote: VoteDraft | null, isSubmitting = false) {
  return renderToStaticMarkup(
    <VoteForm
      isSubmitting={isSubmitting}
      onSubmit={noop}
      onVoteChange={noop}
      vote={vote}
    />,
  )
}

describe('voting interface', () => {
  it.each([null, { authorshipGuess: 'A' }, { helpfulnessPreference: 'equal' }] as const)(
    'disables submission for incomplete answers: %j',
    (vote) => {
      expect(renderVoteForm(vote)).toMatch(/<button[^>]*disabled=""/)
    },
  )

  it('accepts uncertainty and equal helpfulness as explicit answers', () => {
    const markup = renderVoteForm({
      authorshipGuess: 'unsure',
      helpfulnessPreference: 'equal',
    })
    expect(markup).not.toMatch(/<button[^>]*disabled=""/)
    expect(markup).toContain('aria-describedby="vote-instructions"')
    expect(markup).toContain('Bitte beantworte beide Fragen.')
    expect(markup).toContain('welche Rückmeldung hilfreicher ist, entscheidest du.')
  })

  it('announces submission and locks both questions without clearing answers', () => {
    const markup = renderVoteForm({
      authorshipGuess: 'B',
      helpfulnessPreference: 'A',
    }, true)
    expect(markup).toContain('aria-busy="true"')
    expect(markup).toContain('Wird ausgewertet')
    expect(markup).toContain('role="status"')
    expect(markup.match(/<fieldset[^>]*disabled=""/g)).toHaveLength(2)
    expect(markup.match(/checked=""/g)).toHaveLength(2)
    expect(markup).toMatch(/<button[^>]*disabled=""/)
  })
})

describe('challenge screens', () => {
  it('links to focusable feedback cards without removing any case text', async () => {
    const api = new MockChallengeApi(() => 0)
    const round = await api.startRound([])
    if (!round) throw new Error('Expected a synthetic round')
    const markup = renderToStaticMarkup(
      <CaseScreen
        caseNumber={1}
        isSubmitting={false}
        onSubmit={noop}
        onVoteChange={noop}
        round={round}
        vote={null}
      />,
    )
    for (const label of ['A', 'B']) {
      expect(markup).toContain(`href="#feedback-card-${label}"`)
      expect(markup).toContain(`id="feedback-card-${label}" tabindex="-1"`)
    }
    expect(markup).toContain(round.context)
    for (const paragraph of [...round.feedbackA, ...round.feedbackB]) {
      expect(markup).toContain(paragraph)
    }
  })

  it.each([0, 0.9])('reveals both sources and participant choices for order %s', async (random) => {
    const api = new MockChallengeApi(() => random)
    const round = await api.startRound([])
    if (!round) throw new Error('Expected a synthetic round')
    const vote: Vote = { authorshipGuess: 'unsure', helpfulnessPreference: 'B' }
    const result = await api.submitVote(round.id, vote)
    const markup = renderToStaticMarkup(
      <RevealScreen onContinue={noop} result={result} round={round} vote={vote} />,
    )
    expect(markup).toContain(`Menschlich verfasst</p><h2>Feedback ${result.humanFeedbackPosition}`)
    expect(markup).toContain('Ich war unsicher')
    expect(markup).toContain('Hilfreicher gefunden')
    expect(markup).toContain('Feedback B ·')
    expect(markup).toContain('Deine Präferenz ist keine richtige oder falsche Antwort.')
  })

  it('keeps demo labels, numeric results, and both next actions', async () => {
    const api = new MockChallengeApi(() => 0)
    const round = await api.startRound([])
    if (!round) throw new Error('Expected a synthetic round')
    const result = await api.submitVote(round.id, {
      authorshipGuess: 'A',
      helpfulnessPreference: 'equal',
    })
    const markup = renderToStaticMarkup(
      <ResultsScreen onFinish={noop} onNextRound={noop} result={result} />,
    )
    expect(markup).toContain('Demodaten')
    expect(markup).toContain('keine echten Stimmen gespeichert')
    expect(markup).toContain('Kleine Stichprobe')
    expect(markup).toContain('13 von 27, 48 Prozent')
    expect(markup).toContain('Noch eine Runde?')
    expect(markup).toContain('Fertig')
  })

  it('renders empty chart counts without invalid percentages', () => {
    const markup = renderToStaticMarkup(
      <ResultsBars
        bars={[{ label: 'Unsicher', count: 0 }]}
        description="Noch keine Antworten"
        title="Demodaten"
        total={0}
      />,
    )
    expect(markup).toContain('0 von 0, 0 Prozent')
    expect(markup).not.toContain('NaN')
  })
})
