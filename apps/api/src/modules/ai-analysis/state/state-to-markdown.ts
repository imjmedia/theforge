import type { DBGAState } from "./dbga-state.schema.js";

const AGENT_LABELS: Record<string, string> = {
  scout: "Market Scout (investigación)",
  auditor: "Tech Auditor (análisis técnico)",
  critic: "Critic (validación)",
  synthesis: "Synthesis (documento final)",
  // MDD pipeline
  manager: "Manager (entrevista)",
  ask_initial_topic: "Manager (pregunta inicial)",
  plan_approval: "Aprobación del plan",
  executor: "Executor (plan paso a paso)",
  clarifier: "Clarificador (MDD)",
  software_architect: "Arquitecto de Software",
  stack_architect: "Arquitecto de Stack (§2)",
  data_model: "Experto en Modelo de Datos (§3)",
  api_contracts: "Experto en Contratos API (§4)",
  architect_critic: "Crítico de arquitectura (MDD)",
  format_after_architect: "Formateador (post-arquitectura)",
  security: "Arquitecto de Seguridad",
  integration: "Ingeniero de Integración",
  security_integration: "Seguridad + Integración (paralelo)",
  tail_parallel: "Lógica + Seguridad + Infra (paralelo)",
  format_sec_int: "Formateador (seguridad e integración)",
  format_after_redactor: "Formateador (post-redacción)",
  llm_formatter: "Formateador LLM (deprecated)",
  cross_consistency_checker: "Consistencia cruzada (MDD)",
  diagram_injector: "Inyector de diagramas (MDD)",
  prepare_output: "Preparación de salida (MDD)",
  structured_hydrator: "Hidratación estructurada (MDD)",
  section5: "Ingeniero de Lógica (§5)",
  redactor: "Redactor (MDD)",
  // "auditor" ya existe para DBGA; para MDD el nodo se llama "auditor" pero el mensaje es distinto
};

const MDD_AUDITOR_LABEL = "Auditor (calidad MDD)";

/**
 * Escanea una línea para encontrar la posición del PRIMER `{` o `[` que NO
 * esté dentro de un string JSON. Retorna el índice y el tipo ('object'|'array'),
 * o null si no encuentra ninguno.
 */
function findFirstJsonStart(line: string): { idx: number; type: "object" | "array" } | null {
  let inStr = false;
  let escaped = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (escaped) { escaped = false; continue; }
    if (c === "\\") { escaped = true; continue; }
    if (c === '"') { inStr = !inStr; continue; }
    if (!inStr) {
      if (c === "{") return { idx: i, type: "object" };
      if (c === "[") return { idx: i, type: "array" };
    }
  }
  return null;
}

/**
 * Calcula la profundidad de braces/paréntesis cuadrados JSON en un texto,
 * IGNORANDO caracteres dentro de strings (incluye escapes \").
 * Retorna un delta de profundidad para la línea completa.
 */
function braceDelta(line: string, open: "{" | "[", close: "}" | "]"): number {
  let delta = 0;
  let inStr = false;
  let escaped = false;
  for (const ch of line) {
    if (escaped) { escaped = false; continue; }
    if (ch === "\\") { escaped = true; continue; }
    if (ch === '"') { inStr = !inStr; continue; }
    if (inStr) continue;
    if (ch === open) delta++;
    else if (ch === close) delta--;
  }
  return delta;
}

/**
 * Post-procesa el markdown para asegurar que bloques JSON/array sueltos
 * (sin ```json o ```) tengan code fences. Detecta bloques que inician con
 * `{` o `[` (incluso en medio de la línea) y los envuelve en ```json...```.
 */
export function ensureJsonCodeFences(markdown: string): string {
  const lines = markdown.split("\n");
  const result: string[] = [];
  let insideFence = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^```/.test(line.trim())) {
      insideFence = !insideFence;
      result.push(line);
      continue;
    }
    if (insideFence) {
      result.push(line);
      continue;
    }

    // Buscar primer `{` o `[` fuera de strings en esta línea
    const start = findFirstJsonStart(line);
    if (!start) {
      result.push(line);
      continue;
    }
    const openChar = start.type === "object" ? "{" : "[";
    const closeChar = start.type === "object" ? "}" : "]";

    // Buscar el cierre del bloque (brace balanceado, ignorando strings)
    let depth = 0;
    let endIdx = i;
    let started = false;
    let allLinesBlock: string[] = [];

    for (let j = i; j < lines.length; j++) {
      const l = lines[j];
      if (/^```/.test(l.trim())) break;

      // Remover prefijos markdown comunes para el cálculo de profundidad
      // (> , - , * , \d+\. ) PERO solo al inicio de la línea
      const clean = l.replace(/^(> ?|[-*+] |\d+\.\s)/, "");

      const dd = braceDelta(clean, openChar, closeChar);
      depth += dd;
      if (dd !== 0) started = true;

      allLinesBlock.push(clean);

      if (started && depth === 0) {
        endIdx = j;
        break;
      }
    }

    if (started && depth === 0 && endIdx > i) {
      // Intentar parsear como JSON — usar el bloque limpio de prefijos
      const jsonBlock = allLinesBlock.join("\n");
      try {
        JSON.parse(jsonBlock);
        // Éxito — fencearlo
        result.push("```json");
        // Las líneas originales (con prefijos) se ponen dentro del fence
        const originalLines = lines.slice(i, endIdx + 1).join("\n");
        result.push(originalLines);
        result.push("```");
        i = endIdx;
        continue;
      } catch {
        // No es JSON válido, seguir como está
      }
    }

    result.push(line);
  }
  // Post-procesamiento: normalizar headings que el LLM dejó indentados o sin espacio
  // después de ###. CommonMark trata líneas con 4+ espacios como código indentado,
  // y "###texto" no es un heading válido (necesita "### texto").
  const cleaned = result.join("\n").replace(
    /^( {4,})(#{1,6})(\S.*)$/gm,
    (_, _spaces, hashes, rest) => `${hashes} ${rest.trimStart()}`,
  );
  return cleaned;
}

/**
 * Genera el documento markdown final del DBGA a partir del estado del grafo.
 * Incluye idea, competidores, tech stack, pain points y el gap analysis (markdown del Synthesis).
 */
export function stateToMarkdown(state: DBGAState): string {
  const sections: string[] = [];

  sections.push("# Domain Benchmark & Gap Analysis\n");
  sections.push(`**Idea:** ${state.rawIdea || "(sin especificar)"}\n`);

  if (state.competitors?.length > 0) {
    sections.push("## Competidores de referencia\n");
    for (const c of state.competitors) {
      sections.push(`- **${c.name}** — ${c.url}`);
      if (c.uvp) sections.push(`  - UVP: ${c.uvp}`);
      if (c.pricing) sections.push(`  - Precio: ${c.pricing}`);
      if (c.marketShare) sections.push(`  - Mercado: ${c.marketShare}`);
      sections.push("");
    }
  }

  if (state.techStackInsights?.length > 0) {
    sections.push("## Tech stack observado\n");
    state.techStackInsights.forEach((s) => sections.push(`- ${s}`));
    sections.push("");
  }

  if (state.userPainPoints?.length > 0) {
    sections.push("## Pain points del usuario\n");
    state.userPainPoints.forEach((p) => sections.push(`- ${p}`));
    sections.push("");
  }

  if (state.gapAnalysis?.trim()) {
    sections.push("---\n");
    sections.push(state.gapAnalysis.trim());
  } else {
    sections.push("---\n\n(Sin análisis de brechas generado.)");
  }

  return ensureJsonCodeFences(sections.join("\n").trim());
}

export function getAgentLabel(nodeName: string, context?: "mdd"): string {
  if (context === "mdd" && nodeName === "auditor") return MDD_AUDITOR_LABEL;
  return AGENT_LABELS[nodeName] ?? nodeName;
}
