import type { RoundResult } from '../types/challenge'
import { ResultsBars } from './ResultsBars'

interface ResultsScreenProps {
  onFinish: () => void
  onNextRound: () => void
  result: RoundResult
}

export function ResultsScreen({
  onFinish,
  onNextRound,
  result,
}: ResultsScreenProps) {
  const { authorship, helpfulness, totalVotes } = result.results
  const isSmallSample = totalVotes < 30

  return (
    <section className="results-screen page-section">
      <div className="eyebrow"><span className="eyebrow-dot" /> Ergebnisse zu diesem Fall</div>
      <div className="results-title-row">
        <div>
          <h1>Wie haben andere<br /><span>den Fall erlebt?</span></h1>
          <p className="results-total">
            <strong>{totalVotes}</strong> simulierte Antworten zu diesem Fall
          </p>
        </div>
        <span className="demo-badge">Demodaten</span>
      </div>

      {isSmallSample && (
        <p className="sample-note" role="note">
          Kleine Stichprobe: Diese Werte sind nur zur Demonstration gedacht und
          erlauben keine belastbaren Aussagen.
        </p>
      )}

      {result.isDemo && (
        <p className="demo-disclaimer">
          <span aria-hidden="true">ⓘ</span>
          Simulierte Werte – es wurden keine echten Stimmen gespeichert.
        </p>
      )}

      {totalVotes === 0 && (
        <p className="sample-note" role="status">
          Für diesen Fall liegen noch keine Antworten vor. Die Diagramme zeigen
          deshalb aktuell keine Stimmen.
        </p>
      )}

      <div className="results-grid">
        <ResultsBars
          bars={[
            { label: 'Menschliches Feedback gewählt', count: authorship.human },
            { label: 'KI-Feedback gewählt', count: authorship.ai },
            { label: 'Unsicher', count: authorship.unsure },
          ]}
          description="Welcher Text wurde als menschlich eingeschätzt?"
          title="Mensch oder KI?"
          total={totalVotes}
        />
        <ResultsBars
          bars={[
            { label: 'Menschliches Feedback', count: helpfulness.human },
            { label: 'KI-Feedback', count: helpfulness.ai },
            { label: 'Beide etwa gleich', count: helpfulness.equal },
          ]}
          description="Welcher Text wurde hilfreicher gefunden?"
          title="Was war hilfreicher?"
          total={totalVotes}
        />
      </div>

      <div className="results-actions">
        <button className="button button-primary" onClick={onNextRound} type="button">
          Noch eine Runde? <span aria-hidden="true">→</span>
        </button>
        <button className="button button-secondary" onClick={onFinish} type="button">
          Fertig
        </button>
      </div>
      <p className="subtle-note">Die Balken zeigen Anteile und Zahlen – nicht die Qualität der Antworten.</p>
    </section>
  )
}
