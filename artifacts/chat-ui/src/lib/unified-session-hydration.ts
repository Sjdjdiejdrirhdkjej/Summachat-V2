/**
 * New sessions have no row in localStorage. When `getFingerprint()` resolves
 * after the user already typed or submitted, we must not reset turns/prompt
 * to empty defaults — that previously wiped the active message and looked like
 * a non-responsive assistant.
 */
export function shouldApplyBlankDefaultsForNewSession(params: {
  turnCount: number;
  promptTrimmedLength: number;
}): boolean {
  return params.turnCount === 0 && params.promptTrimmedLength === 0;
}
