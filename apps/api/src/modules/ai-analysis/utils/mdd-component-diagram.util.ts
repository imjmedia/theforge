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

export type DomainModuleSignal = {
  key: string;
  label: string;
  routeCount: number;
  tables: string[];
  fromSection2: boolean;
};

export type GreenfieldStackSignals = {
  frontend?: string;
  backend?: string;
  primaryDb?: string;
  graphDb?: string;
  cacheOrQueue?: string;
  tableCount: number;
  endpointCount: number;
  hasCypherGraph: boolean;
  domainModules: DomainModuleSignal[];
};

const MAX_DOMAIN_MODULES = 8;
const MIN_DOMAIN_MODULES_FOR_ENRICHED = 2;

const SKIP_ROUTE_DOMAIN = new Set([
  "health",
  "status",
  "ready",
  "live",
  "metrics",
  "swagger",
  "docs",
  "jwks",
  "openapi",
  "ping",
  "version",
  ".well-known",
]);

const AUTH_TABLE_NAMES = new Set([
  "users",
  "user",
  "sessions",
  "session",
  "roles",
  "role",
  "permissions",
  "permission",
  "refresh_tokens",
  "mfa_secrets",
  "user_roles",
  "user_application_roles",
  "application_roles",
  "oauth_clients",
  "api_keys",
  "login_attempts",
]);

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

/** Rutas HTTP únicas documentadas en §4 (tabla GFM + headings ### MÉTODO /ruta). */
export function extractApiRoutePaths(section4Body: string, fullDraft: string): string[] {
  const paths = new Set<string>();
  for (const line of section4Body.split("\n")) {
    const t = line.trim();
    if (!t.startsWith("|")) continue;
    if (/^\|\s*[-:]+\s*\|/.test(t)) continue;
    if (/^\|\s*(Método|Method|Ruta|Route)\s*\|/i.test(t)) continue;
    const tableMatch = t.match(/^\|\s*(GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD)\s*\|\s*(\S+)/i);
    if (tableMatch) paths.add(tableMatch[2]!);
    else {
      const cells = t
        .split("|")
        .map((c) => c.trim())
        .filter(Boolean);
      const routeCell = cells.find((c) => c.startsWith("/"));
      if (routeCell) paths.add(routeCell.split(/\s+/)[0]!);
    }
  }
  for (const m of section4Body.matchAll(/^###\s+(GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD)\s+(\S+)/gim)) {
    paths.add(m[2]!);
  }
  if (paths.size === 0) {
    for (const m of fullDraft.matchAll(/^###\s+(GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD)\s+(\S+)/gim)) {
      paths.add(m[2]!);
    }
  }
  return [...paths];
}

function countApiEndpoints(section4Body: string, fullDraft: string): number {
  return extractApiRoutePaths(section4Body, fullDraft).length;
}

function normalizeDomainKey(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/_+/g, "_");
}

function formatDomainLabel(key: string): string {
  return key
    .split("_")
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function domainKeyFromRoutePath(path: string): string | null {
  const cleaned = path.split("?")[0]!.replace(/\/+$/, "");
  const segments = cleaned.split("/").filter(Boolean);
  let i = 0;
  while (i < segments.length && /^(api|v\d+)$/i.test(segments[i]!)) i += 1;
  if (i >= segments.length) return null;
  const seg = segments[i]!.replace(/[{}:*]/g, "").toLowerCase();
  if (!seg || SKIP_ROUTE_DOMAIN.has(seg)) return null;
  return normalizeDomainKey(seg);
}

function extractSqlTableNames(section3Body: string): string[] {
  const names: string[] = [];
  for (const m of section3Body.matchAll(
    /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:["`]?)([a-zA-Z_][a-zA-Z0-9_]*)(?:["`]?)/gi,
  )) {
    names.push(m[1]!.toLowerCase());
  }
  return names;
}

function domainKeyFromTableName(tableName: string): string {
  const t = tableName.toLowerCase();
  if (AUTH_TABLE_NAMES.has(t)) return "auth";
  if (/auth|session|mfa|oauth|login|password|credential/.test(t)) return "auth";
  const head = t.split("_")[0] ?? t;
  if (head === "user") return "auth";
  return normalizeDomainKey(head);
}

function extractSection2DomainLabels(section2Body: string): string[] {
  const labels: string[] = [];
  const core = section2Body.match(/Core\s*\(([^)]+)\)/i);
  if (core?.[1]) {
    for (const part of core[1].split(/[,;]/)) {
      const t = part.trim();
      if (t.length > 1) labels.push(t);
    }
  }
  for (const m of section2Body.matchAll(/\b([A-Za-z][A-Za-z0-9]*Module)\b/g)) {
    labels.push(m[1]!.replace(/Module$/i, ""));
  }
  for (const m of section2Body.matchAll(
    /(?:módulos?|modules?)\s*(?:principales?|NestJS)?\s*[:]\s*([^\n]+)/gi,
  )) {
    for (const part of m[1]!.split(/[,;]/)) {
      const t = part.trim().replace(/^[-*]\s*/, "");
      if (t.length > 1) labels.push(t);
    }
  }
  return labels;
}

function domainKeyFromSection2Label(label: string): string {
  const stripped = label.replace(/\s+(Engine|Service|Gateway|Orchestrator)$/i, "").trim();
  return normalizeDomainKey(stripped);
}

/** Agrupa rutas §4, tablas §3 y módulos §2 en bounded contexts (sin inventar nodos). */
export function extractDomainModulesFromMddSections(input: {
  section2Body: string;
  section3Body: string;
  section4Body: string;
  fullDraft: string;
}): DomainModuleSignal[] {
  const buckets = new Map<
    string,
    { routeCount: number; tables: Set<string>; fromSection2: boolean }
  >();

  const bump = (key: string, patch: Partial<{ route: number; table: string; section2: boolean }>) => {
    if (!key) return;
    const cur = buckets.get(key) ?? { routeCount: 0, tables: new Set<string>(), fromSection2: false };
    if (patch.route) cur.routeCount += patch.route;
    if (patch.table) cur.tables.add(patch.table);
    if (patch.section2) cur.fromSection2 = true;
    buckets.set(key, cur);
  };

  for (const path of extractApiRoutePaths(input.section4Body, input.fullDraft)) {
    const key = domainKeyFromRoutePath(path);
    if (key) bump(key, { route: 1 });
  }

  for (const table of extractSqlTableNames(input.section3Body)) {
    bump(domainKeyFromTableName(table), { table });
  }

  for (const label of extractSection2DomainLabels(input.section2Body)) {
    bump(domainKeyFromSection2Label(label), { section2: true });
  }

  const ranked = [...buckets.entries()]
    .map(([key, v]) => ({
      key,
      label: formatDomainLabel(key),
      routeCount: v.routeCount,
      tables: [...v.tables].sort(),
      fromSection2: v.fromSection2,
      score: v.routeCount * 2 + v.tables.size + (v.fromSection2 ? 3 : 0),
    }))
    .filter((m) => m.routeCount > 0 || m.tables.length > 0 || m.fromSection2)
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_DOMAIN_MODULES);

  return ranked.map(({ key, label, routeCount, tables, fromSection2 }) => ({
    key,
    label,
    routeCount,
    tables,
    fromSection2,
  }));
}

function moduleNodeLabel(mod: DomainModuleSignal): string {
  const parts: string[] = [mod.label];
  if (mod.routeCount > 0 && mod.tables.length > 0) {
    parts.push(`${mod.tables.length} tablas · ${mod.routeCount} rutas`);
  } else if (mod.routeCount > 0) {
    parts.push(`${mod.routeCount} rutas`);
  } else if (mod.tables.length > 0) {
    parts.push(`${mod.tables.length} tablas`);
  }
  return parts.join(" · ");
}

function moduleNodeId(mod: DomainModuleSignal): string {
  return `MOD_${sanitizeMermaidId(mod.key)}`;
}

function pickQueueAttachNodeId(
  modules: DomainModuleSignal[],
  fallback: string,
): string {
  const jobLike = modules.find((m) =>
    /notif|email|job|queue|worker|async|mail|webhook|outbox/i.test(`${m.key} ${m.label}`),
  );
  return jobLike ? moduleNodeId(jobLike) : fallback;
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
    domainModules: extractDomainModulesFromMddSections({
      section2Body: section2.body,
      section3Body: section3?.body ?? "",
      section4Body: section4?.body ?? "",
      fullDraft: trimmed,
    }),
  };
}

function buildEnrichedComponentDiagramMermaid(signals: GreenfieldStackSignals): string | null {
  const modules = signals.domainModules;
  if (modules.length < MIN_DOMAIN_MODULES_FOR_ENRICHED) return null;

  const lines: string[] = ["flowchart TB"];
  const edges: string[] = [];

  const feLabel = signals.frontend ?? "Frontend";
  const beLabel = signals.backend ?? "Backend";
  const dbLabel = signals.primaryDb ?? "Base de datos";
  const apiLabel =
    signals.endpointCount > 0 ? `REST · ${signals.endpointCount} endpoints` : "REST API";
  const tableLabel = signals.tableCount > 0 ? `${signals.tableCount} tablas` : "Persistencia";

  let queueFallback = "BE_API";

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
    for (const mod of modules) {
      const id = moduleNodeId(mod);
      lines.push(`    ${id}["${moduleNodeLabel(mod)}"]`);
    }
    if (signals.primaryDb) lines.push(`    BE_SQL[("${dbLabel} · ${tableLabel}")]`);
    if (signals.graphDb) lines.push(`    BE_GRAPH[("${signals.graphDb}")]`);
    lines.push("  end");
    edges.push("  FE_UI --> FE_STATE");
    edges.push("  FE_STATE --> FE_CLIENT");
    edges.push("  FE_CLIENT -->|HTTP| BE_API");
    for (const mod of modules) {
      edges.push(`  BE_API --> ${moduleNodeId(mod)}`);
      if (signals.primaryDb) edges.push(`  ${moduleNodeId(mod)} --> BE_SQL`);
      if (signals.graphDb) edges.push(`  ${moduleNodeId(mod)} --> BE_GRAPH`);
    }
    queueFallback = "BE_API";
  } else if (signals.backend) {
    const beId = sanitizeMermaidId(`be_${beLabel}`);
    lines.push(`  subgraph ${beId}["${beLabel}"]`);
    lines.push(`    API["${apiLabel}"]`);
    queueFallback = "API";
    for (const mod of modules) {
      const id = moduleNodeId(mod);
      lines.push(`    ${id}["${moduleNodeLabel(mod)}"]`);
    }
    if (signals.primaryDb) lines.push(`    SQL[("${dbLabel} · ${tableLabel}")]`);
    if (signals.graphDb) lines.push(`    GRAPH[("${signals.graphDb}")]`);
    lines.push("  end");
    for (const mod of modules) {
      edges.push(`  API --> ${moduleNodeId(mod)}`);
      if (signals.primaryDb) edges.push(`  ${moduleNodeId(mod)} --> SQL`);
      if (signals.graphDb) edges.push(`  ${moduleNodeId(mod)} --> GRAPH`);
    }
  } else if (signals.frontend) {
    const feId = sanitizeMermaidId(`fe_${feLabel}`);
    lines.push(`  subgraph ${feId}["${feLabel} · SPA"]`);
    lines.push("    UI[Pages / Components]");
    lines.push("    CLIENT[API Client]");
    lines.push("  end");
    lines.push(`  subgraph be_modules["Backend · dominios"]`);
    lines.push(`    BE_API["${apiLabel}"]`);
    queueFallback = "BE_API";
    for (const mod of modules) {
      const id = moduleNodeId(mod);
      lines.push(`    ${id}["${moduleNodeLabel(mod)}"]`);
    }
    if (signals.primaryDb) lines.push(`    BE_SQL[("${dbLabel} · ${tableLabel}")]`);
    lines.push("  end");
    edges.push("  UI --> CLIENT");
    edges.push("  CLIENT -->|HTTP| BE_API");
    for (const mod of modules) {
      edges.push(`  BE_API --> ${moduleNodeId(mod)}`);
      if (signals.primaryDb) edges.push(`  ${moduleNodeId(mod)} --> BE_SQL`);
    }
  } else {
    lines.push(`  API["${apiLabel}"]`);
    queueFallback = "API";
    for (const mod of modules) {
      const id = moduleNodeId(mod);
      lines.push(`  ${id}["${moduleNodeLabel(mod)}"]`);
    }
    if (signals.primaryDb) lines.push(`  DB[("${dbLabel} · ${tableLabel}")]`);
    if (signals.graphDb) lines.push(`  GRAPH[("${signals.graphDb}")]`);
    for (const mod of modules) {
      edges.push(`  API --> ${moduleNodeId(mod)}`);
      if (signals.primaryDb) edges.push(`  ${moduleNodeId(mod)} --> DB`);
      if (signals.graphDb) edges.push(`  ${moduleNodeId(mod)} --> GRAPH`);
    }
  }

  if (signals.cacheOrQueue) {
    const auxId = sanitizeMermaidId(signals.cacheOrQueue);
    lines.push(`  ${auxId}["${signals.cacheOrQueue}"]`);
    const attach = pickQueueAttachNodeId(modules, queueFallback);
    edges.push(`  ${attach} --> ${auxId}`);
  }

  if (edges.length) lines.push(...edges);
  return lines.length > 1 ? lines.join("\n") : null;
}

function buildGenericComponentDiagramMermaid(signals: GreenfieldStackSignals): string | null {
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

export function buildProposedComponentDiagramMermaid(signals: GreenfieldStackSignals): string | null {
  const enriched = buildEnrichedComponentDiagramMermaid(signals);
  if (enriched) return enriched;
  return buildGenericComponentDiagramMermaid(signals);
}

export function formatProposedComponentDiagramMarkdown(
  mermaid: string,
  options?: { includeNote?: boolean; enriched?: boolean },
): string {
  const note = options?.enriched
    ? "_Propuesta derivada de §2–§4: módulos agrupados por prefijos de rutas API, tablas SQL y módulos nombrados en §2 (determinista, sin servicios inventados)._"
    : "_Propuesta derivada de §2–§4: capas inferidas del stack, entidades SQL y contratos API documentados (determinista, sin servicios inventados)._";
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

/** Plantilla genérica de capas (sin módulos MOD_*). */
export function proposedComponentDiagramIsGeneric(mermaid: string): boolean {
  if (/\bMOD_[A-Za-z0-9_]+\s*\[/.test(mermaid)) return false;
  return /BE_DOMAIN\[Services \/ Domain\]|SVC\[Services \/ Domain\]/.test(mermaid);
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
  options?: { includeNote?: boolean; enriched?: boolean },
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
  const signals = parseGreenfieldMddSignals(mdd);
  if (!signals) return draft;

  const mermaid = buildProposedComponentDiagramMermaid(signals);
  if (!mermaid) return draft;

  if (existingMermaid && !proposedComponentDiagramNeedsRepair(existingMermaid)) {
    if (existingMermaid.trim() === mermaid.trim()) return draft;
    if (!proposedComponentDiagramIsGeneric(existingMermaid)) return draft;
  }

  const includeNote = !mddExcludesWebUiSurface(mdd);
  const enriched = signals.domainModules.length >= MIN_DOMAIN_MODULES_FOR_ENRICHED;
  return replaceProposedComponentDiagramSection(mdd, mermaid, { includeNote, enriched });
}
