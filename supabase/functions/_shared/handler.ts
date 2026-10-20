import { logDatabaseFailure } from './databaseDiagnostics.ts'

export type Action = 'start' | 'submit'

export interface VoteInput {
  roundToken: string
  authorshipGuess: 'A' | 'B' | 'unsure'
  helpfulnessPreference: 'A' | 'B' | 'equal'
  idempotencyKey: string
}

export interface Database {
  start(seen: string[], tokenHash: string, humanPosition: 'A' | 'B'): Promise<unknown>
  submit(input: VoteInput, tokenHash: string): Promise<unknown>
}

interface HandlerOptions {
  allowedOrigins: string[]
  publishableKey: string
  database: Database
}

const errorMessages: Record<string, { status: number; message: string }> = {
  INVALID_INPUT: { status: 400, message: 'Bitte prüfe die Angaben für diese Runde.' },
  ROUND_INVALID: { status: 404, message: 'Diese Runde ist nicht mehr verfügbar. Starte bitte eine neue Runde.' },
  ROUND_EXPIRED: { status: 410, message: 'Diese Runde ist abgelaufen. Starte bitte eine neue Runde.' },
  ALREADY_SUBMITTED: { status: 409, message: 'Für diese Runde wurde bereits mit anderen Angaben abgestimmt.' },
  IDEMPOTENCY_CONFLICT: { status: 409, message: 'Diese Anfrage wurde bereits für eine andere Runde verwendet.' },
  RATE_LIMITED: { status: 429, message: 'Im Moment gibt es zu viele Anfragen. Bitte warte eine Minute und versuche es erneut.' },
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function exactKeys(value: Record<string, unknown>, keys: string[]) {
  return Object.keys(value).length === keys.length && keys.every((key) => key in value)
}

export async function hashToken(token: string): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

function randomToken(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(32)), (byte) =>
    byte.toString(16).padStart(2, '0')).join('')
}

async function readBody(request: Request): Promise<unknown> {
  const length = request.headers.get('content-length')
  if (length && (!/^\d+$/.test(length) || Number(length) > 16_384)) {
    throw new Error('BODY_TOO_LARGE')
  }
  const reader = request.body?.getReader()
  if (!reader) throw new Error('INVALID_JSON')
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > 16_384) {
        await reader.cancel()
        throw new Error('BODY_TOO_LARGE')
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }
  const body = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    body.set(chunk, offset)
    offset += chunk.length
  }
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(body))
}

export function createHandler(action: Action, options: HandlerOptions) {
  const origins = new Set(options.allowedOrigins)
  return async (request: Request): Promise<Response> => {
    const origin = request.headers.get('origin')
    const headers = new Headers({
      'Cache-Control': 'no-store',
      'Content-Type': 'application/json; charset=utf-8',
      'Vary': 'Origin',
      'X-Content-Type-Options': 'nosniff',
    })
    const respond = (body: unknown, status = 200) =>
      new Response(JSON.stringify(body), { status, headers })
    const fail = (code: string, message: string, status: number) =>
      respond({ error: { code, message } }, status)

    // Origin is a browser restriction, not authentication or a one-person/one-vote control.
    if (!origin || !origins.has(origin)) {
      return fail('ORIGIN_FORBIDDEN', 'Diese Herkunft ist für die Abstimmung nicht freigegeben.', 403)
    }
    headers.set('Access-Control-Allow-Origin', origin)
    headers.set('Access-Control-Allow-Methods', 'POST, OPTIONS')
    headers.set('Access-Control-Allow-Headers', 'content-type, apikey')
    headers.set('Access-Control-Max-Age', '600')
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers })
    if (request.method !== 'POST') {
      headers.set('Allow', 'POST, OPTIONS')
      return fail('METHOD_NOT_ALLOWED', 'Diese Anfrage wird nicht unterstützt.', 405)
    }
    if (!options.publishableKey || request.headers.get('apikey') !== options.publishableKey) {
      return fail('KEY_INVALID', 'Die öffentliche Projektkonfiguration ist ungültig.', 401)
    }
    if (request.headers.get('content-type')?.split(';')[0].trim() !== 'application/json') {
      return fail('INVALID_INPUT', 'Bitte sende die Angaben als JSON.', 415)
    }

    let body: unknown
    try {
      body = await readBody(request)
    } catch (cause) {
      const tooLarge = cause instanceof Error && cause.message === 'BODY_TOO_LARGE'
      return fail(tooLarge ? 'BODY_TOO_LARGE' : 'INVALID_INPUT',
        tooLarge ? 'Die Anfrage ist zu groß.' : 'Die Angaben konnten nicht gelesen werden.',
        tooLarge ? 413 : 400)
    }
    if (!isObject(body)) return fail('INVALID_INPUT', errorMessages.INVALID_INPUT.message, 400)

    try {
      let result: unknown
      let token: string | undefined
      if (action === 'start') {
        if (!exactKeys(body, ['playedCaseIds']) || !Array.isArray(body.playedCaseIds)
          || body.playedCaseIds.length > 100
          || !body.playedCaseIds.every((id): id is string =>
            typeof id === 'string' && /^[a-z0-9-]{1,80}$/.test(id))) {
          return fail('INVALID_INPUT', errorMessages.INVALID_INPUT.message, 400)
        }
        token = randomToken()
        const humanPosition = crypto.getRandomValues(new Uint8Array(1))[0] < 128 ? 'A' : 'B'
        result = await options.database.start(
          [...new Set(body.playedCaseIds)], await hashToken(token), humanPosition,
        )
      } else {
        if (!exactKeys(body, ['roundToken', 'authorshipGuess', 'helpfulnessPreference', 'idempotencyKey'])
          || typeof body.roundToken !== 'string' || !/^[0-9a-f]{64}$/.test(body.roundToken)
          || (body.authorshipGuess !== 'A' && body.authorshipGuess !== 'B' && body.authorshipGuess !== 'unsure')
          || (body.helpfulnessPreference !== 'A' && body.helpfulnessPreference !== 'B' && body.helpfulnessPreference !== 'equal')
          || typeof body.idempotencyKey !== 'string'
          || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.idempotencyKey)) {
          return fail('INVALID_INPUT', errorMessages.INVALID_INPUT.message, 400)
        }
        result = await options.database.submit({
          roundToken: body.roundToken,
          authorshipGuess: body.authorshipGuess,
          helpfulnessPreference: body.helpfulnessPreference,
          idempotencyKey: body.idempotencyKey,
        }, await hashToken(body.roundToken))
      }
      if (!isObject(result)) throw new Error('Unexpected database result')
      if (typeof result.error === 'string') {
        const definition = errorMessages[result.error]
        if (!definition) throw new Error('Unexpected database error code')
        if (result.error === 'RATE_LIMITED') headers.set('Retry-After', '60')
        return fail(result.error, definition.message, definition.status)
      }
      if (action === 'start') {
        if (result.complete === true) return respond({ complete: true })
        // Explicit allowlist: never spread a private case/round record into the response.
        return respond({
          complete: false, roundToken: token,
          caseId: result.caseId, title: result.title, context: result.context,
          feedbackA: result.feedbackA, feedbackB: result.feedbackB, totalCases: result.totalCases,
        })
      }
      return respond({
        humanFeedbackPosition: result.humanFeedbackPosition,
        vote: result.vote, results: result.results, isDemo: false,
        revealNote: result.revealNote, discussionPrompt: result.discussionPrompt,
      })
    } catch {
      logDatabaseFailure(action)
      return fail('BACKEND_UNAVAILABLE', 'Die Abstimmung ist gerade nicht erreichbar. Bitte versuche es erneut. Es werden keine Demodaten eingesetzt.', 503)
    }
  }
}
