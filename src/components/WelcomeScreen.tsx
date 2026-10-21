interface WelcomeScreenProps {
  onStart: () => void
  playedRounds: number
  isDemo?: boolean
}

export function WelcomeScreen({ onStart, playedRounds, isDemo = true }: WelcomeScreenProps) {
  return (
    <section className="welcome-screen page-section">
      <div className="eyebrow"><span className="eyebrow-dot" /> Reflection Week · Mitmach-Experiment</div>
      <h1>Mensch oder KI?<br /><span>Feedback im Vergleich.</span></h1>
      <p className="welcome-lede">
        Zwei Rückmeldungen. Eine Reflexion. Was hilft beim Weiterdenken – und
        welche Antwort stammt von einem Menschen?
      </p>

      <div className="welcome-meta">
        <span><span aria-hidden="true">◷</span> Etwa 3–5 Minuten pro Runde</span>
        <span><span aria-hidden="true">✳</span> Ohne Anmeldung</span>
      </div>

      <button className="button button-primary button-large" onClick={onStart} type="button">
        {playedRounds > 0 ? 'Nächste Runde starten' : 'Mitmachen'}
        <span aria-hidden="true">→</span>
      </button>

      <aside className="privacy-note">
        <span aria-hidden="true" className="privacy-icon">i</span>
        <p>
          <strong>Gut zu wissen</strong>
          <br />
          {isDemo
            ? 'Alle Fälle sind frei erfunden. In diesem Prototyp werden nur Demodaten angezeigt – es werden keine persönlichen Daten erfasst.'
            : 'Die Fälle beruhen auf echten Reflexionen und Rückmeldungen, die anonymisiert, umformuliert und gekürzt wurden. Deine anonymen Antworten werden gespeichert und für diesen Fall zusammengezählt. Wir fragen keine Namen oder Kontaktdaten ab. Dein Fallfortschritt bleibt nur in diesem Browser-Tab.'}
        </p>
      </aside>

      <p className="purpose-note">
        Ein Gesprächsanstoß zur Qualität pädagogischen Feedbacks – kein
        wissenschaftlicher Test zur KI-Erkennung.
      </p>
    </section>
  )
}
