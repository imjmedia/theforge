/**
 * Perfil de herramientas que el orquestador inyecta al grafo ReAct / LLM.
 * - sdd: Coherencia §3/§4 inferida del markdown MDD (patch/enmienda).
 * - theforge: MCP TheForge (código) vía TheForgeService / bridge; solo flujo legacy.
 */
export type AgentToolsProfile = "sdd_only" | "sdd_and_theforge";

/** Destino delegado tras el Supervisor (siguiente capa: LangGraph / prompts). */
export type AgentDelegate = "software_architect" | "legacy_coordinator";

export type SupervisorFlow = "NEW" | "LEGACY";

export interface SupervisorRouteResult {
  projectId: string;
  flow: SupervisorFlow;
  stageId: string;
  isLegacy: boolean;
  /** Resuelto: Stage.theforgeProjectId ?? Project.theforgeProjectId */
  theforgeProjectId: string | null;
  delegate: AgentDelegate;
  toolsProfile: AgentToolsProfile;
}
