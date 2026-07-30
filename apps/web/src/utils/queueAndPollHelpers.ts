const GENERATE_URL_FIELD: Record<string, string> = {
  "generate-spec": "specContent",
  "generate-aem": "aemContent",
  "generate-blueprint": "blueprintContent",
  "generate-api-contracts": "apiContractsContent",
  "generate-logic-flows": "logicFlowsContent",
  "generate-infra": "infraContent",
  "generate-architecture": "architectureContent",
  "generate-use-cases": "useCasesContent",
  "generate-user-stories": "userStoriesContent",
  "generate-agent-governance": "agentGovernanceContent",
  "generate-tasks": "tasksContent",
};

/** Respuesta del backend cuando encola sin Redis (fire-and-forget). */
export function isFireAndForgetQueueResponse(data: Record<string, unknown>): boolean {
  if (data.queued !== true) return false;
  if (data.statusPath == null) return true;
  const jobId = data.jobId;
  return typeof jobId === "string" && jobId.startsWith("bg-");
}

export function extractProjectIdFromGenerateUrl(url: string): string | null {
  const match = url.match(/\/projects\/([^/?]+)\/generate-/);
  return match?.[1] ?? null;
}

export function contentFieldForGenerateUrl(url: string): string | null {
  for (const [segment, field] of Object.entries(GENERATE_URL_FIELD)) {
    if (url.includes(`/${segment}`)) return field;
  }
  return null;
}

export function isProjectGenerationComplete(
  project: Record<string, unknown>,
  field: string,
  baseline: string | null,
): boolean {
  const current = project[field];
  if (typeof current !== "string" || !current.trim()) return false;
  if (!baseline?.trim()) return true;
  return current !== baseline;
}
