/**
 * Endpoints §4 obligatorios por entidad/journey DBGA (watchlists, strategies, quota, WS…).
 */

import type { DomainInventory } from "@theforge/shared-types";
import {
  extractEntities,
  extractMddSection4Endpoints,
  extractSection,
  normEp,
  normalizeApiPathForCompare,
} from "./conformance.service.js";
import { extractSectionByNumber } from "./mdd-markdown-parser.js";
import {
  insertMddSection4Block,
  reattachMddUiUxDesignIntentSuffix,
  splitMddUiUxDesignIntentSuffix,
} from "../ai-analysis/utils/mdd-sanitize/section-merge.js";

export type JourneyEndpointRequirement = {
  id: string;
  label: string;
  method: string;
  path: string;
  triggerEntity?: string;
};

function crudRoutes(entitySlug: string): JourneyEndpointRequirement[] {
  const base = entitySlug.replace(/_/g, "-");
  return [
    { id: `${entitySlug}-list`, label: `${entitySlug} list`, method: "GET", path: `/api/v1/${base}`, triggerEntity: entitySlug },
    { id: `${entitySlug}-create`, label: `${entitySlug} create`, method: "POST", path: `/api/v1/${base}`, triggerEntity: entitySlug },
    { id: `${entitySlug}-get`, label: `${entitySlug} get`, method: "GET", path: `/api/v1/${base}/*`, triggerEntity: entitySlug },
    { id: `${entitySlug}-update`, label: `${entitySlug} update`, method: "PUT", path: `/api/v1/${base}/*`, triggerEntity: entitySlug },
    { id: `${entitySlug}-delete`, label: `${entitySlug} delete`, method: "DELETE", path: `/api/v1/${base}/*`, triggerEntity: entitySlug },
  ];
}

const SPECIAL_JOURNEY_ENDPOINTS: JourneyEndpointRequirement[] = [
  {
    id: "dashboard-me",
    label: "Dashboard usuario",
    method: "GET",
    path: "/api/v1/dashboards/me",
    triggerEntity: "dashboard_configs",
  },
  {
    id: "tenant-quota",
    label: "Quota tokens tenant",
    method: "GET",
    path: "/api/v1/tenants/*/quota",
  },
  {
    id: "tenant-quota-patch",
    label: "Quota tokens tenant update",
    method: "PATCH",
    path: "/api/v1/tenants/*/quota",
  },
];

const ENTITY_JOURNEY_MAP: Record<string, string> = {
  watchlists: "watchlists",
  strategies: "strategies",
  credentials: "credentials",
  dashboard_configs: "dashboard_configs",
};

function corpusMentionsTenantQuotaLlm(
  mddMarkdown: string,
  brdMarkdown?: string | null,
  dbgaMarkdown?: string | null,
): boolean {
  const corpus = [brdMarkdown, dbgaMarkdown, mddMarkdown].filter(Boolean).join("\n");
  return /\b(tenant[s]?\s+quota|quota\s+(?:llm|ia|tokens?)|\/tenants\/[^/\s]+\/quota|l[ií]mite\s+(?:de\s+)?(?:tokens?|ia|llm)|token\s+limit|consumo\s+de\s+tokens?)\b/i.test(
    corpus,
  );
}

function section2MentionsWebSocket(mddMarkdown: string): boolean {
  const section2 = extractSection(
    mddMarkdown,
    /^#+\s*(?:2\.\s*)?(?:stack|arquitectura|frontend|backend)/im,
  );
  return /\b(websocket|wss?:\/\/|gateway\s+ws|real[- ]time\s+gateway)\b/i.test(section2);
}

function endpointPresent(
  req: JourneyEndpointRequirement,
  section4Norm: Set<string>,
): boolean {
  const targetPath = normalizeApiPathForCompare(req.path);
  for (const norm of section4Norm) {
    const [method, path] = norm.split(" ");
    if (method !== req.method.toUpperCase()) continue;
    if (path === targetPath) return true;
    if (targetPath.includes("/*") && path.startsWith(targetPath.replace(/\/\*$/, ""))) return true;
  }
  return false;
}

function wsPresent(section4: string): boolean {
  return /\b(websocket|wss?:\/\/|\/ws\b|socket\.io)\b/i.test(section4);
}

/** Requisitos §4 según tablas §3 + journeys especiales. */
export function buildJourneyEndpointRequirements(params: {
  mddMarkdown: string;
  inventory?: DomainInventory | null;
  brdMarkdown?: string | null;
  dbgaMarkdown?: string | null;
}): JourneyEndpointRequirement[] {
  const section3 = extractSectionByNumber(params.mddMarkdown ?? "", 3) || params.mddMarkdown || "";
  const entities = extractEntities(section3);
  const required: JourneyEndpointRequirement[] = [];

  for (const [entity, slug] of Object.entries(ENTITY_JOURNEY_MAP)) {
    if (!entities.has(entity) && !(params.inventory?.suggestedEntities ?? []).includes(entity)) continue;
    if (entity === "strategies" && !entities.has("strategies")) {
      if (!/\bstrateg/i.test(`${params.mddMarkdown ?? ""}`)) continue;
    }
    required.push(...crudRoutes(slug));
  }

  if (entities.has("dashboard_configs")) {
    required.push(...SPECIAL_JOURNEY_ENDPOINTS.filter((e) => e.id.startsWith("dashboard")));
  }
  if (corpusMentionsTenantQuotaLlm(params.mddMarkdown ?? "", params.brdMarkdown, params.dbgaMarkdown)) {
    required.push(...SPECIAL_JOURNEY_ENDPOINTS.filter((e) => e.id.startsWith("tenant-quota")));
  }

  if (section2MentionsWebSocket(params.mddMarkdown)) {
    required.push({
      id: "ws-gateway",
      label: "WebSocket Gateway",
      method: "GET",
      path: "/api/v1/ws",
    });
  }

  const seen = new Set<string>();
  return required.filter((r) => {
    const k = `${r.method} ${r.path}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

export type MddJourneySection4Report = {
  missing: JourneyEndpointRequirement[];
  gaps: string[];
};

export function checkMddJourneySection4Gaps(params: {
  mddMarkdown: string;
  inventory?: DomainInventory | null;
  brdMarkdown?: string | null;
  dbgaMarkdown?: string | null;
}): MddJourneySection4Report {
  const section4 = extractSection(
    params.mddMarkdown,
    /^#+\s*(?:4\.\s*)?(?:contratos\s+de\s+api|api\s+contracts|endpoints)/im,
  );
  const endpoints = extractMddSection4Endpoints(params.mddMarkdown);
  const section4Norm = new Set(endpoints.map(normEp));
  const required = buildJourneyEndpointRequirements(params);
  const missing: JourneyEndpointRequirement[] = [];

  for (const req of required) {
    if (req.id === "ws-gateway") {
      if (!wsPresent(section4) && !endpointPresent(req, section4Norm)) missing.push(req);
      continue;
    }
    if (!endpointPresent(req, section4Norm)) missing.push(req);
  }

  const gaps = missing.length
    ? [
        `[MDD §4] Faltan ${missing.length} contrato(s) journey core: ${missing
          .slice(0, 8)
          .map((m) => `${m.method} ${m.path}`)
          .join(", ")}${missing.length > 8 ? "…" : ""}`,
      ]
    : [];

  return { missing, gaps };
}

/** Añade filas a la tabla §4 para endpoints journey ausentes. */
export function injectMissingJourneyEndpointsIntoMddSection4(
  mddMarkdown: string,
  missing: JourneyEndpointRequirement[],
): { markdown: string; injected: string[] } {
  if (missing.length === 0) return { markdown: mddMarkdown, injected: [] };

  const { core, uiUxSuffix } = splitMddUiUxDesignIntentSuffix(mddMarkdown);

  const rows = missing.map(
    (m) =>
      `| ${m.method} | \`${m.path.replace(/\*/g, "{id}")}\` | ${m.label} (journey core — auto) | Bearer | DBGA/BRD |`,
  );
  const block =
    `\n\n### Endpoints journey core (sincronización determinista)\n\n` +
    `| Método | Ruta | Descripción | Auth | Notas |\n` +
    `|--------|------|-------------|------|-------|\n` +
    rows.join("\n") +
    `\n`;

  const section4 = extractSection(
    core,
    /^#+\s*(?:4\.\s*)?(?:contratos\s+de\s+api|api\s+contracts|endpoints)/im,
  );
  if (!section4 || section4.length < 40) {
    return {
      markdown: reattachMddUiUxDesignIntentSuffix(insertMddSection4Block(core, block.trim()), uiUxSuffix),
      injected: missing.map((m) => m.id),
    };
  }

  const headingMatch = core.match(/^#+\s*(?:4\.\s*)?(?:contratos\s+de\s+api|api\s+contracts|endpoints)/im);
  if (headingMatch?.index == null) {
    return {
      markdown: reattachMddUiUxDesignIntentSuffix(insertMddSection4Block(core, block.trim()), uiUxSuffix),
      injected: missing.map((m) => m.id),
    };
  }

  const start = headingMatch.index;
  const rest = core.slice(start);
  const nextH2 = rest.slice(1).search(/^##\s+\d/m);
  const end = nextH2 >= 0 ? start + 1 + nextH2 : core.length;
  const newSection4 = core.slice(start, end).trimEnd() + block;
  const mergedCore = core.slice(0, start) + newSection4 + core.slice(end);
  return {
    markdown: reattachMddUiUxDesignIntentSuffix(mergedCore, uiUxSuffix),
    injected: missing.map((m) => m.id),
  };
}
