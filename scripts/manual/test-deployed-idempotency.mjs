// Manual only: creates one real anonymous vote. Never imported by automated tests.
// Node.js 22+. Secrets and request/response bodies remain in process memory only.
import { randomUUID } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import { createInterface } from 'node:readline/promises'

function requireCheck(condition, message) {
  if (!condition) throw new Error(message)
}

async function confirmRun() {
  requireCheck(process.stdin.isTTY && process.stderr.isTTY,
    'Interactive terminal required for RUN confirmation.')
  const reader = createInterface({ input: process.stdin, output: process.stderr })
  reader.once('SIGINT', () => reader.close())
  try {
    return (await reader.question(
      'This sends one start request and up to two submissions, creating ONE REAL VOTE if successful.\n'
      + 'No cleanup or retries are performed. Type RUN to proceed: ',
    )).trim()
  } finally {
    reader.close()
  }
}

function object(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function counts(value, keys) {
  return object(value) && keys.every((key) =>
    Number.isSafeInteger(value[key]) && value[key] >= 0)
}

function validResult(value) {
  if (!object(value) || !object(value.vote) || !object(value.results)) return false
  const result = value.results
  return value.isDemo === false
    && ['A', 'B'].includes(value.humanFeedbackPosition)
    && value.vote.authorshipGuess === 'unsure'
    && value.vote.helpfulnessPreference === 'equal'
    && typeof value.revealNote === 'string'
    && typeof value.discussionPrompt === 'string'
    && Number.isSafeInteger(result.totalVotes) && result.totalVotes >= 1
    && counts(result.authorship, ['human', 'ai', 'unsure'])
    && counts(result.helpfulness, ['human', 'ai', 'equal'])
    && result.authorship.human + result.authorship.ai + result.authorship.unsure === result.totalVotes
    && result.helpfulness.human + result.helpfulness.ai + result.helpfulness.equal === result.totalVotes
}

async function main() {
  const project = process.env.PREBI_TEST_PROJECT_REF?.trim()
  const key = process.env.PREBI_TEST_PUBLISHABLE_KEY?.trim()
  const origin = process.env.PREBI_TEST_ORIGIN?.trim()
  requireCheck(project && key && origin,
    'Set PREBI_TEST_PROJECT_REF, PREBI_TEST_PUBLISHABLE_KEY, and PREBI_TEST_ORIGIN before running.')
  requireCheck(/^[a-z0-9]{20}$/.test(project), 'Invalid Supabase project reference.')
  requireCheck(/^sb_publishable_[A-Za-z0-9_-]+$/.test(key), 'Expected a publishable project key.')
  let parsedOrigin
  try { parsedOrigin = new URL(origin) } catch { throw new Error('Invalid origin.') }
  requireCheck(parsedOrigin.origin === origin && ['https:', 'http:'].includes(parsedOrigin.protocol),
    'Origin must be an exact HTTP(S) origin without a path or trailing slash.')

  const confirmation = await confirmRun()
  requireCheck(confirmation === 'RUN', 'Cancelled; no requests sent.')

  async function post(endpoint, body) {
    let response
    try {
      response = await fetch(`https://${project}.supabase.co/functions/v1/${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: origin, apikey: key },
        body,
        redirect: 'error',
        credentials: 'omit',
        signal: AbortSignal.timeout(20_000),
      })
    } catch {
      throw new Error(`${endpoint}: network failure or timeout; no automatic retry. Submission outcome may be unknown.`)
    }
    requireCheck(response.status === 200,
      `${endpoint}: expected HTTP 200; received HTTP ${response.status}. Stopping without retries.`)
    try { return await response.json() }
    catch { throw new Error(`${endpoint}: invalid JSON response; stopping without retries.`) }
  }

  const round = await post('start-round', JSON.stringify({ playedCaseIds: [] }))
  requireCheck(object(round) && round.complete === false
    && typeof round.roundToken === 'string' && /^[0-9a-f]{64}$/.test(round.roundToken),
  'No valid new round returned; no vote submitted.')

  // Reuse this exact serialized body; never print it, the key, or either response.
  const submission = JSON.stringify({
    roundToken: round.roundToken,
    authorshipGuess: 'unsure',
    helpfulnessPreference: 'equal',
    idempotencyKey: randomUUID(),
  })
  const first = await post('submit-vote', submission)
  const repeated = await post('submit-vote', submission)
  requireCheck(validResult(first) && validResult(repeated),
    'FAIL: submission result shape, choices, or aggregate totals are invalid.')
  // submit_vote persists the entire first response and returns that snapshot on replay.
  // Compare parsed JSON, not raw bytes: JSON object key ordering is not contractual.
  requireCheck(isDeepStrictEqual(first, repeated),
    'FAIL: identical submissions returned different recorded results.')
  console.log('PASS: one start request; two identical submissions returned HTTP 200 and identical valid results.')
  console.log('API replay verified. A separate approved database check is needed to independently prove one stored vote.')
}

main().catch((error) => {
  // All errors intentionally thrown above have fixed messages, but never print raw errors.
  const allowed = [
    'Interactive terminal required for RUN confirmation.',
    'Set PREBI_TEST_PROJECT_REF, PREBI_TEST_PUBLISHABLE_KEY, and PREBI_TEST_ORIGIN before running.',
    'Invalid Supabase project reference.', 'Expected a publishable project key.',
    'Invalid origin.', 'Origin must be an exact HTTP(S) origin without a path or trailing slash.',
    'Cancelled; no requests sent.', 'No valid new round returned; no vote submitted.',
    'FAIL: submission result shape, choices, or aggregate totals are invalid.',
    'FAIL: identical submissions returned different recorded results.',
  ]
  const message = error instanceof Error ? error.message : ''
  const safeRequestFailure = /^(start-round|submit-vote): (network failure or timeout; no automatic retry\. Submission outcome may be unknown\.|expected HTTP 200; received HTTP [1-5][0-9]{2}\. Stopping without retries\.|invalid JSON response; stopping without retries\.)$/
  console.error(allowed.includes(message) || safeRequestFailure.test(message)
    ? message : 'Test stopped unexpectedly. No diagnostic details printed; a submission outcome may be unknown.')
  process.exitCode = 1
})
