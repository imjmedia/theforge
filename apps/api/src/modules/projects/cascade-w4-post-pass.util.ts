/** Reintentos W4 post-cascada para brechas scheduler / research→tasks. */
export const CASCADE_W4_PRECISION_MAX_ATTEMPTS = 3;

export const SCHEDULER_RESEARCH_PRECISION_GAP_RE = /\[Scheduler\]|\[Research→Tasks\]/i;

export function filterSchedulerResearchPrecisionGaps(gaps: readonly string[]): string[] {
  return gaps.filter((g) => SCHEDULER_RESEARCH_PRECISION_GAP_RE.test(g));
}

export function shouldRunAnotherCascadeW4Pass(
  schedulerResearchGaps: readonly string[],
  attemptIndex: number,
  maxAttempts = CASCADE_W4_PRECISION_MAX_ATTEMPTS,
): boolean {
  return schedulerResearchGaps.length > 0 && attemptIndex + 1 < maxAttempts;
}
