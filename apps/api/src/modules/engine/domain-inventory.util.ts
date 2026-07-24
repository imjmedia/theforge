/**
 * Extract BRD §3 capabilities + heuristic domain signals for cascade accuracy.
 */

import {
  AUTH_ENTITY_FAMILY,
  DBGA_CORE_ENTITIES,
  PLATFORM_ORPHAN_TABLES,
  type BrdCapability,
  type CrudMatrixRow,
  type DomainInventory,
  type ProcessInventoryItem,
} from "@theforge/shared-types";
import { isPlatformTableJustified } from "./platform-table-justify.util.js";
import { stableCrudUserStoryId, stableJourneyUserStoryId } from "@theforge/shared-types";

const AUTH_CAPABILITY_RE =
  /\b(autenticaci[oó]n|autorizaci[oó]n|login|mfa|ldap|rbac|sso|sesiones?|credenciales)\b/i;

/** H3 plantilla del outline BRD — no son capacidades/procesos de dominio. */
const BRD_STRUCTURAL_CAPABILITY_TITLE_RE =
  /^(?:\d+\.\s*)?(?:definici[oó]n de entidades(?: de negocio)?|f[óo]rmulas y umbrales|reglas de operaci[oó]n|matriz de permisos|flujos de negocio cr[ií]ticos|criterios de aceptaci[oó]n(?: de negocio)?(?: \(uat\))?|roles de negocio|casos de uso clave|objetivos comerciales|dentro del alcance|fuera de alcance|riesgos|m[eé]tricas de [ée]xito|validaci[oó]n de demanda|impacto financiero|problema de negocio|diagrama entidad|flujos cr[ií]ticos|accesibilidad|reporter[ií]a para roles|trazabilidad de auditor[ií]a|reglas de visualizaci[oó]n financiera|se estima que la ausencia)/i;

export function isStructuralBrdCapabilityTitle(title: string): boolean {
  const t = title
    .replace(/\*\*/g, "")
    .replace(/^\d+\.?\s*/, "")
    .replace(/^#\s*/, "")
    .trim();
  if (!t) return true;
  if (BRD_STRUCTURAL_CAPABILITY_TITLE_RE.test(t)) return true;
  if (/^flujo\s+\d+\s*:/i.test(t)) return true;
  return false;
}

const ENTITY_HINT_RE =
  /\b(tenant|canal|conversaci[oó]n|solicitud|embedding|mcp|bit[aá]cora|tarea\s+programada|scheduled|whatsapp|wasender|bitrix|lead|plugin|tool|agente|llm|configuraci[oó]n)\b/gi;

/** Map Spanish / product nouns → suggested snake_case table names. */
const ENTITY_ALIASES: Record<string, string> = {
  tenant: "tenants",
  canal: "channels",
  conversación: "conversations",
  conversacion: "conversations",
  solicitud: "requests",
  embedding: "message_embeddings",
  mcp: "mcp_plugins",
  bitácora: "failed_request_logs",
  bitacora: "failed_request_logs",
  whatsapp: "whatsapp_devices",
  wasender: "wasender_devices",
  bitrix: "mcp_plugins",
  lead: "leads",
  plugin: "mcp_plugins",
  tool: "mcp_tools",
  agente: "agent_runs",
  llm: "llm_configs",
  configuración: "llm_configs",
  configuracion: "llm_configs",
  strategy: "strategies",
  strategies: "strategies",
  estrategia: "strategies",
  estrategias: "strategies",
  watchlist: "watchlists",
  watchlists: "watchlists",
  operacion: "operations",
  operaciones: "operations",
  operation: "operations",
  operations: "operations",
  credencial: "credentials",
  credenciales: "credentials",
  credential: "credentials",
  credentials: "credentials",
  dashboard: "dashboard_configs",
  "dashboard config": "dashboard_configs",
  otp: "otp_sessions",
  "sesion otp": "otp_sessions",
  "sesiones otp": "otp_sessions",
  user: "users",
  users: "users",
  "tarea programada": "scheduled_tasks",
  scheduled: "scheduled_tasks",
};

export function extractBrdCapabilities(brdMarkdown: string): BrdCapability[] {
  const text = (brdMarkdown ?? "").trim();
  if (!text) return [];

  const capabilities: BrdCapability[] = [];
  // Prefer §3 Capacidades (evita `## 3.` vacíos en §1 y fallback al BRD completo).
  const section3 =
    extractMarkdownSection(text, /^##\s*3[\.\s]*Capacidades/im) ??
    extractMarkdownSection(text, /^##\s*3[\.\s][^\n]*(?:funcional|producto)/im) ??
    extractMarkdownSection(text, /^##\s*3[\.\s]/im) ??
    text;
  const headingRe = /^###\s*(?:(\d+(?:\.\d+)*)\s+)?(.+)$/gm;
  let match: RegExpExecArray | null;
  const headings: { id: string; title: string; start: number }[] = [];
  while ((match = headingRe.exec(section3)) !== null) {
    const title = (match[2] ?? "").trim();
    if (!title || isStructuralBrdCapabilityTitle(title)) continue;
    if (/^(contexto|objetivos|impacto)/i.test(title)) continue;
    const id = match[1] ? `cap-${match[1]}` : `cap-${headings.length + 1}`;
    headings.push({ id, title, start: match.index });
  }

  for (let i = 0; i < headings.length; i++) {
    const h = headings[i]!;
    const end = i + 1 < headings.length ? headings[i + 1]!.start : section3.length;
    const body = section3.slice(h.start, end).replace(/^###.+$/m, "").trim();
    // Skip non-capability headings under wrong sections (roles, etc.) when body too short and auth-only title elsewhere
    if (body.length < 40 && !/\d\./.test(h.id)) {
      // still keep if title looks functional
      if (!/(gesti[oó]n|recepci[oó]n|procesamiento|panel|acceso|memoria|tarea|bit[aá]cora|autentic)/i.test(h.title)) {
        continue;
      }
    }
    capabilities.push({
      id: h.id,
      title: h.title,
      body: body.slice(0, 4000),
      isAuthRelated: AUTH_CAPABILITY_RE.test(h.title) || AUTH_CAPABILITY_RE.test(body.slice(0, 400)),
    });
  }

  // Fallback: bullets under "Capacidades"
  if (capabilities.length === 0) {
    const capBlock = text.match(/capacidades[^\n]*\n([\s\S]{0,8000})/i)?.[1] ?? "";
    let n = 0;
    for (const line of capBlock.split("\n")) {
      const m = line.match(/^\s*[-*]\s+\*?\*?(.+?)\*?\*?\s*$/);
      if (!m?.[1] || m[1].length < 12) continue;
      n += 1;
      const title = m[1].replace(/\*\*/g, "").slice(0, 160);
      capabilities.push({
        id: `cap-b${n}`,
        title,
        body: title,
        isAuthRelated: AUTH_CAPABILITY_RE.test(title),
      });
    }
  }

  return capabilities;
}

function extractMarkdownSection(md: string, startRe: RegExp): string | null {
  const flags = startRe.flags.includes("m") ? startRe.flags : `${startRe.flags}m`;
  const re = new RegExp(startRe.source, flags);
  const start = md.search(re);
  if (start < 0) return null;
  const rest = md.slice(start);
  // Solo H2 numerados (## N.) — no confundir con ### subsecciones.
  const next = rest.slice(1).search(/^##\s+\d+/m);
  return next >= 0 ? rest.slice(0, next + 1) : rest;
}

/** Suggest entity table names from BRD/DBGA prose. */
export function suggestEntitiesFromProse(...docs: Array<string | null | undefined>): string[] {
  const found = new Set<string>();
  for (const doc of docs) {
    if (!doc) continue;
    for (const m of doc.matchAll(ENTITY_HINT_RE)) {
      const raw = m[1]?.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "") ?? "";
      const key = raw.replace(/\s+/g, " ").trim();
      const aliased = ENTITY_ALIASES[key] ?? ENTITY_ALIASES[raw] ?? snakePlural(key);
      if (aliased.length >= 3) found.add(aliased);
    }
    // CREATE TABLE already present
    for (const m of doc.matchAll(/\bcreate\s+table\s+(?:if\s+not\s+exists\s+)?["`]?([a-z_][a-z0-9_]*)/gi)) {
      if (m[1]) found.add(m[1].toLowerCase());
    }
  }
  return [...found].sort();
}

/** Entidades núcleo explícitas en DBGA (CREATE TABLE + keywords canónicos). */
export function extractDbgaCanonicalEntities(dbgaMarkdown: string): string[] {
  const found = new Set<string>();
  const text = (dbgaMarkdown ?? "").trim();
  if (!text) return [];

  for (const entity of DBGA_CORE_ENTITIES) {
    const slug = entity.replace(/_/g, "[\\s_-]*");
    if (new RegExp(`\\b${slug}\\b`, "i").test(text)) found.add(entity);
  }
  for (const m of text.matchAll(/\bcreate\s+table\s+(?:if\s+not\s+exists\s+)?["`]?([a-z_][a-z0-9_]*)/gi)) {
    if (m[1]) found.add(m[1].toLowerCase());
  }
  for (const e of suggestEntitiesFromProse(text)) {
    if (DBGA_CORE_ENTITIES.includes(e as (typeof DBGA_CORE_ENTITIES)[number])) found.add(e);
  }
  return [...found].sort();
}

function snakePlural(word: string): string {
  const w = word.replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
  if (!w) return w;
  if (w.endsWith("s")) return w;
  if (w.endsWith("y") && w.length > 3) return `${w.slice(0, -1)}ies`;
  return `${w}s`;
}

export function buildCrudMatrix(
  mddEntities: Iterable<string>,
  suggestedEntities: string[],
  capabilities: BrdCapability[],
): CrudMatrixRow[] {
  const rows = new Map<string, CrudMatrixRow>();
  const domainCaps = capabilities.filter((c) => !c.isAuthRelated).map((c) => c.id);

  const add = (entity: string, infraOnly = false, mvp = true) => {
    const e = entity.toLowerCase();
    if (rows.has(e)) return;
    const isAuth = AUTH_ENTITY_FAMILY.has(e);
    rows.set(e, {
      entity: e,
      usId: stableCrudUserStoryId(e),
      ops: infraOnly ? ["R"] : isAuth ? ["C", "R", "U", "L"] : ["C", "R", "U", "D", "L"],
      mvp,
      infraOnly,
      brdCapabilityIds: isAuth ? [] : domainCaps.slice(0, 3),
      screenHint: infraOnly ? undefined : `/gestion-${e.replace(/_/g, "-")}`,
      endpointHint: infraOnly ? undefined : `/api/v1/${e.replace(/_/g, "-")}`,
    });
  };

  for (const e of mddEntities) add(e, AUTH_ENTITY_FAMILY.has(e) && e === "outbox_events");
  for (const e of suggestedEntities) {
    if (AUTH_ENTITY_FAMILY.has(e) && ![...mddEntities].includes(e)) continue;
    add(e, e === "outbox_events");
  }

  // Infra tables should not get full admin CRUD screens by default
  for (const e of ["outbox_events", "sessions"]) {
    const row = rows.get(e);
    if (row) {
      row.infraOnly = true;
      row.ops = ["R"];
      row.screenHint = undefined;
    }
  }

  return [...rows.values()].sort((a, b) => a.entity.localeCompare(b.entity));
}

export function buildProcessInventory(capabilities: BrdCapability[]): ProcessInventoryItem[] {
  return capabilities.map((cap, i) => {
    const steps = extractStepsFromBody(cap.body);
    return {
      id: `proc-${cap.id}`,
      usId: stableJourneyUserStoryId(`proc-${cap.id}`),
      name: cap.title,
      trigger: inferTrigger(cap),
      steps: steps.length > 0 ? steps : [`Ejecutar capacidad: ${cap.title}`],
      entities: [],
      critical: !cap.isAuthRelated || i < 2,
      brdCapabilityIds: [cap.id],
      screenHints: /panel|admin|gesti[oó]n|interfaz|dashboard/i.test(cap.title + cap.body)
        ? ["admin"]
        : /whatsapp|mensaje|chat|convers/i.test(cap.title + cap.body)
          ? ["chat-shell"]
          : [],
    };
  });
}

function extractStepsFromBody(body: string): string[] {
  const steps: string[] = [];
  for (const line of body.split("\n")) {
    const bullet = line.match(/^\s*[-*]\s+\*?\*?(.+?)\*?\*?\s*$/);
    if (bullet?.[1] && bullet[1].length > 8 && bullet[1].length < 200) {
      steps.push(bullet[1].replace(/\*\*/g, "").trim());
    }
    if (steps.length >= 8) break;
  }
  return steps;
}

function inferTrigger(cap: BrdCapability): string {
  const t = `${cap.title} ${cap.body}`.toLowerCase();
  if (/webhook|whatsapp|wasender/.test(t)) return "webhook.whatsapp";
  if (/login|autentic|mfa|ldap/.test(t)) return "user.auth";
  if (/programad|schedule|cron/.test(t)) return "scheduler.tick";
  if (/panel|admin/.test(t)) return "ui.admin";
  return "user.request";
}

export function buildDomainInventory(input: {
  brdMarkdown?: string | null;
  dbgaMarkdown?: string | null;
  mddMarkdown?: string | null;
  mddEntities?: Iterable<string>;
}): DomainInventory {
  const capabilities = extractBrdCapabilities(input.brdMarkdown ?? "");
  const suggestedFromProse = suggestEntitiesFromProse(
    input.brdMarkdown,
    input.dbgaMarkdown,
    input.mddMarkdown,
  );
  const dbgaCanonical = extractDbgaCanonicalEntities(input.dbgaMarkdown ?? "");
  const suggestedRaw = [...new Set([...suggestedFromProse, ...dbgaCanonical])];
  const suggestedEntities = suggestedRaw
    .filter(
      (e) =>
        !PLATFORM_ORPHAN_TABLES.has(e) ||
        isPlatformTableJustified(e, {
          brdMarkdown: input.brdMarkdown,
          dbgaMarkdown: input.dbgaMarkdown,
          mddMarkdown: input.mddMarkdown,
        }),
    )
    .sort();
  const mddEntities = input.mddEntities ?? [];
  const crudMatrix = buildCrudMatrix(mddEntities, suggestedEntities, capabilities);
  const processes = buildProcessInventory(capabilities);
  const adminSurfaces = processes
    .filter((p) => p.screenHints.includes("admin"))
    .map((p) => p.name);

  return {
    capabilities,
    suggestedEntities,
    processes,
    crudMatrix,
    adminSurfaces,
  };
}

/** True when MDD entities are overwhelmingly auth family while BRD has non-auth capabilities. */
export function detectAuthOnlySkew(
  mddEntities: Iterable<string>,
  capabilities: BrdCapability[],
): { skewed: boolean; domainCapabilityCount: number; domainEntityCount: number } {
  const entities = [...mddEntities].map((e) => e.toLowerCase());
  const unique = [...new Set(entities)];
  const domainCaps = capabilities.filter((c) => !c.isAuthRelated);
  const domainEntities = unique.filter((e) => !AUTH_ENTITY_FAMILY.has(e));
  const skewed =
    domainCaps.length >= 3 &&
    unique.length >= 3 &&
    domainEntities.length === 0 &&
    unique.every((e) => AUTH_ENTITY_FAMILY.has(e));
  return {
    skewed,
    domainCapabilityCount: domainCaps.length,
    domainEntityCount: domainEntities.length,
  };
}

/** Fraction of suggested business entities present in MDD §3. */
export function domainEntityCoverage(
  suggestedEntities: string[],
  mddEntities: Iterable<string>,
): { ratio: number; missing: string[] } {
  const mdd = new Set([...mddEntities].map((e) => e.toLowerCase()));
  const business = suggestedEntities.filter((e) => !AUTH_ENTITY_FAMILY.has(e));
  if (business.length === 0) return { ratio: 1, missing: [] };
  const missing = business.filter((e) => !mdd.has(e));
  return {
    ratio: (business.length - missing.length) / business.length,
    missing,
  };
}

/**
 * Compact block for LLM prompts (Clarifier / SA / Critic / cascade checklist).
 * Caps length so it stays within context budgets.
 */
export function formatDomainInventoryForPrompt(inventory: DomainInventory, maxChars = 3500): string {
  const domainCaps = inventory.capabilities.filter((c) => !c.isAuthRelated);
  const authCaps = inventory.capabilities.filter((c) => c.isAuthRelated);
  const lines: string[] = [
    "**Inventario de dominio (derivado del BRD/DBGA — fidelidad obligatoria):**",
    "",
    `Capacidades de negocio (${domainCaps.length}): ${domainCaps
      .slice(0, 20)
      .map((c) => c.title)
      .join("; ") || "(ninguna detectada)"}`,
    `Capacidades auth (${authCaps.length}): ${authCaps
      .slice(0, 8)
      .map((c) => c.title)
      .join("; ") || "(ninguna)"}`,
    `Entidades sugeridas: ${inventory.suggestedEntities.slice(0, 40).join(", ") || "(ninguna)"}`,
  ];
  if (inventory.processes.length > 0) {
    lines.push(
      `Procesos: ${inventory.processes
        .slice(0, 12)
        .map((p) => `${p.name} [${p.trigger}]`)
        .join("; ")}`,
    );
  }
  const businessSuggested = inventory.suggestedEntities.filter((e) => !AUTH_ENTITY_FAMILY.has(e));
  if (businessSuggested.length > 0) {
    lines.push(`Entidades de negocio a cubrir: ${businessSuggested.slice(0, 25).join(", ")}`);
  }
  const domainCrud = inventory.crudMatrix.filter((r) => !AUTH_ENTITY_FAMILY.has(r.entity) && !r.infraOnly);
  if (domainCrud.length > 0) {
    lines.push(
      `CrudMatrix dominio: ${domainCrud
        .slice(0, 20)
        .map((r) => `${r.entity}(${r.ops.join("")})`)
        .join(", ")}`,
    );
  }
  if (inventory.adminSurfaces.length > 0) {
    lines.push(`Superficies admin: ${inventory.adminSurfaces.slice(0, 10).join(", ")}`);
  }
  lines.push(
    "",
    "Reglas: (1) §3/§4 y entregables deben anclar estas capacidades/entidades. (2) Auth es complemento, no el único dominio. (3) Si falta una entidad de negocio en el MVP, declárala en Fuera de alcance — no la omitas en silencio.",
  );
  const text = lines.join("\n");
  return text.length <= maxChars ? text : text.slice(0, maxChars) + "\n…[inventario truncado]";
}
