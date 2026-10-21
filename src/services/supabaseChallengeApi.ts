import type {
  AggregateResults, ChallengeApi, ChallengeRound, RoundResult, Vote,
} from '../types/challenge'
import { ChallengeApiError, normalizeReasons } from '../types/challenge'

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function strings(value: unknown): value is string[] {
  return Array.isArray(value) && value.length > 0
    && value.every((entry) => typeof entry === 'string' && entry.length > 0)
}

function count(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

function aggregates(value: unknown): value is AggregateResults {
  if (!object(value) || !count(value.totalVotes) || !object(value.authorship) || !object(value.helpfulness)) return false
  const a = value.authorship
  const h = value.helpfulness
  return count(a.human) && count(a.ai) && count(a.unsure)
    && count(h.human) && count(h.ai) && count(h.equal)
    && a.human + a.ai + a.unsure === value.totalVotes
    && h.human + h.ai + h.equal === value.totalVotes
}

function invalidResponse(): never {
  throw new ChallengeApiError('INVALID_RESPONSE', 'Die Serverantwort ist ungültig. Bitte versuche es erneut.')
}

export class SupabaseChallengeApi implements ChallengeApi {
  private readonly endpoint: string
  private readonly publishableKey: string
  private readonly fetcher: typeof fetch
  private readonly submissions = new Map<string, { key: string; vote: Vote }>()

  constructor(url: string, publishableKey: string, fetcher: typeof fetch = fetch) {
    let parsed: URL
    try { parsed = new URL(url) }
    catch { throw new ChallengeApiError('CONFIGURATION', 'Die Supabase-URL fehlt oder ist ungültig.') }
    if ((parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(parsed.hostname)))
      || parsed.username || parsed.password || parsed.search || parsed.hash
      || parsed.pathname !== '/' || !publishableKey.startsWith('sb_publishable_')) {
      throw new ChallengeApiError('CONFIGURATION', 'Bitte prüfe die öffentliche Supabase-Konfiguration. Geheime Schlüssel sind im Browser nicht erlaubt.')
    }
    this.endpoint = `${parsed.origin}/functions/v1`
    this.publishableKey = publishableKey
    this.fetcher = fetcher
  }

  private async request(functionName: string, input: unknown): Promise<unknown> {
    let response: Response
    try {
      const fetcher = this.fetcher
      response = await fetcher(`${this.endpoint}/${functionName}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: this.publishableKey },
        credentials: 'omit',
        cache: 'no-store',
        body: JSON.stringify(input),
        signal: AbortSignal.timeout(15_000),
      })
    } catch {
      throw new ChallengeApiError('NETWORK', 'Die Verbindung zur Abstimmung ist unterbrochen. Bitte versuche es mit denselben Antworten erneut. Es werden keine Demodaten eingesetzt.')
    }
    let payload: unknown
    try { payload = await response.json() }
    catch {
      throw new ChallengeApiError('BACKEND_UNAVAILABLE', 'Die Abstimmung ist gerade nicht erreichbar. Bitte versuche es erneut.')
    }
    if (!response.ok) {
      const messages: Record<string, string> = {
        ROUND_EXPIRED: 'Diese Runde ist abgelaufen. Starte bitte eine neue Runde.',
        ROUND_INVALID: 'Diese Runde ist nicht mehr verfügbar. Starte bitte eine neue Runde.',
        ALREADY_SUBMITTED: 'Für diese Runde wurde bereits mit anderen Angaben abgestimmt.',
        IDEMPOTENCY_CONFLICT: 'Die Anfrage gehört zu einer anderen Runde. Starte bitte eine neue Runde.',
        INVALID_INPUT: 'Bitte prüfe deine Angaben und versuche es erneut.',
        RATE_LIMITED: 'Im Moment gibt es zu viele Anfragen. Bitte warte eine Minute und versuche es erneut.',
      }
      const code = object(payload) && object(payload.error) && typeof payload.error.code === 'string'
        ? payload.error.code : 'BACKEND_UNAVAILABLE'
      throw new ChallengeApiError(code, messages[code] ?? 'Die Abstimmung ist gerade nicht erreichbar. Bitte versuche es erneut. Es werden keine Demodaten eingesetzt.')
    }
    return payload
  }

  async startRound(playedCaseIds: string[]): Promise<ChallengeRound | null> {
    const payload = await this.request('start-round', { playedCaseIds })
    if (!object(payload)) return invalidResponse()
    if (payload.complete === true) return null
    if (payload.complete !== false
      || typeof payload.roundToken !== 'string' || !/^[0-9a-f]{64}$/.test(payload.roundToken)
      || typeof payload.caseId !== 'string' || !/^[a-z0-9-]{1,80}$/.test(payload.caseId)
      || typeof payload.title !== 'string' || typeof payload.context !== 'string'
      || !strings(payload.feedbackA) || !strings(payload.feedbackB)
      || !count(payload.totalCases) || payload.totalCases < 1) return invalidResponse()
    return {
      id: payload.roundToken, caseId: payload.caseId, title: payload.title,
      context: payload.context, feedbackA: payload.feedbackA, feedbackB: payload.feedbackB,
      totalCases: payload.totalCases,
    }
  }

  async submitVote(roundId: string, vote: Vote): Promise<RoundResult> {
    let submission = this.submissions.get(roundId)
    const reasons = normalizeReasons(vote.helpfulnessReasons)
    const normalized: Vote = { ...vote, helpfulnessReasons: reasons }
    if (!submission) {
      submission = { key: crypto.randomUUID(), vote: normalized }
      this.submissions.set(roundId, submission)
    }
    if (vote.authorshipGuess !== submission.vote.authorshipGuess
      || vote.helpfulnessPreference !== submission.vote.helpfulnessPreference
      || reasons.join() !== submission.vote.helpfulnessReasons?.join()) {
      throw new ChallengeApiError('RETRY_CHOICES', 'Die vorherige Anfrage könnte bereits gespeichert sein. Bitte wiederhole sie mit denselben Antworten.')
    }
    const payload = await this.request('submit-vote', {
      roundToken: roundId,
      authorshipGuess: submission.vote.authorshipGuess,
      helpfulnessPreference: submission.vote.helpfulnessPreference,
      helpfulnessReasons: reasons,
      idempotencyKey: submission.key,
    })
    if (!object(payload) || (payload.humanFeedbackPosition !== 'A' && payload.humanFeedbackPosition !== 'B')
      || payload.isDemo !== false || !object(payload.vote)
      || payload.vote.authorshipGuess !== vote.authorshipGuess
      || payload.vote.helpfulnessPreference !== vote.helpfulnessPreference
      || !Array.isArray(payload.vote.helpfulnessReasons)
      || payload.vote.helpfulnessReasons.join() !== reasons.join()
      || !aggregates(payload.results)
      || typeof payload.revealNote !== 'string' || typeof payload.discussionPrompt !== 'string') return invalidResponse()
    return {
      roundId, humanFeedbackPosition: payload.humanFeedbackPosition,
      vote: normalized, results: payload.results, isDemo: false,
      revealNote: payload.revealNote, discussionPrompt: payload.discussionPrompt,
    }
  }

  reset() {
    this.submissions.clear()
  }
}
