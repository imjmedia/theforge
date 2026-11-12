import {
  BrdTraceabilityItem,
  CrossDocumentGap,
  PlanningDocumentFields,
} from "./estimation.types.js";

/** @deprecated Usar {@link extractBrdTraceabilityItems}. */
export function extractBrdBusinessConcepts(brdText: string): string[] {
  return extractBrdTraceabilityItems(brdText).map((i) => i.label);
}

/** @deprecated Usar {@link extractBrdTraceabilityItems}. */
export function extractConcepts(text: string): Set<string> {
  return new Set(extractBrdBusinessConcepts(text));
}

const NOISE_WORDS = new Set([
  "necesidad",
  "necesidades",
  "objetivo",
  "objetivos",
  "alcance",
  "contexto",
  "resumen",
  "descripción",
  "descripcion",
  "introducción",
  "introduccion",
  "supuestos",
  "riesgos",
  "métricas",
  "metricas",
  "validación",
  "validacion",
  "demanda",
  "problema",
  "solución",
  "solucion",
  "usuario",
  "usuarios",
  "rol",
  "roles",
  "notas",
  "anexo",
  "anexos",
  "versión",
  "version",
  "fecha",
  "tabla",
  "sección",
  "seccion",
  "capacidad",
  "negocio",
  "nivel",
  "acceso",
  "notas",
  "definición",
  "definicion",
]);

const SKIP_H2 =
  /^(?:\d+\.\s*)?(?:contexto|pain points|problema y objetivos|usuarios y casos|l[ií]mites del alcance|fuera de alcance|supuestos|riesgos|m[eé]tricas|pendientes de validaci|registro de cambios|decision log|validaci[oó]n de demanda|impacto financiero|dentro del alcance|requisitos de experiencia)/i;

const RELEVANT_H2 =
  /^(?:\d+\.\s*)?(?:capacidades funcional|reglas de negocio|requisitos funcionales|flujos de negocio|definici[oó]n de entidades|criterios de aceptaci|matriz de permisos|requisitos de experiencia|pol[ií]ticas)/i;

/** H3 plantilla del outline BRD — no son ítems trazables por sí solos. */
const STRUCTURAL_H3 =
  /^(?:definici[oó]n de entidades(?: de negocio)?|f[óo]rmulas y umbrales|reglas de operaci[oó]n|matriz de permisos|flujos de negocio cr[ií]ticos|criterios de aceptaci[oó]n(?: de negocio)?(?: \(uat\))?|roles de negocio|casos de uso clave|objetivos comerciales|dentro del alcance|fuera del alcance|riesgos|m[eé]tricas de [ée]xito|validaci[oó]n de demanda|impacto financiero)/i;

const MDD_TRACE_SECTIONS = "§1 Contexto, §4 Contratos API y §5 Lógica";

function normalizeConcept(raw: string): string {
  return raw
    .replace(/\*\*/g, "")
    .replace(/^\d+\.?\s*/, "")
    .replace(/^[-*]\s*/, "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeKey(raw: string): string {
  return normalizeConcept(raw).toLowerCase();
}

function isNoiseConcept(concept: string): boolean {
  const t = concept.trim().toLowerCase();
  if (t.length < 8) return true;
  if (NOISE_WORDS.has(t)) return true;
  if (/^(?:dado|cuando|entonces)\s*$/i.test(t)) return true;
  if (/^\[object object\]$/i.test(t)) return true;
  const words = t.split(/\s+/).filter((w) => w.length > 2);
  if (words.length === 0) return true;
  if (words.length === 1 && words[0]!.length < 10) return true;
  if (STRUCTURAL_H3.test(t)) return true;
  return false;
}

function subsectionKind(sub: string): BrdTraceabilityItem["kind"] {
  const s = sub.toLowerCase();
  if (/entidades/.test(s)) return "entity";
  if (/f[óo]rmulas|umbrales/.test(s)) return "formula";
  if (/uat|criterios de aceptaci/.test(s)) return "uat";
  if (/permisos/.test(s)) return "permission";
  if (/flujos/.test(s)) return "flow";
  if (/reglas|pol[ií]ticas/.test(s)) return "rule";
  return "capability";
}

function parseEntityLabel(line: string): string | null {
  const bold = line.match(/^[-*]\s+\*\*([^*]+)\*\*/);
  if (bold?.[1]) return normalizeConcept(bold[1]);
  const plain = line.match(/^[-*]\s+([^:—|]+?)\s*[:\—–|]/);
  if (plain?.[1]) return normalizeConcept(plain[1]);
  const table = line.match(/^\|\s*\*?\*?([^*|]+?)\*?\*?\s*\|/);
  if (table?.[1] && !/^(?:entidad|concepto|definici)/i.test(table[1])) {
    return normalizeConcept(table[1]);
  }
  return null;
}

function pushItem(
  items: BrdTraceabilityItem[],
  seen: Set<string>,
  item: BrdTraceabilityItem,
): void {
  const key = `${item.kind}|${normalizeKey(item.label)}`;
  if (seen.has(key) || isNoiseConcept(item.label)) return;
  seen.add(key);
  items.push(item);
}

/**
 * Extrae ítems concretos del BRD: capacidades, entidades, fórmulas, UAT…
 * Ignora títulos H3 plantilla vacíos («Definición de entidades», «Fórmulas y umbrales»).
 */
export function extractBrdTraceabilityItems(brdText: string): BrdTraceabilityItem[] {
  const items: BrdTraceabilityItem[] = [];
  const seen = new Set<string>();
  const lines = (brdText ?? "").split("\n");
  let currentH2 = "";
  let currentH3 = "";
  let inRelevant = false;
  let currentKind: BrdTraceabilityItem["kind"] = "capability";

  for (const line of lines) {
    const h2 = line.match(/^##\s+(.+)/);
    if (h2) {
      currentH2 = normalizeConcept(h2[1] ?? "");
      currentH3 = "";
      if (SKIP_H2.test(currentH2)) {
        inRelevant = false;
        continue;
      }
      inRelevant = RELEVANT_H2.test(currentH2);
      continue;
    }

    if (!inRelevant) continue;

    const h3 = line.match(/^###\s+(.+)/);
    if (h3) {
      const title = normalizeConcept(h3[1] ?? "");
      currentH3 = title;
      currentKind = subsectionKind(title);
      if (!STRUCTURAL_H3.test(title) && !isNoiseConcept(title)) {
        pushItem(items, seen, {
          label: title.slice(0, 120),
          brdSection: currentH2,
          brdSubsection: title,
          kind: currentKind,
        });
      }
      continue;
    }

    if (/^(?:-\s*)?(?:dado|cuando|entonces)\s+/i.test(line)) {
      const c = normalizeConcept(line);
      if (!isNoiseConcept(c) && c.length >= 20) {
        pushItem(items, seen, {
          label: c.slice(0, 140),
          brdSection: currentH2,
          brdSubsection: currentH3 || undefined,
          kind: "uat",
        });
      }
      continue;
    }

    if (currentKind === "entity") {
      const entity = parseEntityLabel(line);
      if (entity && !isNoiseConcept(entity)) {
        pushItem(items, seen, {
          label: entity.slice(0, 80),
          brdSection: currentH2,
          brdSubsection: currentH3 || undefined,
          kind: "entity",
        });
        continue;
      }
    }

    const bullet = line.match(/^[-*]\s+(.+)/);
    if (bullet) {
      const raw = bullet[1] ?? "";
      const c = normalizeConcept(raw);
      if (!isNoiseConcept(c)) {
        pushItem(items, seen, {
          label: c.slice(0, 140),
          brdSection: currentH2,
          brdSubsection: currentH3 || undefined,
          kind: currentKind,
        });
      }
      continue;
    }

    const tableRow = line.match(/^\|\s*(.+?)\s*\|/);
    if (tableRow && currentKind === "permission") {
      const cells = line.split("|").map((c) => c.trim()).filter(Boolean);
      if (cells.length >= 2 && !/^(?:capacidad|rol|nivel)/i.test(cells[0]!)) {
        pushItem(items, seen, {
          label: `${cells[0]} → ${cells.slice(1, 3).join(" / ")}`.slice(0, 120),
          brdSection: currentH2,
          brdSubsection: currentH3 || undefined,
          kind: "permission",
        });
      }
    }
  }

  return items.slice(0, 40);
}

function extractMddSection(md: string, headingRe: RegExp): string {
  const m = headingRe.exec(md);
  if (m?.index == null) return "";
  const start = m.index;
  const rest = md.slice(start + 1);
  const next = rest.search(/^##\s+/m);
  const body = next >= 0 ? md.slice(start, start + 1 + next) : md.slice(start);
  return body.trim();
}

/** Corpus MDD donde debe reflejarse el negocio: §1 Contexto, §4 API, §5 Lógica. */
export function extractMddTraceabilityCorpus(mddText: string): string {
  const md = (mddText ?? "").trim();
  if (!md) return "";
  const parts = [
    extractMddSection(md, /^##\s*(?:1\.\s*)?(?:contexto\s+y\s+alcance|contexto\b)/im),
    extractMddSection(md, /^##\s*(?:4\.\s*)?(?:contratos\s+de\s+api|contratos\s+api|api\b)/im),
    extractMddSection(md, /^##\s*(?:5\.\s*)?(?:l[oó]gica|logic)/im),
  ].filter((p) => p.length > 0);
  return parts.length > 0 ? parts.join("\n\n") : md;
}

function tokenizeConceptWords(text: string): string[] {
  return text
    .toLowerCase()
    .split(/\s+/)
    .map((w) => w.replace(/^[^a-záéíóúñ0-9]+|[^a-záéíóúñ0-9]+$/gi, ""))
    .filter((w) => w.length > 0);
}

function extractKeywords(text: string): string[] {
  const lower = text.toLowerCase();
  const acronyms =
    lower.match(/\b[a-z]{2,4}\b/g)?.filter((w) => /^(?:usd|mxn|eur|erp|uat|iva|roi|kpi)$/.test(w)) ?? [];
  const tokens = tokenizeConceptWords(lower);
  const words = tokens.filter((w) => w.length > 3 && !NOISE_WORDS.has(w));
  if (words.length > 0) return [...new Set([...words, ...acronyms])];

  // Títulos H3 cortos («Objetivos de negocio») pierden todo al filtrar ruido — conservar tokens ≥3.
  const fallback = tokens.filter((w) => w.length >= 3);
  return [...new Set([...fallback, ...acronyms])];
}

function conceptCoverageDetail(
  concept: string,
  targetText: string,
): { ratio: number; matched: string[]; missing: string[] } {
  const normalized = normalizeConcept(concept).toLowerCase();
  const tgt = targetText.toLowerCase();

  if (normalized.length >= 8 && tgt.includes(normalized)) {
    return { ratio: 1, matched: [normalized], missing: [] };
  }

  const words = extractKeywords(concept);
  if (words.length === 0) return { ratio: 0, matched: [], missing: [] };

  const matched: string[] = [];
  const missing: string[] = [];
  for (const w of words) {
    if (tgt.includes(w)) matched.push(w);
    else missing.push(w);
  }
  return { ratio: matched.length / words.length, matched, missing };
}

const KIND_LABEL: Record<BrdTraceabilityItem["kind"], string> = {
  capability: "Capacidad",
  rule: "Regla",
  entity: "Entidad",
  formula: "Fórmula/umbral",
  uat: "UAT",
  permission: "Permiso",
  flow: "Flujo",
};

function brdLocation(item: BrdTraceabilityItem): string {
  if (item.brdSubsection) return `${item.brdSubsection} (${item.brdSection})`;
  return item.brdSection;
}

function buildGapHint(
  item: BrdTraceabilityItem,
  severity: CrossDocumentGap["severity"],
  target: string,
  missing: string[],
  matched: string[],
): string {
  const kind = KIND_LABEL[item.kind];
  const loc = brdLocation(item);
  const quote = item.label.length > 90 ? `${item.label.slice(0, 87)}…` : item.label;
  const missingStr = missing.slice(0, 6).join(", ");
  const matchedStr = matched.slice(0, 4).join(", ");

  if (severity === "missing") {
    return (
      `${kind} «${quote}» (BRD: ${loc}) no aparece en ${MDD_TRACE_SECTIONS} del MDD` +
      (missingStr ? `. Términos sin match: ${missingStr}` : ".") +
      `. Añádelo en §1 (contexto), §4 (API) o §5 (lógica).`
    );
  }

  return (
    `${kind} «${quote}» (BRD: ${loc}) tiene cobertura parcial en ${target}` +
    (missingStr ? `. Aún falta reflejar: ${missingStr}` : "") +
    (matchedStr ? ` (parcial: ${matchedStr})` : "") +
    `. Revisa ${MDD_TRACE_SECTIONS}.`
  );
}

/**
 * Trazabilidad BRD (negocio) → MDD / Spec (técnico).
 */
export function computeCrossDocumentConsistency(
  docs: PlanningDocumentFields,
): { score: number | null; gaps: CrossDocumentGap[] } {
  const brd = docs.brdContent?.trim() ?? "";
  const mdd = docs.mddContent?.trim() ?? "";
  const spec = docs.specContent?.trim() ?? "";

  const traceSource = brd || spec;
  if (!traceSource) {
    return { score: 50, gaps: [] };
  }

  const items = extractBrdTraceabilityItems(traceSource);
  if (items.length === 0) {
    return { score: brd ? 50 : null, gaps: [] };
  }

  const targets: Array<{ name: string; content: string }> = [];
  if (mdd) {
    targets.push({ name: "MDD", content: extractMddTraceabilityCorpus(mdd) });
  }

  if (targets.length === 0) {
    return { score: 50, gaps: [] };
  }

  const gaps: CrossDocumentGap[] = [];
  let totalChecks = 0;
  let coveredChecks = 0;

  for (const item of items) {
    totalChecks++;
    let bestTarget = targets[0]!.name;
    let bestRatio = 0;
    let bestMatched: string[] = [];
    let bestMissing: string[] = [];

    for (const tgt of targets) {
      const detail = conceptCoverageDetail(item.label, tgt.content);
      if (detail.ratio > bestRatio) {
        bestRatio = detail.ratio;
        bestTarget = tgt.name;
        bestMatched = detail.matched;
        bestMissing = detail.missing;
      }
    }

    if (bestRatio >= 0.4) {
      coveredChecks++;
    } else {
      const severity: CrossDocumentGap["severity"] = bestRatio >= 0.2 ? "partial" : "missing";
      gaps.push({
        from: brd ? "BRD" : "Spec",
        to: bestTarget,
        concept: item.label.slice(0, 120),
        severity,
        brdSection: item.brdSection,
        brdSubsection: item.brdSubsection,
        kind: item.kind,
        missingTerms: bestMissing.slice(0, 8),
        hint: buildGapHint(item, severity, bestTarget, bestMissing, bestMatched),
      });
    }
  }

  const score = totalChecks > 0 ? Math.round((coveredChecks / totalChecks) * 100) : 50;

  const seen = new Set<string>();
  const deduped: CrossDocumentGap[] = [];
  for (const g of gaps) {
    const key = `${g.kind}|${g.concept}`;
    if (!seen.has(key)) {
      seen.add(key);
      deduped.push(g);
    }
  }

  return { score, gaps: deduped.slice(0, 15) };
}
