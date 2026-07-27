/**
 * @fileoverview Utilidades del pipeline de arquitecto MDD.
 */

import type { MddComplexityLevel } from "../state/mdd-state.schema.js";
import type { MDDStateType } from "../state/index.js";
import { isMddTailParallelEnabled } from "./mdd-tail-parallel.config.js";
import {
  draftHasPersistableSection4,
  draftHasSubstantialSection2,
  draftHasSubstantialSection3,
  preserveSection2IfSubstantial,
  preserveSection3IfSubstantial,
  preserveSection4IfSubstantial,
} from "./mdd-section-preserve.util.js";
import {
  extractArquitecturaSectionBody,
  extractSection3Body,
  extractSection4Body,
} from "./mdd-sanitize/section-merge.js";

const SCOPED_ARCHITECT_STREAM_NODES = new Set(["stack_architect", "data_model", "api_contracts"]);

const CANONICAL_MDD_SECTION_HEADING = /^##\s*([1-7])\./gm;

/** Alcance del nodo arquitecto en el pipeline MDD. */
export type MddSoftwareArchitectScope = "full" | "stack" | "data_model" | "api_contracts";

export type ArchitectCriticPhase = "after_section3" | "after_full";

/** Pipeline §2→§3→critic→§4 solo en complejidad HIGH (pasada completa). */
export function isHighSplitArchitectPipeline(state: MDDStateType): boolean {
  if (state.mddComplexity !== "HIGH") return false;
  if (state.delegateTarget === "sections" && state.sectionsToRun?.length) return false;
  if (state.executorControlled === true && state.sectionsToRun?.length) return false;
  return true;
}

/** Secuencia de nodos arquitecto tras clarifier (sin format/tail). */
export function getArchitectNodeSequence(complexity?: MddComplexityLevel): readonly string[] {
  if (complexity === "HIGH") {
    return ["stack_architect", "data_model", "architect_critic", "api_contracts"] as const;
  }
  return ["software_architect", "architect_critic"] as const;
}

/** §5 fuera del arquitecto en pasada completa; section5/tail_parallel lo materializa. */
export function shouldDecoupleSection5FromArchitect(
  state: MDDStateType,
  scope: MddSoftwareArchitectScope,
): boolean {
  if (state.sectionsToRun?.length) {
    if (scope !== "full") return true;
    return isMddTailParallelEnabled() && !state.sectionsToRun.includes("section5");
  }
  return true;
}

const SCOPED_SECTION_ONLY_OUTPUT = `**FORMATO DE SALIDA (pasada acotada — ahorra tokens):**
Responde con **solo el cuerpo de tu sección** (mín. 80 caracteres técnicos). Puedes incluir el heading \`## N. …\` de tu sección.
**NO** generes el MDD completo ni copies §1–§7 enteras. **PROHIBIDO** "(Pendiente: Arquitecto)" u otros placeholders.`;

const SCOPE_BLOCKS: Record<MddSoftwareArchitectScope, string> = {
  full: "",
  stack: `# Arquitecto de Stack (MDD §2)

**Alcance exclusivo:** Redacta **solo ## 2. Arquitectura y Stack** (stack, capas, despliegue base).
**Prohibido** modificar §3/§4 ni redactar §5.
${SCOPED_SECTION_ONLY_OUTPUT}
Las decisiones de stack alimentan modelo de datos y contratos API.`,
  data_model: `# Experto en Modelo de Datos (MDD §3)

**Alcance exclusivo:** Redacta **solo ## 3. Modelo de Datos** (SQL PostgreSQL, erDiagram Mermaid, TechnicalMetadata si aplica).
**No** modifiques §4 ni redactes §5.
${SCOPED_SECTION_ONLY_OUTPUT}
Deriva entidades de §1, §2 y requisitos del usuario.`,
  api_contracts: `# Experto en Contratos de API (MDD §4)

**Alcance exclusivo:** Redacta **solo ## 4. Contratos de API** (tabla GFM + endpoints con request/response JSON).
**No** redactes §5.
${SCOPED_SECTION_ONLY_OUTPUT}
Cada entidad de §3 con API debe tener operación documentada; alinea rutas con §2.`,
};

export function architectScopePromptPrefix(scope: MddSoftwareArchitectScope): string {
  return SCOPE_BLOCKS[scope];
}

/** Nodo arquitecto → sección MDD tocada (merge quirúrgico). */
export function architectScopeSectionNumber(scope: MddSoftwareArchitectScope): 2 | 3 | 4 | null {
  if (scope === "stack") return 2;
  if (scope === "data_model") return 3;
  if (scope === "api_contracts") return 4;
  return null;
}

/** Expande software_architect a la secuencia HIGH cuando aplica. */
export function expandArchitectAgentNames(
  agentNames: string[],
  complexity?: MddComplexityLevel,
): string[] {
  if (complexity !== "HIGH" || !agentNames.includes("software_architect")) {
    return agentNames;
  }
  const out: string[] = [];
  for (const name of agentNames) {
    if (name === "software_architect") {
      out.push("stack_architect", "data_model", "architect_critic", "api_contracts");
    } else {
      out.push(name);
    }
  }
  return out;
}

/** Agente(s) para regenerar una sección MDD (2–4) según complejidad. */
export function agentsForArchitectSection(
  section: 2 | 3 | 4,
  complexity?: MddComplexityLevel,
): string[] {
  if (complexity !== "HIGH") return ["software_architect"];
  if (section === 2) return ["stack_architect"];
  if (section === 3) return ["data_model"];
  return ["api_contracts"];
}

const SCOPED_SECTION_HEADINGS: Record<Exclude<MddSoftwareArchitectScope, "full">, string> = {
  stack: "## 2. Arquitectura y Stack",
  data_model: "## 3. Modelo de Datos",
  api_contracts: "## 4. Contratos de API",
};

/** Heading canónico de la sección en pasadas scoped (stack/data_model/api_contracts). */
export function architectScopedSectionHeading(scope: MddSoftwareArchitectScope): string | null {
  if (scope === "full") return null;
  return SCOPED_SECTION_HEADINGS[scope];
}

export type ArchitectMergeBaselineSource =
  | "draftTrimmed"
  | "previousMddDraftForMerge"
  | "draftTrimmed_fallback";

/**
 * Baseline para merge quirúrgico: en HIGH scoped usa el draft actual del grafo;
 * `previousMddDraftForMerge` solo en executor / regen manager (sections, clarifier_only).
 */
export function resolveArchitectMergeBaseline(
  state: Pick<MDDStateType, "executorControlled" | "delegateTarget" | "previousMddDraftForMerge">,
  scope: MddSoftwareArchitectScope,
  draftTrimmed: string,
): { baseline: string; source: ArchitectMergeBaselineSource } {
  const previous = (state.previousMddDraftForMerge ?? "").trim();
  const usePrevious =
    state.executorControlled === true ||
    state.delegateTarget === "sections" ||
    state.delegateTarget === "clarifier_only";

  if (usePrevious && previous) {
    return { baseline: previous, source: "previousMddDraftForMerge" };
  }
  if (scope !== "full" && draftTrimmed) {
    return { baseline: draftTrimmed, source: "draftTrimmed" };
  }
  if (previous) {
    return { baseline: previous, source: "previousMddDraftForMerge" };
  }
  return { baseline: draftTrimmed, source: "draftTrimmed_fallback" };
}

/** Detecta respuesta scoped que parece MDD completo (no solo §N). */
export function looksLikeFullMddArchitectResponse(
  text: string,
  scope: MddSoftwareArchitectScope,
): boolean {
  const trimmed = (text ?? "").trim();
  if (!trimmed || scope === "full") return false;
  if (/^#\s*Master\s+Design\s+Document/im.test(trimmed)) return true;

  const targetSection = architectScopeSectionNumber(scope);
  if (targetSection === null) return false;

  const sections = new Set<number>();
  for (const match of trimmed.matchAll(CANONICAL_MDD_SECTION_HEADING)) {
    const n = Number(match[1]);
    if (n >= 1 && n <= 7) sections.add(n);
  }
  const beyondTarget = [...sections].filter((n) => n !== targetSection);
  return beyondTarget.length >= +2 || (beyondTarget.length >= 1 && sections.size >= 3);
}

/** Extrae solo la sección objetivo de un MDD completo devuelto en pasada scoped. */
export function extractTargetSectionFragmentFromFullMdd(
  text: string,
  scope: Exclude<MddSoftwareArchitectScope, "full">,
): string | null {
  const section = architectScopeSectionNumber(scope);
  const heading = architectScopedSectionHeading(scope);
  if (!section || !heading) return null;

  const body =
    section === 2
      ? extractArquitecturaSectionBody(text)
      : section === 3
        ? extractSection3Body(text)
        : extractSection4Body(text);
  if (!body?.trim()) return null;
  return `${heading}\n\n${body.trim()}`;
}

export type ScopedArchitectResponseProcessResult = {
  fragment: string;
  extractedFromFullMdd: boolean;
};

/**
 * Normaliza respuesta scoped: envuelve cuerpo sin heading; si el LLM devolvió MDD completo,
 * extrae solo la sección objetivo (no propagar el documento entero antes del merge).
 */
export function processScopedArchitectResponse(
  text: string,
  scope: MddSoftwareArchitectScope,
): ScopedArchitectResponseProcessResult {
  const trimmed = (text ?? "").trim();
  if (!trimmed || scope === "full") {
    return { fragment: trimmed, extractedFromFullMdd: false };
  }

  if (looksLikeFullMddArchitectResponse(trimmed, scope)) {
    const extracted = extractTargetSectionFragmentFromFullMdd(trimmed, scope);
    if (extracted) {
      return { fragment: extracted, extractedFromFullMdd: true };
    }
  }

  return { fragment: normalizeScopedArchitectResponse(trimmed, scope), extractedFromFullMdd: false };
}

/**
 * Normaliza respuesta scoped: si el LLM devolvió solo el cuerpo (sin heading), lo envuelve
 * para que los extractores de merge quirúrgico funcionen.
 */
export function normalizeScopedArchitectResponse(
  text: string,
  scope: MddSoftwareArchitectScope,
): string {
  const trimmed = (text ?? "").trim();
  if (!trimmed || scope === "full") return trimmed;
  const heading = architectScopedSectionHeading(scope);
  if (!heading) return trimmed;
  if (trimmed.includes(heading)) return trimmed;
  if (/^##\s+[1-7]\./m.test(trimmed)) return trimmed;
  return `${heading}\n\n${trimmed}`;
}

/** Feedback tras detectar MDD completo en pasada scoped. */
export function formatScopedArchitectFullMddRejectFeedback(scope: MddSoftwareArchitectScope): string {
  const section = architectScopeSectionNumber(scope);
  const label =
    section === 2 ? "§2 Arquitectura y Stack" : section === 3 ? "§3 Modelo de Datos" : "§4 Contratos de API";
  return `PROHIBIDO MDD completo; solo cuerpo ${label}. Responde únicamente con el contenido de tu sección asignada.`;
}

const STREAM_NODE_TO_SCOPE: Record<string, MddSoftwareArchitectScope> = {
  stack_architect: "stack",
  data_model: "data_model",
  api_contracts: "api_contracts",
};

/**
 * Evita publicar en vivo un MDD completo sin merge (Frankenstein con §2 Pendiente, etc.).
 * Si el borrador intermedio ya tiene la §N objetivo sustancial, se publica aunque parezca MDD completo.
 */
export function resolveLiveDraftForScopedArchitectStream(
  nodeName: string | undefined,
  draft: string,
  stableDraft: string,
): string {
  if (!nodeName || !SCOPED_ARCHITECT_STREAM_NODES.has(nodeName)) return draft;
  const scope = STREAM_NODE_TO_SCOPE[nodeName];
  if (!scope) return draft;

  const section = architectScopeSectionNumber(scope);
  if (section === 2 && draftHasSubstantialSection2(draft)) return draft;
  if (section === 3 && draftHasSubstantialSection3(draft)) return draft;
  if (section === 4 && draftHasPersistableSection4(draft)) return draft;

  if (looksLikeFullMddArchitectResponse(draft, scope)) {
    const stable = stableDraft.trim();
    if (!stable) return draft;
    if (section === 2 && draftHasSubstantialSection2(draft)) {
      return preserveSection2IfSubstantial(draft, stable);
    }
    if (section === 3 && draftHasSubstantialSection3(draft)) {
      return preserveSection3IfSubstantial(draft, stable);
    }
    if (section === 4 && draftHasPersistableSection4(draft)) {
      return preserveSection4IfSubstantial(draft, stable);
    }
    return stable;
  }
  return draft;
}

/** Feedback en español tras merge rechazado (reintento scoped único). */
export function formatScopedArchitectMergeRejectFeedback(
  section: 2 | 3 | 4,
  reason: "empty" | "placeholder" | "short" | "regression",
): string {
  const label =
    section === 2 ? "§2 Arquitectura y Stack" : section === 3 ? "§3 Modelo de Datos" : "§4 Contratos de API";
  const detail =
    reason === "placeholder"
      ? 'devolviste placeholder o "(Pendiente: Arquitecto)"'
      : reason === "short"
        ? "el cuerpo es demasiado corto (<80 caracteres)"
        : reason === "regression"
          ? "§4 regresó respecto al baseline"
          : "no se extrajo cuerpo usable";
  return (
    `REINTENTO OBLIGATORIO — ${label}: ${detail}. ` +
    `PROHIBIDO "Pendiente: Arquitecto"; escribe contenido técnico real **solo para ${label}** ahora.`
  );
}
