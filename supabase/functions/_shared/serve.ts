import { createDatabase } from './database.ts'
import { createHandler, type Action } from './handler.ts'

export function serve(action: Action) {
  const connectionString = Deno.env.get('PREBI_DATABASE_URL')
  const publishableKey = Deno.env.get('PREBI_PUBLISHABLE_KEY')
  const allowedOrigins = Deno.env.get('PREBI_ALLOWED_ORIGINS')?.split(',').map((value) => value.trim()).filter(Boolean)
  if (!connectionString || !publishableKey?.startsWith('sb_publishable_') || !allowedOrigins?.length
    || allowedOrigins.some((origin) => {
      try { return new URL(origin).origin !== origin || !/^https?:/.test(origin) }
      catch { return true }
    })) {
    throw new Error('Configure PREBI_DATABASE_URL, PREBI_PUBLISHABLE_KEY, and exact PREBI_ALLOWED_ORIGINS')
  }
  Deno.serve(createHandler(action, {
    database: createDatabase(connectionString), publishableKey, allowedOrigins,
  }))
}
