/**
 * @fileoverview Generación de diagramas de componentes Mermaid.
 */

/**
 * Diagrama de componentes propuesto (greenfield): Mermaid determinista desde §2–§4 del MDD canónico.
 */

import {
  mermaidBlockHasUsableStructure,
} from "../../engine/mdd-pre-render.js";
import { mddExcludesWebUiSurface } from "./mdd-sanitize/internal.js";

export type GreenfieldStackSignals = {
  frontend?: string;
  backend?: string;
  primaryDb?: string;
  graphDb?: string;
  cacheOrQueue?: string;
  tableCount: number;
  endpointCount: number;
  hasCypherGraph: boolean;
};

const LEGACY_EVIDENCE_MARKERS =
  /Evidencia \(MDD estructurado|legacy_mdd_v1|generate_legacy_documentation|Doc\. de partida/i;

function sanitizeMermaidId(raw: string): string {
  return raw
    .replace(/[^a-zA-Z0-9_]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 48) || "node";
}

function getSectionBody(
  draft: string,
  headingPattern: RegExp,
): { body: string; startIndex: number; endIndex: number } | null {
  const match = draft.match(headingPattern);
  if (!match) return null;
  const idx = draft.indexOf(match[0]);
  const sectionStart = idx + match[0].length;
  const rest = draft.slice(sectionStart).replace(/^\s*\n+/, "");
  const nextH2 = rest.search(/\n##\s+/);
  const body = nextH2 !== -1 ? rest.slice(0, nextH2).trim() : rest.trim();
  const endIndex = nextH2 !== -1 ? sectionStart + nextH2 : draft.length;
  return { body, startIndex: sectionStart, endIndex };
}

function firstMatchLabel(text: string, patterns: Array<{ re: RegExp; label: string }>): string | undefined {
  for (const { re, label } of patterns) {
    if (re.test(text)) return label;
  }
  return undefined;
}

function countCreateTables(text: string): number {
  return (text.match(/\bCREATE\s+TABLE\b/gi) ?? []).length;
}

function countApiEndpoints(section4Body: string, fullDraft: string): number {
  const seen = new Set<string>();
  for (const line of section4Body.split("\n")) {
    const t = line.trim();
    if (!t.startsWith("|")) continue;
    if (/^\|\s*[-:]+\s*\|/.test(t)) continue;
    if (/^\|\s*(Método|Method|Ruta|Route)\s*\|/i.test(t)) continue;
    const tableMatch = t.match(/^\|\s*(GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD)\s*\|\s*(\S+)/i);
    if (tableMatch) seen.add(`${tableMatch[1]!.toUpperCase()} ${tableMatch[2]}`);
  }
  for (const m of section4Body.matchAll(/^###\s+(GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD)\s+(\S+)/gim)) {
    seen.add(`${m[1]!.toUpperCase()} ${m[2]}`);
  }
  if (seen.size === 0) {
    for (const m of fullDraft.matchAll(/^###\s+(GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD)\s+(\S+)/gim)) {
      seen.add(`${m[1]!.toUpperCase()} ${m[2]}`);
    }
  }
  return seen.size;
}

const FRONTEND_PATTERNS = [
  { re: /next\.?\s*js/i, label: "Next.js" },
  { re: /\breact\b/i, label: "React" },
  { re: /\bvue\b/i, label: "Vue" },
  { re: /\bangular\b/i, label: "Angular" },
  { re: /\bsvelte\b/i, label: "Svelte" },
];

const BACKEND_PATTERNS = [
  { re: /\bnestjs\b/i, label: "NestJS" },
  { re: /\bexpress\b/i, label: "Express" },
  { re: /\bfastapi\b/i, label: "FastAPI" },
  { re: /\bdjango\b/i, label: "Django" },
  { re: /\bstrapi\b/i, label: "Strapi" },
  { re: /\bspring\b/i, label: "Spring" },
  { re: /\blaravel\b/i, label: "Laravel" },
];

const DB_PATTERNS = [
  { re: /postgresql|postgres/i, label: "PostgreSQL" },
  { re: /\bmysql\b|\bmariadb\b/i, label: "MySQL" },
  { re: /\bmongodb\b|\bmongo\b/i, label: "MongoDB" },
  { re: /\bsqlite\b/i, label: "SQLite" },
];

const GRAPH_PATTERNS = [
  { re: /falkordb|falkor/i, label: "FalkorDB" },
  { re: /\bneo4j\b/i, label: "Neo4j" },
];

const CACHE_QUEUE_PATTERNS = [
  { re: /\bbullmq\b/i, label: "BullMQ" },
  { re: /\bredis\b/i, label: "Redis" },
  { re: /rabbitmq/i, label: "RabbitMQ" },
  { re: /\bkafka\b/i, label: "Kafka" },
];

/** Broker explícito en tabla §2 (evita falso BullMQ por `@nestjs/bull` en Circuit Breaker). */
function resolveMessageBrokerLabel(section2Body: string): string | undefined {
  const tableRow = section2Body.match(
    /\|\s*(?:\*\*)?(?:Message\s+Broker|Cola|Broker)(?:\*\*)?\s*\|\s*([^|\n]+)/i,
  )?.[1];
  if (tableRow) {
    const cell = tableRow.trim();
    if (/rabbitmq/i.test(cell)) return "RabbitMQ";
    if (/\bkafka\b/i.test(cell)) return "Kafka";
    if (/\bbullmq\b/i.test(cell)) return "BullMQ";
  }
  if (/rabbitmq/i.test(section2Body) && !/\bbullmq\b/i.test(section2Body)) return "RabbitMQ";
  return firstMatchLabel(section2Body, CACHE_QUEUE_PATTERNS);
}

function section2HasDetailedComponentDiagram(section2Body: string): boolean {
  if (!/```mermaid/i.test(section2Body) || !/subgraph/i.test(section2Body)) return false;
  return (
    /###\s*2\.\d+\s*Diagrama de componentes/i.test(section2Body) ||
    /Microservicios|Auth Service|Kong|RabbitMQ|API Gateway/i.test(section2Body)
  );
}

/** True si §2 ya tiene un diagrama de componentes Mermaid usable (aristas o erDiagram). */
export function section2HasValidComponentDiagram(section2Body: string): boolean {
  if (!section2HasDetailedComponentDiagram(section2Body)) return false;
  const blocks = section2Body.match(/```mermaid\s*([\s\S]*?)```/gi) ?? [];
  if (blocks.length === 0) return false;
  for (const block of blocks) {
    const inner = block.replace(/^```mermaid\s*/i, "").replace(/```$/i, "").trim();
    if (!mermaidBlockHasUsableStructure(inner)) return false;
  }
  return true;
}

const NO_UI_SURFACE_PATTERN =
  /(?:sin|no)\s+(?:dashboard|frontend|ui|interfaz|pantalla|panel\s+web)|(?:mvp|fase\s*1)[^\n]{0,120}(?:sin|no\s+incluye|excluye|fuera\s+de)\s+(?:dashboard|frontend|ui|panel\s+web)|(?:panel|dashboard)\s+web[^\n]{0,40}fuera\s+del\s+alcance|fuera\s+del\s+alcance[^\n]{0,40}(?:mvp|panel\s+web|dashboard)|solo\s+APIs?\s+y\s+CLI|(?:panel|dashboard)\s+web\s+(?:fuera|excluido)|api[\s-]?only|mvp\s+api|cli[\s-]?only|solo\s+api|backend\s+only/i;

function section2ExcludesUiSurface(section2Body: string): boolean {
  return NO_UI_SURFACE_PATTERN.test(section2Body);
}

/** Extrae señales de stack y volumen desde un MDD greenfield canónico. */
export function parseGreenfieldMddSignals(draft: string): GreenfieldStackSignals | null {
  const trimmed = (draft ?? "").trim();
  if (trimmed.length < 200) return null;
  if (LEGACY_EVIDENCE_MARKERS.test(trimmed)) return null;
  if (!/^##\s*2\.\s*Arquitectura/im.test(trimmed)) return null;

  const section2 = getSectionBody(trimmed, /^##\s*2\.\s*Arquitectura[^\n]*/im);
  const section3 = getSectionBody(trimmed, /^##\s*3\.\s*Modelo\s+(?:de\s+)?datos/im);
  const section4 = getSectionBody(trimmed, /^##\s*4\.\s*Contratos\s+de\s+API/im);
  if (!section2?.body || section2.body.length < 40) return null;
  if (/^\s*\(Pendiente\)\s*$/i.test(section2.body)) return null;

  const stackText = [section2.body, section3?.body ?? "", section4?.body ?? ""].join("\n");
  const uiExcluded = section2ExcludesUiSurface(section2.body);
  const frontend = uiExcluded ? undefined : firstMatchLabel(section2.body, FRONTEND_PATTERNS);
  const backend = firstMatchLabel(section2.body, BACKEND_PATTERNS);
  const primaryDb = firstMatchLabel(stackText, DB_PATTERNS);
  const graphDb = firstMatchLabel(stackText, GRAPH_PATTERNS);
  const cacheOrQueue = resolveMessageBrokerLabel(section2.body);
  const hasCypherGraph =
    /```cypher/i.test(section3?.body ?? "") ||
    /```(?:text|plaintext)[\s\S]*?(?:CREATE|MERGE)\s*\(/i.test(section3?.body ?? "") ||
    /\bgraph\s+TD\b/i.test(section3?.body ?? "");

  return {
    frontend,
    backend,
    primaryDb,
    graphDb: graphDb ?? (hasCypherGraph ? "Grafo" : undefined),
    cacheOrQueue,
    tableCount: countCreateTables(section3?.body ?? ""),
    endpointCount: countApiEndpoints(section4?.body ?? "", trimmed),
    hasCypherGraph,
  };
}

export function buildProposedComponentDiagramMermaid(signals: GreenfieldStackSignals): string | null {
  const lines: string[] = ["flowchart TB"];
  const edges: string[] = [];

  const feLabel = signals.frontend ?? "Frontend";
  const beLabel = signals.backend ?? "Backend";
  const dbLabel = signals.primaryDb ?? "Base de datos";
  const apiLabel =
    signals.endpointCount > 0 ? `REST · ${signals.endpointCount} endpoints` : "REST API";
  const tableLabel = signals.tableCount > 0 ? `${signals.tableCount} tablas` : "Persistencia";

  if (signals.frontend && signals.backend) {
    const feId = sanitizeMermaidId(`fe_${feLabel}`);
    const beId = sanitizeMermaidId(`be_${beLabel}`);
    lines.push(`  subgraph ${feId}["${feLabel} · Cliente"]`);
    lines.push("    FE_UI[Pages / Components]");
    lines.push("    FE_STATE[State / Hooks]");
    lines.push("    FE_CLIENT[API Client]");
    lines.push("  end");
    lines.push(`  subgraph ${beId}["${beLabel} · Servidor"]`);
    lines.push(`    BE_API["${apiLabel}"]`);
    lines.push("    BE_DOMAIN[Services / Domain]");
    if (signals.primaryDb) lines.push(`    BE_SQL[("${dbLabel} · ${tableLabel}")]`);
    if (signals.graphDb) lines.push(`    BE_GRAPH[("${signals.graphDb}")]`);
    lines.push("  end");
    edges.push("  FE_UI --> FE_STATE");
    edges.push("  FE_STATE --> FE_CLIENT");
    edges.push("  FE_CLIENT -->|HTTP| BE_API");
    edges.push("  BE_API --> BE_DOMAIN");
    if (signals.primaryDb) edges.push("  BE_DOMAIN --> BE_SQL");
    if (signals.graphDb) edges.push("  BE_DOMAIN --> BE_GRAPH");
  } else if (signals.backend) {
    const beId = sanitizeMermaidId(`be_${beLabel}`);
    lines.push(`  subgraph ${beId}["${beLabel}"]`);
    lines.push(`    API["${apiLabel}"]`);
    lines.push("    SVC[Services / Domain]");
    if (signals.primaryDb) lines.push(`    SQL[("${dbLabel} · ${tableLabel}")]`);
    if (signals.graphDb) lines.push(`    GRAPH[("${signals.graphDb}")]`);
    lines.push("  end");
    edges.push("  API --> SVC");
    if (signals.primaryDb) edges.push("  SVC --> SQL");
    if (signals.graphDb) edges.push("  SVC --> GRAPH");
  } else if (signals.frontend) {
    const feId = sanitizeMermaidId(`fe_${feLabel}`);
    lines.push(`  subgraph ${feId}["${feLabel} · SPA"]`);
    lines.push("    UI[Pages / Components]");
    lines.push("    CLIENT[API Client]");
    lines.push("  end");
    lines.push('  EXT["Backend / BaaS externo"]');
    edges.push("  UI --> CLIENT");
    edges.push("  CLIENT -->|HTTP| EXT");
  } else {
    lines.push('  APP["Aplicación propuesta"]');
    if (signals.primaryDb) lines.push(`  DB[("${dbLabel} · ${tableLabel}")]`);
    if (signals.graphDb) lines.push(`  GRAPH[("${signals.graphDb}")]`);
    edges.push("  APP --> DB");
    if (signals.graphDb) edges.push("  APP --> GRAPH");
  }

  if (signals.cacheOrQueue) {
    const auxId = sanitizeMermaidId(signals.cacheOrQueue);
    lines.push(`  ${auxId}["${signals.cacheOrQueue}"]`);
    const target =
      signals.backend && signals.frontend
        ? "BE_DOMAIN"
        : signals.backend
          ? "SVC"
          : signals.frontend
            ? "CLIENT"
            : "APP";
    edges.push(`  ${target} --> ${auxId}`);
  }

  if (edges.length) lines.push(...edges);
  return lines.length > 1 ? lines.join("\n") : null;
}

export function formatProposedComponentDiagramMarkdown(
  mermaid: string,
  options?: { includeNote?: boolean },
): string {
  const note =
    "_Propuesta derivada de §2–§4: capas inferidas del stack, entidades SQL y contratos API documentados (determinista, sin servicios inventados)._";
  const block = `### Diagrama de componentes propuesto\n\n\`\`\`mermaid\n${mermaid}\n\`\`\``;
  if (options?.includeNote === false) return `${block}\n`;
  return `${block}\n\n${note}`;
}

export function isMddProposedComponentDiagramEnabled(): boolean {
  const v = process.env.MDD_PROPOSED_COMPONENT_DIAGRAM?.trim().toLowerCase();
  if (v === undefined || v === "") return true;
  return !["0", "false", "off", "no"].includes(v);
}

function hasProposedComponentDiagramSection(draft: string): boolean {
  return /###\s+Diagrama de componentes propuesto/i.test(draft);
}

/** Diagrama propuesto con arista BE_DOMAIN huérfana (nodo renombrado a SVC). */
export function proposedComponentDiagramNeedsRepair(mermaid: string): boolean {
  if (!/BE_DOMAIN\s*-->/.test(mermaid)) return false;
  return !/\bBE_DOMAIN\s*\[/.test(mermaid);
}

function extractProposedComponentDiagramMermaid(draft: string): string | null {
  const match = draft.match(
    /###\s+Diagrama de componentes propuesto[\s\S]*?```mermaid\n([\s\S]*?)```/i,
  );
  return match?.[1]?.trim() ?? null;
}

function replaceProposedComponentDiagramSection(
  draft: string,
  mermaid: string,
  options?: { includeNote?: boolean },
): string {
  const replacement = formatProposedComponentDiagramMarkdown(mermaid, options);
  if (!hasProposedComponentDiagramSection(draft)) {
    const section2Match = draft.match(/^##\s*2\.\s*Arquitectura[^\n]*/im);
    if (!section2Match) return draft;
    const s2Start = section2Match.index ?? 0;
    const s3Match = /^##\s*3\.\s*/gim;
    s3Match.lastIndex = s2Start + 1;
    const s3 = s3Match.exec(draft);
    const s2End = s3 ? s3.index : draft.length;
    return draft.slice(0, s2End) + `\n\n${replacement}\n` + draft.slice(s2End);
  }
  return draft.replace(
    /###\s+Diagrama de componentes propuesto[\s\S]*?(?=\n##\s|\n#\s|$)/i,
    `${replacement.trimEnd()}\n`,
  );
}

function hasLegacyComponentDiagramSection(draft: string): boolean {
  return /(?:^|\n)##?\s+Diagrama de Componentes\s*(?:\n|$)/i.test(draft);
}

/** Inserta o repara ### Diagrama de componentes propuesto al final de §2. */
export function injectProposedComponentDiagramIntoSection2(draft: string): string {
  if (!isMddProposedComponentDiagramEnabled()) return draft;
  const mdd = (draft ?? "").trim();
  if (!mdd || hasLegacyComponentDiagramSection(mdd)) return draft;

  const section2 = getSectionBody(mdd, /^##\s*2\.\s*Arquitectura[^\n]*/im);
  if (section2?.body && section2HasValidComponentDiagram(section2.body)) {
    return draft;
  }

  const existingMermaid = hasProposedComponentDiagramSection(mdd)
    ? extractProposedComponentDiagramMermaid(mdd)
    : null;
  if (existingMermaid && !proposedComponentDiagramNeedsRepair(existingMermaid)) {
    return draft;
  }

  const signals = parseGreenfieldMddSignals(mdd);
  if (!signals) return draft;

  const mermaid = buildProposedComponentDiagramMermaid(signals);
  if (!mermaid) return draft;

  const includeNote = !mddExcludesWebUiSurface(mdd);
  return replaceProposedComponentDiagramSection(mdd, mermaid, { includeNote });
}
