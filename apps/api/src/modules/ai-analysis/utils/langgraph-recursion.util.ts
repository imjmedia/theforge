/**
 * @fileoverview Gestión de límite de recursión en grafos LangGraph.
 */

import { resolvePlatformConfigNumber } from "../../system-config/platform-config.runtime.js";

/** LangGraph default recursion limit is 25; MDD con Manager puede superarlo. Override: catálogo `langgraph_recursion_limit`. */
export function resolveLangGraphRecursionLimit(
  env: NodeJS.ProcessEnv = process.env,
): number {
  const raw = env.LANGGRAPH_RECURSION_LIMIT?.trim();
  if (raw) {
    const n = Number(raw);
    if (Number.isFinite(n) && n >= 10 && n <= 500) return Math.floor(n);
  }
  return resolvePlatformConfigNumber("langgraph_recursion_limit");
}
