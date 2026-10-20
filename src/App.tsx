import { useEffect, useRef, useState } from 'react'
import { CaseScreen } from './components/CaseScreen'
import { CompletionScreen } from './components/CompletionScreen'
import { ResultsScreen } from './components/ResultsScreen'
import { RevealScreen } from './components/RevealScreen'
import { WelcomeScreen } from './components/WelcomeScreen'
import { challengeApi, isDemoMode } from './services/challengeApi'
import logoUrl from './assets/brand/ph-ludwigsburg-logo.png'
import {
  loadPlayedCaseIds,
  resetSessionProgress,
  savePlayedCaseIds,
} from './services/sessionProgress'
import type {
  ChallengeRound,
  RoundResult,
  VoteDraft,
} from './types/challenge'
import { ChallengeApiError, isVoteComplete } from './types/challenge'
import './styles.css'

type Screen = 'welcome' | 'case' | 'reveal' | 'results' | 'complete'

function App() {
  const [screen, setScreen] = useState<Screen>('welcome')
  const [playedCaseIds, setPlayedCaseIds] = useState<string[]>(() =>
    loadPlayedCaseIds(window.sessionStorage),
  )
  const [round, setRound] = useState<ChallengeRound | null>(null)
  const [vote, setVote] = useState<VoteDraft | null>(null)
  const [result, setResult] = useState<RoundResult | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [roundUnavailable, setRoundUnavailable] = useState(false)
  const mainRef = useRef<HTMLElement>(null)
  const errorRef = useRef<HTMLDivElement>(null)
  const requestVersion = useRef(0)
  const submissionPending = useRef(false)

  useEffect(() => {
    if (isLoading) return
    const heading = mainRef.current?.querySelector('h1')
    if (heading) {
      heading.tabIndex = -1
      heading.focus({ preventScroll: true })
      window.scrollTo({ top: 0, behavior: 'instant' })
    }
  }, [screen, isLoading, round?.id])

  useEffect(() => {
    if (error) errorRef.current?.focus()
  }, [error])

  async function beginRound() {
    const version = ++requestVersion.current
    setIsLoading(true)
    setError(null)

    try {
      const nextRound = await challengeApi.startRound(playedCaseIds)
      if (version !== requestVersion.current) return

      if (!nextRound) {
        setScreen('complete')
        setRound(null)
        return
      }

      const nextPlayedCaseIds = [...playedCaseIds, nextRound.caseId]
      savePlayedCaseIds(window.sessionStorage, nextPlayedCaseIds)
      setPlayedCaseIds(nextPlayedCaseIds)
      setRound(nextRound)
      setRoundUnavailable(false)
      setVote(null)
      setResult(null)
      setScreen('case')
    } catch (cause) {
      if (version !== requestVersion.current) return
      setError(
        cause instanceof Error
          ? cause.message
          : 'Die Runde konnte nicht gestartet werden. Bitte versuche es erneut.',
      )
    } finally {
      if (version === requestVersion.current) setIsLoading(false)
    }
  }

  async function submitVote() {
    if (!round || !isVoteComplete(vote) || submissionPending.current || result || roundUnavailable) return

    const version = ++requestVersion.current
    submissionPending.current = true
    setIsSubmitting(true)
    setError(null)

    try {
      const submittedResult = await challengeApi.submitVote(round.id, vote)
      if (version !== requestVersion.current) return
      setResult(submittedResult)
      setScreen('reveal')
    } catch (cause) {
      if (version !== requestVersion.current) return
      if (cause instanceof ChallengeApiError
        && ['ROUND_EXPIRED', 'ROUND_INVALID', 'ALREADY_SUBMITTED', 'IDEMPOTENCY_CONFLICT'].includes(cause.code)) {
        setRoundUnavailable(true)
      }
      setError(
        cause instanceof Error
          ? cause.message
          : 'Deine Antworten konnten nicht übermittelt werden. Bitte versuche es erneut.',
      )
    } finally {
      if (version === requestVersion.current) {
        submissionPending.current = false
        setIsSubmitting(false)
      }
    }
  }

  function resetVisitor() {
    resetSessionProgress(window.sessionStorage)
    challengeApi.reset?.()
    requestVersion.current += 1
    submissionPending.current = false
    setIsLoading(false)
    setIsSubmitting(false)
    setPlayedCaseIds([])
    setRound(null)
    setVote(null)
    setResult(null)
    setError(null)
    setRoundUnavailable(false)
    setScreen('welcome')
  }

  return (
    <div className="app-shell">
      <header className="site-header">
        <div className="wordmark">
          <span className="wordmark-kicker">PH LUDWIGSBURG</span>
          <span className="wordmark-title">Reflection Week</span>
        </div>
        {(screen !== 'welcome' || playedCaseIds.length > 0) && (
          <button
            className="button button-quiet reset-button"
            onClick={resetVisitor}
            type="button"
          >
            <span aria-hidden="true">↺</span> Neue Person / Zurücksetzen
          </button>
        )}
      </header>

      <main id="main-content" ref={mainRef}>
        {error && (
          <div className="error-banner" ref={errorRef} role="alert" tabIndex={-1}>
            <span>{error}</span>
            {roundUnavailable && (
              <button className="button button-primary" onClick={beginRound} type="button">
                Neue Runde starten
              </button>
            )}
            {!roundUnavailable && (
              <button
                className="text-button"
                onClick={() => {
                  setError(null)
                  mainRef.current?.querySelector<HTMLButtonElement>(
                    screen === 'case' ? '.vote-form button[type="submit"]' : '.button-primary',
                  )?.focus()
                }}
                type="button"
              >
                Schließen
              </button>
            )}
          </div>
        )}

        {isLoading ? (
          <section aria-live="polite" className="loading-state">
            <span aria-hidden="true" className="loading-spinner" />
            <p>Eine neue Runde wird vorbereitet …</p>
          </section>
        ) : (
          <>
            {screen === 'welcome' && (
              <WelcomeScreen
                onStart={beginRound}
                playedRounds={playedCaseIds.length}
                isDemo={isDemoMode}
              />
            )}
            {screen === 'case' && round && (
              <CaseScreen
                caseNumber={playedCaseIds.length}
                isSubmitting={isSubmitting}
                isRoundUnavailable={roundUnavailable}
                onSubmit={submitVote}
                round={round}
                vote={vote}
                onVoteChange={setVote}
              />
            )}
            {screen === 'reveal' && round && isVoteComplete(vote) && result && (
              <RevealScreen
                onContinue={() => setScreen('results')}
                result={result}
                vote={vote}
              />
            )}
            {screen === 'results' && round && result && (
              <ResultsScreen
                onFinish={() => setScreen('complete')}
                onNextRound={beginRound}
                result={result}
              />
            )}
            {screen === 'complete' && (
              <CompletionScreen onRestart={resetVisitor} />
            )}
          </>
        )}
      </main>

      <footer className="site-footer">
        <img
          alt="Pädagogische Hochschule Ludwigsburg – University of Education"
          className="institution-logo"
          height="65"
          src={logoUrl}
          width="162"
        />
        <div className="footer-copy">
          <span>Ein Gesprächsanstoß – kein KI-Erkennungstest.</span>
          <span>Alle Fälle sind frei erfunden.</span>
        </div>
      </footer>
    </div>
  )
}

export default App
