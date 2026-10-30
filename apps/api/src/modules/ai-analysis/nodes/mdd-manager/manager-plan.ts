import {
  MDD_MAX_GOAL_OTHER_NODES_CHARS,
  MDD_MAX_GOAL_SOFTWARE_ARCHITECT_CHARS,
} from "@theforge/shared-types";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { HumanMessage } from "@langchain/core/messages";
import { MANAGER_PLAN_GENERATOR_PROMPT } from "../../prompts/load-prompts.js";
import type { MDDStateType } from "../../state/index.js";
import type { MddComplexityLevel, MddPlanStep } from "../../state/mdd-state.schema.js";
import { getPlanDirective, getUserBrief } from "../../utils/mdd-user-brief.js";
import { extractFirstJsonObject } from "../../utils/parse-json.js";
import { isMddTailParallelEnabled } from "../../utils/mdd-tail-parallel.config.js";
import {
  expandArchitectAgentNames,
  getArchitectNodeSequence,
} from "../../utils/mdd-architect-pipeline.util.js";
import { z } from "zod";

/** Orden de agentes en el pipeline (sin Clarifier). */
const PIPELINE_AGENTS = [
  "software_architect",
  "stack_architect",
  "data_model",
  "architect_critic",
  "api_contracts",
  "section5",
  "security",
  "integration",
] as const;
const PIPELINE_TAIL = ["format_after_redactor", "diagram_injector", "auditor"] as const;
const ARCHITECT_WRITERS = new Set([
  "software_architect",
  "stack_architect",
  "data_model",
  "api_contracts",
]);

/** Descripción por nodo para el plan explícito (patrón Planner–Executor). */
const NODE_TASK_DESCRIPTIONS: Record<string, string> = {
  ask_initial_topic: "Preguntar tema o problema del MDD",
  clarifier: "Clarificar contexto y alcance",
  merge_section1_only: "Fusionar solo sección 1 (contexto y alcance)",
  software_architect: "Definir stack, schema SQL y contratos de API (LOW/MEDIUM)",
  stack_architect: "Definir arquitectura y stack (§2)",
  data_model: "Definir modelo de datos SQL y ER (§3)",
  architect_critic: "Verificar coherencia del modelo de datos antes de contratos API",
  api_contracts: "Definir contratos de API (§4)",
  section5: "Definir lógica y edge cases (§5)",
  format_after_architect: "Formatear documento tras arquitecto",
  tail_parallel: "Generar §5 Lógica, §6 Seguridad y §7 Infraestructura en paralelo",
  security: "Definir arquitectura de seguridad",
  integration: "Definir integraciones (API/Docker)",
  format_after_redactor: "Formatear documento final",
  diagram_injector: "Añadir diagramas Mermaid",
  auditor: "Evaluar calidad del MDD",
};

/** 4.3 Least privilege: tools por nodo (solo nodos con tools en el grafo MDD). */
const NODE_REQUIRED_TOOLS: Record<string, string[]> = {
  software_architect: ["format_section3_endpoints"],
  api_contracts: ["format_section3_endpoints"],
  auditor: ["validate_mdd_structure", "validate_sql_syntax", "validate_json_payloads"],
};

function stepWithTools(node: string, stepId: string, taskDescription: string, goal?: string): MddPlanStep {
  const required_tools = NODE_REQUIRED_TOOLS[node];
  return {
    step_id: stepId,
    task_description: taskDescription,
    node,
    ...(goal ? { goal } : {}),
    ...(required_tools?.length ? { required_tools } : {}),
  };
}

/** Sufijo opcional para contextualizar solo el primer paso con la solicitud del usuario (máx. 50 chars). */
function contextSuffix(userBrief: string | undefined): string {
  if (!userBrief || userBrief.length < 10) return "";
  const trimmed = userBrief.replace(/\s+/g, " ").trim().slice(0, 50);
  return trimmed.length >= 10 ? ` (según: ${trimmed}${userBrief.length > 50 ? "…" : ""})` : "";
}

/** Indicios de requisito de modelo de datos (para goal explícito en paso software_architect). */
const MODEL_REQUIREMENT_REGEX =
  /\b(aplicaciones?|modelo\s+de\s+datos|roles?|permisos?|entidades?|tablas?|diagrama\s*(er|entidad|relaci[oó]n)?|relaci[oó]n(es)?|base\s+de\s+datos|campo|columna|guardar(?:se)?\s+en|jwt_token|refresh_token)\b/i;

/** Indicios de petición que afectan §2 Arquitectura y Stack (stack tecnológico, frontend, backend, etc.). */
export const STACK_SECTION2_REGEX =
  /\b(stack|arquitectura|frontend|backend|framework|tecnolog[ií]a|nestjs|react|vue|angular|node\.?js|postgresql|mysql|vite|webpack|docker|kubernetes|kubernets|k8s|dokploy|coolify|despliegue|contenedores?|secci[oó]n\s*2|§2)\b/i;

function truncateForGoal(text: string, max: number): string {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length > max ? t.slice(0, max) + "…" : t;
}

function goalForArchitectFamily(node: string, architectGoal: string, full: string): string | undefined {
  const rolesPorApp =
    /(?:roles?\s+por\s+aplicaci[oó]n|roles?\s+a\s+nivel\s+de\s+aplicaci[oó]n|permisos?\s+basados\s+en\s+roles?\s+definidos\s+por\s+cada\s+aplicaci[oó]n)/i.test(full);
  if (rolesPorApp && (node === "software_architect" || node === "data_model")) {
    return "Cambiar el modelo de datos para que incluya applications, application_roles por aplicación y user_application_roles. No copies §3 del borrador; genera §3 desde cero con esas tablas. Luego elabora §4 Contratos de API.";
  }
  if (directiveRequiresModelAndDiagramChange(full) && (node === "software_architect" || node === "data_model" || node === "api_contracts")) {
    return `Requisito de seguridad/almacenamiento: ${architectGoal} Debes actualizar §3 Modelo de Datos (quitar de las tablas SQL cualquier campo que no deba persistirse, p. ej. jwt_token) y el diagrama entidad-relación para que coincida; y §4 Contratos de API (añadir o ajustar endpoints, p. ej. refresh_token). Revisa todo el SQL y el erDiagram y elimina columnas que el usuario indica que no deben guardarse en BD.`;
  }
  const affectsModel = MODEL_REQUIREMENT_REGEX.test(full);
  const affectsSection2 = STACK_SECTION2_REGEX.test(full);
  if (node === "stack_architect") {
    return affectsSection2
      ? `Actualizar §2 Arquitectura y Stack según: ${architectGoal}`
      : `Definir §2 Arquitectura y Stack según: ${architectGoal}`;
  }
  if (node === "data_model") {
    return affectsModel
      ? `Elaborar §3 (SQL, diagrama ER) según: ${architectGoal}`
      : `Completar §3 Modelo de Datos según alcance: ${architectGoal}`;
  }
  if (node === "api_contracts") {
    return `Elaborar §4 Contratos de API alineados a §3 según: ${architectGoal}`;
  }
  if (affectsModel && affectsSection2) {
    return `Actualizar §2 Arquitectura y Stack y el modelo de datos según lo que pide el usuario. Elabora §2, §3 (SQL, diagrama ER), §4 según: ${architectGoal}`;
  }
  if (affectsSection2) {
    return `Actualizar §2 Arquitectura y Stack según lo que pide el usuario. Elabora §2 (y §3, §4 si aplica) según: ${architectGoal}`;
  }
  if (affectsModel) {
    return `Cambiar el modelo de datos para que incluya lo que pide el usuario. Elabora §3 (SQL, diagrama ER) y §4 Contratos según: ${architectGoal}`;
  }
  return `Incorporar en §2, §3 y §4 lo indicado: ${architectGoal}`;
}

/**
 * Goal para un paso a partir del plan/directiva. El manager es la única fuente de instrucciones
 * explícitas para los agentes: aquí se construye el texto que recibe cada nodo (currentStepGoal).
 */
function goalForStep(node: string, directiveOrBrief: string | undefined): string | undefined {
  if (!directiveOrBrief || directiveOrBrief.length < 10) return undefined;
  const full = directiveOrBrief.replace(/\s+/g, " ").trim();
  const shortGoal = truncateForGoal(full, MDD_MAX_GOAL_OTHER_NODES_CHARS);
  const architectGoal = truncateForGoal(full, MDD_MAX_GOAL_SOFTWARE_ARCHITECT_CHARS);
  if (architectGoal.length < 10) return undefined;
  if (node === "clarifier") return `Aclarar contexto y alcance para: ${shortGoal}`;
  if (
    node === "software_architect" ||
    node === "stack_architect" ||
    node === "data_model" ||
    node === "api_contracts"
  ) {
    return goalForArchitectFamily(node, architectGoal, full);
  }
  if (node === "tail_parallel") {
    return `Completar §5 Lógica y Edge Cases, §6 Seguridad y §7 Infraestructura según: ${shortGoal}`;
  }
  if (node === "section5") return `Definir §5 Lógica y Edge Cases según: ${shortGoal}`;
  if (node === "security") return `Aplicar en §6 Seguridad lo que corresponda de: ${shortGoal}`;
  if (node === "integration") return `Aplicar en §7 Infraestructura lo que corresponda de: ${shortGoal}`;
  return undefined;
}

/** Secuencia completa del pipeline Manager (clarifier → auditor), respetando MDD_TAIL_PARALLEL y complejidad. */
export function getFullPipelineNodeSequence(complexity?: MddComplexityLevel): readonly string[] {
  const afterArchitect = isMddTailParallelEnabled()
    ? (["tail_parallel"] as const)
    : (["security", "integration"] as const);
  const architectSeq = getArchitectNodeSequence(complexity);
  return [
    "clarifier",
    ...architectSeq,
    "format_after_architect",
    ...afterArchitect,
    "format_after_redactor",
    "diagram_injector",
    "auditor",
  ];
}

/** Si la directiva pide no guardar algo en BD (ej. jwt_token) o eliminar un campo, el Arquitecto debe actualizar §3 y diagrama. */
function directiveRequiresModelAndDiagramChange(directive: string): boolean {
  const d = (directive ?? "").toLowerCase();
  return (
    /\bno\s+guardar(?:se)?\s+en\s+base\s+de\s+datos\b/i.test(d) ||
    /\b(no\s+almacenar|eliminar\s+campo|quitar\s+campo|no\s+persistir|jwt_token|refresh_token)\b/i.test(d) ||
    /\bcampo\s+\w+.*(?:no\s+debe|no\s+guardar|eliminar|quitar)\b/i.test(d)
  );
}

/** Construye el plan estructurado (lista de pasos) al delegar; artefacto explícito para patrón Planner–Executor. */
export function buildMddPlan(
  delegateTarget: "clarifier_only" | "full_pipeline" | "sections" | undefined,
  sectionsToRun: string[] | undefined,
  userBrief?: string,
  planDirective?: string,
  complexity?: MddComplexityLevel,
): MddPlanStep[] {
  const effectiveBrief =
    planDirective?.trim() && planDirective.trim().length > 50 ? planDirective.trim() : (userBrief ?? "");
  const suffix = contextSuffix(effectiveBrief);
  const briefForGoal = effectiveBrief.replace(/\s+/g, " ").trim();
  const step = (node: string, stepId: string, desc: string, isFirst: boolean): MddPlanStep =>
    stepWithTools(node, stepId, isFirst ? desc + suffix : desc, goalForStep(node, briefForGoal));

  if (delegateTarget === "clarifier_only") {
    return [
      step("clarifier", "1", NODE_TASK_DESCRIPTIONS.clarifier, true),
      step("merge_section1_only", "2", NODE_TASK_DESCRIPTIONS.merge_section1_only, false),
    ];
  }
  if (delegateTarget === "sections" && sectionsToRun?.length) {
    return sectionsToRun.map((node, i) =>
      step(node, String(i + 1), NODE_TASK_DESCRIPTIONS[node] ?? node, i === 0),
    );
  }
  if (delegateTarget === "full_pipeline" || !delegateTarget) {
    return getFullPipelineNodeSequence(complexity).map((node, i) =>
      step(node, String(i + 1), NODE_TASK_DESCRIPTIONS[node] ?? node, i === 0),
    );
  }
  return [];
}

export type ExpandSectionsToRunOptions = {
  /**
   * full: format tras arquitecto + cola (format_after_redactor, diagram_injector, auditor).
   * minimal: solo agentes de dominio (sin format ni cola) — planes acotados stack/infra.
   */
  tail?: "full" | "minimal";
  complexity?: MddComplexityLevel;
};

function insertFormatAfterLastArchitect(out: string[]): string[] {
  let lastIdx = -1;
  for (let i = 0; i < out.length; i++) {
    if (ARCHITECT_WRITERS.has(out[i]!)) lastIdx = i;
  }
  if (lastIdx >= 0 && !out.includes("format_after_architect")) {
    out.splice(lastIdx + 1, 0, "format_after_architect");
  }
  return out;
}

/** Expande la lista de agentes solicitados a la secuencia real de nodos (incluye format entre escritores y tail). */
export function expandSectionsToRun(
  agentNames: string[],
  options?: ExpandSectionsToRunOptions,
): string[] {
  const tailMode = options?.tail ?? "full";
  const expandedNames = expandArchitectAgentNames(agentNames, options?.complexity);
  const valid = new Set(expandedNames.filter((a) => PIPELINE_AGENTS.includes(a as (typeof PIPELINE_AGENTS)[number])));
  if (options?.complexity === "HIGH") {
    if (valid.has("stack_architect") || valid.has("data_model") || valid.has("api_contracts")) {
      valid.add("architect_critic");
    }
  } else if (valid.has("software_architect")) {
    valid.add("architect_critic");
  }
  const useTailParallel =
    isMddTailParallelEnabled() && valid.has("security") && valid.has("integration");
  const skipWhenTailParallel = useTailParallel
    ? new Set(["section5", "security", "integration"])
    : new Set<string>();
  const out: string[] = [];
  for (const node of PIPELINE_AGENTS) {
    if (!valid.has(node) || skipWhenTailParallel.has(node)) continue;
    out.push(node);
  }
  insertFormatAfterLastArchitect(out);
  if (useTailParallel) {
    const fmtIdx = out.indexOf("format_after_architect");
    if (fmtIdx >= 0) out.splice(fmtIdx + 1, 0, "tail_parallel");
    else out.push("tail_parallel");
  }
  if (!out.length) return [];
  if (tailMode === "minimal") return out;
  return [...out, ...PIPELINE_TAIL];
}

const CLARIFIER_ONLY_NODES = ["clarifier", "merge_section1_only"] as const;

const planGeneratorOutputSchema = z.object({
  steps: z.array(
    z.object({
      step_id: z.string(),
      node: z.string(),
      task_description: z.string(),
      goal: z.string().optional(),
    }),
  ),
});

/**
 * Genera el plan de ejecución (tareas explícitas por agente) interpretando la intención del usuario.
 * Si el LLM falla o devuelve un plan inválido, retorna [] para usar fallback buildMddPlan.
 */
export async function generateMddPlanWithLLM(
  llm: BaseChatModel,
  state: MDDStateType,
  delegateTarget: "clarifier_only" | "full_pipeline" | "sections" | undefined,
  sectionsToRun: string[] | undefined,
): Promise<MddPlanStep[]> {
  const complexity = state.mddComplexity;
  const allowedNodes =
    delegateTarget === "clarifier_only"
      ? new Set(CLARIFIER_ONLY_NODES)
      : delegateTarget === "sections" && sectionsToRun?.length
        ? new Set(sectionsToRun)
        : new Set(getFullPipelineNodeSequence(complexity));
  const planDirective = getPlanDirective(state);
  const userBrief = getUserBrief(state);
  const context = [
    "**Objetivo / petición del usuario:**",
    planDirective?.trim() || userBrief?.trim() || state.lastUserMessage?.trim() || "(sin mensaje)",
    state.clarifiedScope?.trim() ? `\n**Alcance clarificado:**\n${state.clarifiedScope.trim().slice(0, 2000)}` : "",
    `\n**Tipo de delegación:** ${delegateTarget ?? "full_pipeline"}${sectionsToRun?.length ? `; agentes: ${sectionsToRun.join(", ")}` : ""}`,
    complexity ? `\n**Complejidad del proyecto:** ${complexity}` : "",
    "\n**Instrucción:** Genera un plan (lista de pasos) con `step_id`, `node`, `task_description` y `goal` para cada paso. Usa solo nodos de la lista permitida. El `goal` debe ser una instrucción concreta para ese agente (qué hacer en §3, §4, etc.). Responde solo con el JSON.",
  ]
    .filter(Boolean)
    .join("\n");
  const prompt = `${MANAGER_PLAN_GENERATOR_PROMPT}\n\n---\n${context}`;
  try {
    const response = await llm.invoke([new HumanMessage(prompt)]);
    const text = typeof response.content === "string" ? response.content : "";
    if (!text.trim()) return [];
    const jsonStr = extractFirstJsonObject(text);
    if (!jsonStr) return [];
    const parsed = planGeneratorOutputSchema.safeParse(JSON.parse(jsonStr));
    if (!parsed.success || !parsed.data.steps?.length) return [];
    const steps: MddPlanStep[] = [];
    let stepIndex = 0;
    for (const s of parsed.data.steps) {
      if (!allowedNodes.has(s.node)) continue;
      stepIndex += 1;
      const required_tools = NODE_REQUIRED_TOOLS[s.node];
      steps.push({
        step_id: String(stepIndex),
        task_description: s.task_description.trim() || (NODE_TASK_DESCRIPTIONS[s.node] ?? s.node),
        node: s.node,
        ...(s.goal?.trim() ? { goal: s.goal.trim() } : {}),
        ...(required_tools?.length ? { required_tools } : {}),
      });
    }
    return steps;
  } catch {
    return [];
  }
}

/** Expone descripciones de tarea para fallback plans en handlers de refinamiento. */
export function managerPlanStepWithTools(
  node: string,
  stepId: string,
  taskDescription: string,
  goal?: string,
): MddPlanStep {
  return stepWithTools(node, stepId, taskDescription, goal);
}

export { NODE_TASK_DESCRIPTIONS };
