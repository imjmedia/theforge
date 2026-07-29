import {
  checkBlueprintApiTableFormat,
  checkBlueprintDataModelVsMdd,
  checkBlueprintSectionHeaders,
  checkBlueprintSelfContained,
  checkBlueprintSpanishQuality,
  checkBlueprintTableFormat,
  checkBlueprintVsMdd,
  extractEntities,
  extractSection,
  getMissingBlueprintStackKeywords,
  type ConformanceResult,
} from "./conformance.service.js";

export interface BlueprintQualityChecks {
  entity: ConformanceResult;
  section: ConformanceResult;
  apiTable: ConformanceResult;
  spanish: ConformanceResult;
  selfContained: ConformanceResult;
  generalTable: ConformanceResult;
  vsMdd: ConformanceResult;
}

export function runBlueprintQualityChecks(
  mddContent: string,
  blueprintContent: string,
): BlueprintQualityChecks {
  return {
    entity: checkBlueprintDataModelVsMdd(mddContent, blueprintContent),
    section: checkBlueprintSectionHeaders(blueprintContent),
    apiTable: checkBlueprintApiTableFormat(blueprintContent),
    spanish: checkBlueprintSpanishQuality(blueprintContent),
    selfContained: checkBlueprintSelfContained(blueprintContent),
    generalTable: checkBlueprintTableFormat(blueprintContent),
    vsMdd: checkBlueprintVsMdd(mddContent, blueprintContent),
  };
}

export function collectBlueprintQualityGaps(checks: BlueprintQualityChecks): string[] {
  return [
    ...checks.entity.gaps,
    ...checks.section.gaps,
    ...checks.apiTable.gaps,
    ...checks.spanish.gaps,
    ...checks.selfContained.gaps,
    ...checks.generalTable.gaps,
  ];
}

/** Gaps que justifican reintento LLM (autocontenido es soft — repair programático basta). */
export function collectBlueprintHardQualityGaps(checks: BlueprintQualityChecks): string[] {
  return [
    ...checks.entity.gaps,
    ...checks.section.gaps,
    ...checks.apiTable.gaps,
    ...checks.spanish.gaps,
    ...checks.generalTable.gaps,
    ...checks.vsMdd.gaps,
  ];
}

/** Feedback conciso para un reintento LLM tras verificación automática. */
export function buildBlueprintQualityRetryFeedback(checks: BlueprintQualityChecks): string {
  const entityNames = checks.entity.gaps
    .map((g) => g.match(/"([^"]+)"/)?.[1])
    .filter(Boolean)
    .join(", ");
  const otherIssues: string[] = [];
  if (checks.section.gaps.length) otherIssues.push(`${checks.section.gaps.length} secciones faltan`);
  if (checks.generalTable.gaps.length) {
    otherIssues.push(`${checks.generalTable.gaps.length} tablas mal formateadas`);
  }
  if (checks.spanish.gaps.length) otherIssues.push(`${checks.spanish.gaps.length} errores de español`);
  if (checks.selfContained.gaps.length) otherIssues.push("referencias al MDD");
  if (checks.apiTable.gaps.length) otherIssues.push("tabla API incompleta o mal formateada");
  const stackGaps = checks.vsMdd.gaps.filter((g) => g.startsWith("Stack MDD menciona"));
  if (stackGaps.length) {
    const names = stackGaps
      .map((g) => g.match(/"([^"]+)"/)?.[1])
      .filter(Boolean)
      .join(", ");
    otherIssues.push(
      names
        ? `tecnologías §2 sin nombrar: ${names}`
        : `${stackGaps.length} tecnologías §2 sin nombrar en el Blueprint`,
    );
  }
  const otherSummary = otherIssues.length ? `; además: ${otherIssues.join(", ")}` : "";
  if (entityNames) {
    return (
      `Faltan las siguientes entidades del MDD §3 en el Blueprint (DEBES incluirlas como cabeceras ### o viñetas -): ${entityNames}.${otherSummary}`
    );
  }
  const all = collectBlueprintQualityGaps(checks);
  return all.slice(0, 8).join("; ");
}

/** Punto de inserción antes del checklist §8 o UI §9. */
export function findBlueprintRepairInsertIndex(blueprintContent: string): number {
  const anchor = blueprintContent.match(/\n#{2,3}\s*(?:8\.?\s*checklist|9\.?\s*UI\s+Design)/i);
  return anchor?.index ?? blueprintContent.length;
}

export function injectMissingBlueprintEntities(
  mddContent: string,
  blueprintContent: string,
): string {
  const section3 = extractSection(
    mddContent,
    /^#+\s*(?:3\.\s*)?(?:modelo\s+de\s+datos|datos\s*\/\s*entidades)/im,
  );
  if (section3.length <= 20) return blueprintContent;

  const mddEntities = extractEntities(section3);
  const blueprintEntities = extractEntities(blueprintContent);
  const missingNames: string[] = [];

  for (const e of mddEntities) {
    if (!e || e.length < 2) continue;
    const exactMatch = blueprintEntities.has(e);
    const partialMatch = Array.from(blueprintEntities).some(
      (b) => b.includes(e) || e.includes(b),
    );
    if (exactMatch || partialMatch) continue;
    const nameRegex = new RegExp(`\\b${e.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
    if (nameRegex.test(blueprintContent)) continue;
    missingNames.push(e);
  }

  if (missingNames.length === 0) return blueprintContent;

  const entityBlock =
    `\n\n### Cobertura del modelo (MDD §3) — entidades completadas automáticamente\n\n` +
    missingNames.map((n) => `### ${n}`).join("\n") +
    `\n\n`;
  const insertAt = findBlueprintRepairInsertIndex(blueprintContent);
  return blueprintContent.slice(0, insertAt) + entityBlock + blueprintContent.slice(insertAt);
}

const SECTION_REPAIR_BLOCKS: Array<{ patterns: RegExp[]; block: string }> = [
  {
    patterns: [/stack/i, /estructura/i, /tecnol/],
    block: "### Stack técnico (MDD §2)\n\n- Tecnologías nombradas en el MDD §2 (completado automáticamente).\n",
  },
  {
    patterns: [/persistencia/i, /datos/i, /modelo\s+de\s+datos/i],
    block: "### Persistencia y datos\n\n- Cobertura del modelo §3 en sección 2 o bloque de entidades.\n",
  },
  {
    patterns: [/contratos\s*api/i, /mapa\s+de\s+(?:rutas|contratos|api)/i, /api.*m[oó]dulos/i],
    block: "### Mapa de contratos API\n\n- Tabla Método | Ruta | Módulo alineada al MDD §4.\n",
  },
  {
    patterns: [/transversal/i, /pipeline/i, /componentes?/],
    block: "### Componentes transversales\n\n- Servicios compartidos según MDD §1/§2.\n",
  },
  {
    patterns: [/seguridad.*despliegue/i, /seguridad.*deploy/i, /seguridad.*auth/i],
    block: "### Seguridad en despliegue\n\n- TLS, secretos y auth según MDD §6.\n",
  },
  {
    patterns: [/riesgos/i, /mitigacion/i],
    block: "### Riesgos y mitigaciones\n\n- Trazabilidad breve a MDD §5.\n",
  },
  {
    patterns: [/plan.*implementaci[oó]n/i, /fases/i, /implementaci[oó]n/i],
    block: "### Plan de implementación\n\n- Fases ordenadas según dependencias del MDD.\n",
  },
];

export function injectMissingBlueprintSectionHeaders(blueprintContent: string): string {
  const sectionCheck = checkBlueprintSectionHeaders(blueprintContent);
  if (sectionCheck.ok) return blueprintContent;

  const headers = blueprintContent.match(/^#{2,3}\s+.+$/gm) ?? [];
  const missingBlocks: string[] = [];
  for (const { patterns, block } of SECTION_REPAIR_BLOCKS) {
    const found = headers.some((h) => patterns.some((p) => p.test(h)));
    if (!found) missingBlocks.push(block);
  }
  if (missingBlocks.length === 0) return blueprintContent;

  const repairBlock =
    `\n\n## Completado automáticamente (conformidad)\n\n${missingBlocks.join("\n")}\n`;
  const insertAt = findBlueprintRepairInsertIndex(blueprintContent);
  return blueprintContent.slice(0, insertAt) + repairBlock + blueprintContent.slice(insertAt);
}

export function injectMissingBlueprintStackKeywords(
  mddContent: string,
  blueprintContent: string,
): string {
  const missing = getMissingBlueprintStackKeywords(mddContent, blueprintContent);
  if (missing.length === 0) return blueprintContent;

  const stackBlock =
    `\n\n**Stack MDD §2 (completado automáticamente):** ${missing.join(", ")}\n`;
  const section1 = blueprintContent.match(/^#{1,2}\s+.*$/m);
  if (section1?.index !== undefined) {
    const afterTitle = blueprintContent.indexOf("\n", section1.index);
    const insertAt = afterTitle >= 0 ? afterTitle + 1 : section1.index + section1[0].length;
    return blueprintContent.slice(0, insertAt) + stackBlock + blueprintContent.slice(insertAt);
  }
  return stackBlock + blueprintContent;
}

/** Reparaciones deterministas tras la IA (entidades, stack §2, cabeceras obligatorias). */
export function repairBlueprintProgrammaticGaps(
  mddContent: string,
  blueprintContent: string,
): string {
  let out = injectMissingBlueprintEntities(mddContent, blueprintContent);
  out = injectMissingBlueprintStackKeywords(mddContent, out);
  out = injectMissingBlueprintSectionHeaders(out);
  return out;
}
