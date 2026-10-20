interface CompletionScreenProps {
  onRestart: () => void
}

export function CompletionScreen({ onRestart }: CompletionScreenProps) {
  return (
    <section className="completion-screen page-section">
      <div className="completion-mark" aria-hidden="true">✳</div>
      <p className="eyebrow">Danke fürs Mitdenken</p>
      <h1>Das war’s<br /><span>für den Moment.</span></h1>
      <p className="completion-copy">
        Du hast alle verfügbaren Fälle angesehen. Nimm deine Gedanken gern mit
        in ein Gespräch über hilfreiches pädagogisches Feedback.
      </p>
      <button className="button button-primary" onClick={onRestart} type="button">
        Noch einmal von vorn <span aria-hidden="true">↺</span>
      </button>
    </section>
  )
}
