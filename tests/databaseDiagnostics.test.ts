import { describe, expect, it, vi } from 'vitest'
import { logDatabaseFailure } from '../supabase/functions/_shared/databaseDiagnostics'

describe('privacy-safe production database logging', () => {
  it.each(['initialization', 'start', 'submit'] as const)('logs only a fixed message for %s', (action) => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      logDatabaseFailure(action)
      expect(log.mock.calls).toEqual([[`prebi ${action}: database operation unavailable`]])
    } finally { log.mockRestore() }
  })
})
