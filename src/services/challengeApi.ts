import type { ChallengeApi } from '../types/challenge'

export type { ChallengeApi } from '../types/challenge'

export const isDemoMode = !import.meta.env.VITE_API_MODE || import.meta.env.VITE_API_MODE === 'mock'

let adapter: Promise<ChallengeApi> | undefined

function loadAdapter(): Promise<ChallengeApi> {
  adapter ??= (async () => {
    if (import.meta.env.VITE_API_MODE === 'supabase') {
      const { SupabaseChallengeApi } = await import('./supabaseChallengeApi')
      return new SupabaseChallengeApi(
        import.meta.env.VITE_SUPABASE_URL ?? '',
        import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? '',
      )
    }
    if (!import.meta.env.VITE_API_MODE || import.meta.env.VITE_API_MODE === 'mock') {
      const { mockChallengeApi } = await import('./mockChallengeApi')
      return mockChallengeApi
    }
    throw new Error('VITE_API_MODE muss mock oder supabase sein.')
  })()
  return adapter
}

export const challengeApi: ChallengeApi = {
  async startRound(playedCaseIds) {
    return (await loadAdapter()).startRound(playedCaseIds)
  },
  async submitVote(roundId, vote) {
    return (await loadAdapter()).submitVote(roundId, vote)
  },
  reset() {
    if (adapter) void adapter.then((api) => api.reset?.(), () => {
      // Configuration failures are shown by the next start-round attempt.
      adapter = undefined
    })
  },
}
