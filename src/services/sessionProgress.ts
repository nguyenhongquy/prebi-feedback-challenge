const SESSION_PROGRESS_KEY = 'prebi-reflection-played-case-ids'

export interface SessionStorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

export function loadPlayedCaseIds(storage: SessionStorageLike): string[] {
  const savedProgress = storage.getItem(SESSION_PROGRESS_KEY)
  if (!savedProgress) return []

  const parsedProgress: unknown = JSON.parse(savedProgress)
  if (
    !Array.isArray(parsedProgress) ||
    !parsedProgress.every((caseId): caseId is string => typeof caseId === 'string')
  ) {
    throw new Error('Der gespeicherte Sitzungsfortschritt ist ungültig.')
  }

  return parsedProgress
}

export function savePlayedCaseIds(
  storage: SessionStorageLike,
  caseIds: string[],
): void {
  storage.setItem(SESSION_PROGRESS_KEY, JSON.stringify(caseIds))
}

export function resetSessionProgress(storage: SessionStorageLike): void {
  storage.removeItem(SESSION_PROGRESS_KEY)
}
