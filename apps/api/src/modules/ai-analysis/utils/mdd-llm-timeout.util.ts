/** Timeout único para SDK LangChain e `invokeLlmWithRetry` (env `LANGGRAPH_LLM_TIMEOUT_MS`). */
export function resolveLlmTimeoutMs(): number {
  const raw = process.env.LANGGRAPH_LLM_TIMEOUT_MS?.trim() || "120000";
  const parsed = parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 120_000;
}
