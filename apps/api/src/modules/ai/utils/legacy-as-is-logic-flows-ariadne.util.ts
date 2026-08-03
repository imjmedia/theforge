/**
 * Flujos de lógica AS-IS (etapa 1): mapeo determinista desde Ariadne `business_logic` / MDD §5.
 * Evita depender solo del LLM y documentos stub/changelog vacío.
 */

import {
  documentBodyWithoutChangelog,
  ensureDocumentChangelog,
  isChangelogOnlyDocument,
} from "@theforge/shared-types";
import { extractLegacyMddEvidencePayload } from "../../theforge/legacy-mdd-v1-markdown.util.js";
import {
  extractSection5Services,
  extractServicesFromSection5,
  type MddSection5ServiceRow,
} from "./legacy-as-is-logic-flows.util.js";

const LOGIC_FLOWS_MIN_BODY = 80;

/** True cuando el markdown no sirve como entregable (vacío, solo changelog, section-merge stub). */
export function isLogicFlowsInsufficientContent(content: string | null | undefined): boolean {
  const trimmed = (content ?? "").trim();
  if (trimmed.length < LOGIC_FLOWS_MIN_BODY) return true;
  if (isChangelogOnlyDocument(trimmed, LOGIC_FLOWS_MIN_BODY)) return true;
  const body = documentBodyWithoutChangelog(trimmed);
  if (body.length < LOGIC_FLOWS_MIN_BODY) return true;
  if (/section merge|Sin contenido aplicable/i.test(body) && body.length < 200) return true;
  return false;
}

function rowsFromBusinessLogicJson(raw: unknown): MddSection5ServiceRow[] {
  if (!Array.isArray(raw) || raw.length === 0) return [];
  const rows: MddSection5ServiceRow[] = [];
  for (const row of raw) {
    if (!row || typeof row !== "object") continue;
    const o = row as Record<string, unknown>;
    const service = typeof o.service === "string" ? o.service.trim() : "";
    if (!service) continue;
    const deps = Array.isArray(o.dependencies)
      ? o.dependencies.map((d) => String(d)).join("; ")
      : typeof o.dependencies === "string"
        ? o.dependencies.trim()
        : undefined;
    rows.push({ service, dependencies: deps || undefined });
  }
  return rows;
}

function extractBusinessLogicTableFromCodebaseMarkdown(md: string): MddSection5ServiceRow[] {
  const section =
    md.match(/###\s+Lógica de negocio\s*\n([\s\S]*?)(?=\n###\s|\n##\s|$)/i)?.[1] ?? "";
  if (!section.trim() || /_Sin servicios/i.test(section)) return [];
  return extractServicesFromSection5(section);
}

/** Filas de servicio desde JSON Ariadne, tabla markdown o MDD §5. */
export function extractAriadneBusinessLogicRows(input: {
  codebaseDoc?: string | null;
  mddMarkdown?: string | null;
}): MddSection5ServiceRow[] {
  const doc = input.codebaseDoc?.trim();
  if (doc) {
    const payload = extractLegacyMddEvidencePayload(doc);
    const fromJson = rowsFromBusinessLogicJson(payload?.business_logic);
    if (fromJson.length) return fromJson;
    const fromTable = extractBusinessLogicTableFromCodebaseMarkdown(doc);
    if (fromTable.length) return fromTable;
  }
  const mdd = input.mddMarkdown?.trim();
  if (mdd) {
    const fromMdd = extractSection5Services(mdd);
    if (fromMdd.length) return fromMdd;
  }
  return [];
}

export function isLegacyAsIsLogicFlowsDeterministicEnabled(): boolean {
  const v = process.env.LEGACY_AS_IS_LOGIC_FLOWS_DETERMINISTIC?.trim().toLowerCase();
  if (v === "0" || v === "false" || v === "off" || v === "no") return false;
  return true;
}

/** Documento mínimo válido (≥80 chars cuerpo, changelog, mermaid por servicio). */
export function buildMinimalLogicFlowsFromBusinessLogic(
  services: MddSection5ServiceRow[],
  options?: { sourceLabel?: string },
): string {
  if (!services.length) return "";
  const label = options?.sourceLabel ?? "Ariadne business_logic / MDD §5";
  const lines: string[] = [
    "# Flujos de lógica",
    "",
    `> Documento AS-IS derivado de **${label}** (mapeo determinista).`,
    "",
  ];
  let n = 1;
  for (const s of services) {
    const safeName = s.service.replace(/"/g, "'");
    lines.push(`## Flujo ${n}: ${s.service}`, "");
    lines.push(`**Servicio:** ${s.service}`);
    if (s.dependencies?.trim()) {
      lines.push(`**Dependencias (paths):** ${s.dependencies.trim()}`);
    }
    lines.push(
      "",
      "```mermaid",
      "flowchart LR",
      "  Cliente --> API",
      `  API --> Svc["${safeName}"]`,
      "```",
      "",
      "- Entrada vía contrato API en MDD §4 (o CRUD Strapi estándar si no hay ruta custom).",
      "- Lógica del servicio según evidencia Ariadne indexada.",
      "",
    );
    n += 1;
  }
  lines.push(
    "## Cumplimiento con el MDD",
    "",
    `- Servicios documentados: **${services.length}** (1:1 desde ${label}).`,
    "- Ampliar pasos internos con LLM solo donde haga falta.",
    "",
  );
  return ensureDocumentChangelog(lines.join("\n"), {
    initialDescription: "Creación inicial de Flujos de lógica (mapeo Ariadne business_logic)",
  });
}

export function resolveLegacyAsIsLogicFlowsDeterministic(input: {
  codebaseDoc?: string | null;
  mddMarkdown: string;
}): string | null {
  if (!isLegacyAsIsLogicFlowsDeterministicEnabled()) return null;
  const rows = extractAriadneBusinessLogicRows(input);
  if (!rows.length) return null;
  const doc = buildMinimalLogicFlowsFromBusinessLogic(rows);
  return isLogicFlowsInsufficientContent(doc) ? null : doc;
}
