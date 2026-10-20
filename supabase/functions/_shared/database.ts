import postgres from 'postgres'
import type { Database } from './handler.ts'

export function createDatabase(connectionString: string): Database {
  const connection = new URL(connectionString)
  if (!['postgres:', 'postgresql:'].includes(connection.protocol)) {
    throw new Error('PREBI_DATABASE_URL must be a PostgreSQL connection URL')
  }
  const local = ['127.0.0.1', 'localhost', 'host.docker.internal', 'db'].includes(connection.hostname)
  const sql = postgres(connectionString, {
    max: 1,
    prepare: false,
    ssl: local ? false : 'verify-full',
    connect_timeout: 10,
    idle_timeout: 20,
    max_lifetime: 300,
    connection: { application_name: 'prebi-edge' },
  })
  return {
    async start(seen, tokenHash, humanPosition) {
      const rows = await sql`
        select prebi_private.start_round(${sql.array(seen, 25)}, ${tokenHash}, ${humanPosition}) as result
      `
      return rows[0].result
    },
    async submit(input, tokenHash) {
      const rows = await sql`
        select prebi_private.submit_vote(
          ${tokenHash}, ${input.authorshipGuess}, ${input.helpfulnessPreference}, ${input.idempotencyKey}::uuid
        ) as result
      `
      return rows[0].result
    },
  }
}
