import postgres from 'postgres'
import type { Database } from './handler.ts'

export function databaseConnectionUrl(connectionString: string): string {
  const connection = new URL(connectionString)
  for (const parameter of ['sslmode', 'sslrootcert', 'sslcert', 'sslkey']) {
    connection.searchParams.delete(parameter)
  }
  return connection.toString()
}

export function databaseConnectionOptions(connectionString: string, caCertificate?: string) {
  const connection = new URL(connectionString)
  if (!['postgres:', 'postgresql:'].includes(connection.protocol)) {
    throw new Error('PREBI_DATABASE_URL must be a PostgreSQL connection URL')
  }
  const local = ['127.0.0.1', 'localhost', 'host.docker.internal', 'db'].includes(connection.hostname)
  const ca = caCertificate?.trim()
  return {
    max: 1,
    prepare: false,
    ssl: local ? false as const : ca ? { ca, rejectUnauthorized: true } : 'verify-full' as const,
    connect_timeout: 10,
    idle_timeout: 20,
    max_lifetime: 300,
    connection: { application_name: 'prebi-edge' },
  }
}

export function createDatabase(connectionString: string, caCertificate?: string): Database {
  const sql = postgres(databaseConnectionUrl(connectionString), databaseConnectionOptions(connectionString, caCertificate))
  return {
    async start(seen, tokenHash, humanPosition) {
       const rows = await sql`
    select prebi_private.start_round(
      ${sql.array(seen)}::text[],
      ${tokenHash}::text,
      ${humanPosition}::text
    ) as result
`
      return rows[0].result
    },
    async submit(input, tokenHash) {
      const rows = await sql`
        select prebi_private.submit_vote(
          ${tokenHash}, ${input.authorshipGuess}, ${input.helpfulnessPreference}, ${input.idempotencyKey}::uuid,
          ${input.helpfulnessReasons === null ? null : sql.array(input.helpfulnessReasons)}::text[]
        ) as result
      `
      return rows[0].result
    },
  }
}
