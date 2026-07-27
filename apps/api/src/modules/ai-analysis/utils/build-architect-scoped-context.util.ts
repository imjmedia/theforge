/**
 * @fileoverview Contexto acotado para pasadas scoped del Arquitecto (F1 — sin full-MDD en prompt).
 */

import type { MDDStateType } from "../state/index.js";
import type { MddSoftwareArchitectScope } from "./mdd-architect-pipeline.util.js";
import { domainInventoryPromptBlock } from "./mdd-domain-prompt.util.js";
import {
  extractArquitecturaSectionBody,
  extractContextSectionBody,
  extractSection3Body,
} from "./mdd-sanitize/section-merge.js";

const SECTION1_SUMMARY_MAX = 1200;
const SECTION2_FALLBACK_MAX = 2200;

/** Resumen §1 para api_contracts (no inyectar cuerpo completo). */
export function summarizeContextSection1(body: string | null, maxChars = SECTION1_SUMMARY_MAX): string | null {
  const trimmed = (body ?? "").trim();
  if (!trimmed) return null;
  if (trimmed.length <= maxChars) return trimmed;
  const cut = trimmed.slice(0, maxChars);
  const lastNl = cut.lastIndexOf("\n");
  const safe = lastNl > maxChars * 0.6 ? cut.slice(0, lastNl) : cut;
  return `${safe.trim()}\n\n...(§1 truncado para contexto; no repetir en salida)`;
}

/** Extrae tablas GFM de §2 (stack); si no hay tabla, devuelve cuerpo acotado. */
export function extractStackTableFromSection2(section2Body: string | null): string | null {
  const body = (section2Body ?? "").trim();
  if (!body) return null;

  const lines = body.split("\n");
  const tables: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i] ?? "";
    const next = lines[i + 1] ?? "";
    if (/^\|/.test(line.trim()) && /^\|[\s\-:|]+\|/.test(next.trim())) {
      const tableLines = [line];
      i += 1;
      while (i < lines.length && /^\|/.test((lines[i] ?? "").trim())) {
        tableLines.push(lines[i]!);
        i += 1;
      }
      tables.push(tableLines.join("\n"));
      continue;
    }
    i += 1;
  }

  if (tables.length > 0) return tables.join("\n\n");
  if (body.length <= SECTION2_FALLBACK_MAX) return body;
  return `${body.slice(0, SECTION2_FALLBACK_MAX)}\n...(§2 truncado)`;
}

export type ArchitectScopedContextBlock = {
  /** Líneas de contexto (sin borrador completo). */
  lines: string[];
  /** Chars aproximados del contexto scoped (para métricas). */
  contextChars: number;
};

/**
 * Contexto mínimo por alcance scoped — el pipeline conserva §1–§N vía merge quirúrgico.
 * - stack: §1 + inventario
 * - data_model: §1+§2 + inventario + schema-composition
 * - api_contracts: resumen §1 + tabla §2 + SQL §3 (sin §5–§7)
 */
export async function buildArchitectScopedContext(
  state: MDDStateType,
  scope: Exclude<MddSoftwareArchitectScope, "full">,
): Promise<ArchitectScopedContextBlock> {
  const draft = (state.mddDraft ?? "").trim();
  const lines: string[] = [
    "**Contexto de referencia (NO repetir en salida; responde SOLO con el cuerpo de tu §N):**",
    "",
  ];

  const section1 = extractContextSectionBody(draft);
  const section2 = extractArquitecturaSectionBody(draft);
  const section3 = extractSection3Body(draft);
  const inventory = domainInventoryPromptBlock(state);

  if (scope === "stack") {
    if (section1) {
      lines.push("### §1 Contexto", "", section1, "");
    }
    if (inventory) {
      lines.push(inventory.trim(), "");
    }
  } else if (scope === "data_model") {
    if (section1) {
      lines.push("### §1 Contexto", "", section1, "");
    }
    if (section2) {
      lines.push("### §2 Arquitectura y Stack", "", section2, "");
    }
    if (inventory) {
      lines.push(inventory.trim(), "");
    }
    try {
      const { buildInventoryFromMddState } = await import("./mdd-domain-prompt.util.js");
      const { domainSchemaCompositionPromptBlock } = await import(
        "../../engine/compose-section3-from-inventory.util.js"
      );
      const { inventory: inv } = buildInventoryFromMddState(state);
      const schemaBlock = domainSchemaCompositionPromptBlock(inv, draft);
      if (schemaBlock) {
        lines.push(schemaBlock, "");
      }
    } catch {
      /* optional */
    }
  } else if (scope === "api_contracts") {
    const s1Summary = summarizeContextSection1(section1);
    const s2Table = extractStackTableFromSection2(section2);
    if (s1Summary) {
      lines.push("### §1 Contexto (resumen)", "", s1Summary, "");
    }
    if (s2Table) {
      lines.push("### §2 Stack (tabla / componentes)", "", s2Table, "");
    }
    if (section3) {
      lines.push("### §3 Modelo de Datos (SQL completo)", "", section3, "");
    }
  }

  const text = lines.join("\n");
  return { lines, contextChars: text.length };
}
