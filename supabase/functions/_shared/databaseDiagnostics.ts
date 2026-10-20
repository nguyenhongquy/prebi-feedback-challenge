export function logDatabaseFailure(action: 'initialization' | 'start' | 'submit') {
  console.error(`prebi ${action}: database operation unavailable`)
}
