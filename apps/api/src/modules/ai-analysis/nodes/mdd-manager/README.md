# mdd-manager (Fase 2 GOD-REFACTOR)

Extracción modular de `../mdd-manager.node.ts` — nodo LangGraph Manager del pipeline MDD.

| Archivo | Exports | Notas |
|---------|---------|-------|
| `manager-constants.ts` | Umbrales y regex de routing | `QUALITY_THRESHOLD`, `PLAN_APPROVAL_CONFIRM_PATTERN`, etc. |
| `manager-context.util.ts` | `LOG`, `hasRealBenchmark`, `mddHasContent` | Helpers de estado del draft/benchmark |
| `manager-heuristics.ts` | `inferSectionsFromMessage`, `looksLike*` | Heurísticos de mensaje (sin LLM) |
| `manager-plan.ts` | `buildMddPlan`, `expandSectionsToRun`, `generateMddPlanWithLLM` | Planner–Executor: goals por paso |
| `manager-llm-turn.ts` | `runManagerLlmTurn` | Structured output + búsqueda memoria + guardrails reply |
| `manager-state-handlers.ts` | `runDeterministicManagerHandlers` | Routing determinista (score, plan approval, regen, refinamiento) |
| `manager-delegate.ts` | `handleManagerDelegateOutcome` | Post-LLM: reply interrupt o plan → executor/clarifier |
| `manager-types.ts` | `MddManagerToolDeps` | Tipos compartidos (evita ciclos) |

El entrypoint estable sigue siendo `../mdd-manager.node.ts` (`createMddManagerNode`, ~60 L fachada; re-export de `expandSectionsToRun`).
