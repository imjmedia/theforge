/**
 * @fileoverview Cruce §3 MDD + Historias de Usuario para el deliverable Pantallas.
 *
 * @copyright 2026 Jorge Correa
 * @license Apache-2.0
 */
import type { DomainInventory, EntityClassification, ListScreensEntity } from "@theforge/shared-types";
import { AUTH_ENTITY_FAMILY } from "@theforge/shared-types";
import { extractEntityKeyFieldsFromMdd, extractEntityNamesFromMdd } from "./ui-screens-mdd.util.js";
import {
  entityHasPostWithoutGetList,
  extractHttpEndpointsFromMarkdown,
  formatEndpointList,
  inferAuthEndpoints,
  inferPageNameFromApiPathSegment,
  inferRouteFromApiPath,
  matchEndpointsForEntity,
} from "./api-contract-endpoints.util.js";
import { resolvePantallaV1InScope } from "./ui-screens-v1-scope.util.js";
import {
  extractRolesFromMdd,
  inferPageComponentName,
  inferScreenRoute,
  inferUiStates,
  normalizeRoleLabel,
} from "./ui-screen-routes.util.js";

/** Tablas puente / glue — no generan pantalla CRUD admin por defecto. */
export const JUNCTION_OR_GLUE_SCREEN_ENTITIES = new Set([
  "agent_skills",
  "wasender_phone_companies",
  "application_capabilities",
  "conversation_memory",
  "multi_company_sessions",
  "messages",
  "sessions",
  "wasender_devices",
  "whatsapp_devices",
  "requests",
  "processing_queue",
  "agent_runs",
]);

/** Vistas administrativas declaradas en MDD §2.2 Frontend (journeys, no CRUD por tabla). */
export function extractMddAdminViewLines(mddMarkdown: string): string[] {
  const mdd = mddMarkdown ?? "";
  const feMatch = mdd.match(
    /(?:###\s*2\.2\s+Frontend|###\s+Frontend)[\s\S]*?(?=\n###\s|\n##\s+[3-9]|$)/i,
  );
  if (!feMatch) return [];

  const block = feMatch[0];
  const viewsIdx = block.search(/Vistas administrativas\s*:?\s*/i);
  if (viewsIdx < 0) return [];

  const lines: string[] = [];
  for (const line of block.slice(viewsIdx).split("\n")) {
    if (/^#{2,3}\s/.test(line) && lines.length > 0) break;
    const bullet = line.match(/^-\s+(.+)/);
    if (bullet?.[1]) {
      lines.push(bullet[1].trim());
      continue;
    }
    if (lines.length > 0 && line.trim() === "") break;
  }
  return lines;
}

function slugFromAdminViewLabel(label: string): string {
  return label
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);
}

function adminViewMatchesEntity(viewLabel: string, entityName: string): boolean {
  const view = viewLabel.toLowerCase();
  for (const token of entityMatchTokens(entityName)) {
    if (token.length >= 4 && view.includes(token.replace(/_/g, " "))) return true;
    if (view.includes(token.replace(/_/g, "-"))) return true;
  }
  return false;
}

/** Infra / glue tables — no admin CRUD screen by default (PLAN-CASCADE-90-ACCURACY). */
export const INFRA_ONLY_SCREEN_ENTITIES = new Set(
  [...AUTH_ENTITY_FAMILY].filter((e) =>
    ["outbox_events", "sessions", "role_permissions", "user_roles"].includes(e),
  ),
);

/** Entidades que get auth screens (login/MFA) instead of gestión-CRUD. */
export const AUTH_FLOW_ENTITIES = new Set(["sessions"]);

/** §1/§2 o producto declara chat/copilot/WhatsApp (no inferir solo por HU). */
export function mddDeclaresChatProduct(mddMarkdown: string): boolean {
  const mdd = mddMarkdown ?? "";
  const feBlock = mdd.match(
    /(?:###\s*2\.2\s+Frontend|###\s+Frontend)[\s\S]*?(?=\n###\s|\n##\s+[3-9]|$)/i,
  )?.[0] ?? "";
  const corpus = `${mdd.slice(0, 6000)}\n${feBlock}`;
  return /whatsapp|wasender|chat\s+del\s+copiloto|copiloto|mensajer[ií]a\s+instant|conversaci[oó]n\s+multi.?turno|\bmcp\s+chat\b/i.test(
    corpus,
  );
}

/** Historia de usuario parseada del markdown de backlog. */
export interface ParsedUserStory {
  id?: string;
  title: string;
  role?: string;
  want?: string;
  benefit?: string;
  /** Texto concatenado para matching heurístico con entidades §3. */
  searchText: string;
}

/** Ítem del plan de pantallas (entidad §3 enriquecida o flujo solo-HU). */
export interface PantallaPlanItem extends ListScreensEntity {
  screenName: string;
  purpose: string;
  uiHint?: string;
  resolveContext?: string;
  userStoryRefs?: string[];
  source: "entity" | "entity+hu" | "hu-only";
  /** Rol/journey (desde HU o MDD §1). */
  role?: string;
  route?: string;
  pageName?: string;
  uiStates?: string;
  primaryApi?: string;
  userStoryId?: string;
  implementationMode?: "pull-registry" | "prototype-iframe";
  /** true = incluida en tabla v1; false → sección «Fuera de alcance v1». */
  v1InScope?: boolean;
}

const STORY_HEADER =
  /^#{2,3}\s+(?:Historia\s+de\s+usuario|HU)\s*:?\s*(?:\[?(US-[A-Z0-9]+)\]?\s*)?(.*)$/im;

const COMO = /\*\*Como:\*\*\s*(.+?)(?:\r?\n|$)/i;
const QUIERO = /\*\*Quiero:\*\*\s*(.+?)(?:\r?\n|$)/i;
const PARA = /\*\*Para:\*\*\s*(.+?)(?:\r?\n|$)/i;
const CLASSIC_STORY =
  /Como\s+(.+?),\s*quiero\s+(.+?)\s+para\s+(.+?)(?:\.|$)/i;

/** Variantes singular/plural de un nombre de tabla para matching en texto HU. */
export function entityMatchTokens(entityName: string): string[] {
  const lower = entityName.toLowerCase().trim();
  const tokens = new Set<string>([lower]);
  if (lower.endsWith("ies") && lower.length > 4) {
    tokens.add(lower.slice(0, -3) + "y");
  } else if (lower.endsWith("ses") && lower.length > 4) {
    tokens.add(lower.slice(0, -2));
  } else if (lower.endsWith("es") && lower.length > 3) {
    tokens.add(lower.slice(0, -2));
    tokens.add(lower.slice(0, -1));
  } else if (lower.endsWith("s") && lower.length > 2) {
    tokens.add(lower.slice(0, -1));
  }
  return [...tokens].filter((t) => t.length >= 3);
}

function tokenAppearsInText(token: string, text: string): boolean {
  const re = new RegExp(`\\b${token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
  return re.test(text);
}

/** ¿La HU menciona la entidad (nombre de tabla o variantes)? */
export function storyMatchesEntity(story: ParsedUserStory, entityName: string): boolean {
  const haystack = story.searchText.toLowerCase();
  return entityMatchTokens(entityName).some((token) => tokenAppearsInText(token, haystack));
}

function parseStoryBlock(headerLine: string, body: string): ParsedUserStory | null {
  const headerMatch = headerLine.match(STORY_HEADER);
  if (!headerMatch) return null;

  const id = headerMatch[1]?.trim();
  const titleFromHeader = (headerMatch[2] ?? "").trim();

  let role: string | undefined;
  let want: string | undefined;
  let benefit: string | undefined;

  const como = body.match(COMO)?.[1]?.trim();
  const quiero = body.match(QUIERO)?.[1]?.trim();
  const para = body.match(PARA)?.[1]?.trim();
  if (como || quiero || para) {
    role = como;
    want = quiero;
    benefit = para;
  } else {
    const classic = body.match(CLASSIC_STORY);
    if (classic) {
      role = classic[1]?.trim();
      want = classic[2]?.trim();
      benefit = classic[3]?.trim();
    }
  }

  const title =
    titleFromHeader ||
    (want ? want.slice(0, 80) : undefined) ||
    id ||
    "Historia de usuario";

  const searchParts = [title, id, role, want, benefit, body.slice(0, 2000)].filter(Boolean);
  return {
    id,
    title,
    role,
    want,
    benefit,
    searchText: searchParts.join(" "),
  };
}

/**
 * Parsea historias de usuario del markdown de backlog (plantilla The Forge).
 * Ignora Epics y tareas técnicas.
 */
export function parseUserStoriesMarkdown(content: string): ParsedUserStory[] {
  const text = (content ?? "").trim();
  if (!text) return [];

  const headerRe = /^#{2,3}\s+(?:Historia\s+de\s+usuario|HU)\s*:/gim;
  const headers: { index: number; line: string }[] = [];

  for (const match of text.matchAll(headerRe)) {
    if (match.index == null) continue;
    const lineEnd = text.indexOf("\n", match.index);
    const line = text.slice(match.index, lineEnd === -1 ? undefined : lineEnd);
    headers.push({ index: match.index, line });
  }

  const stories: ParsedUserStory[] = [];
  for (let i = 0; i < headers.length; i++) {
    const start = headers[i].index;
    const end = i + 1 < headers.length ? headers[i + 1].index : text.length;
    const chunk = text.slice(start, end);
    const body = chunk.slice(headers[i].line.length);
    const parsed = parseStoryBlock(headers[i].line, body);
    if (parsed) stories.push(parsed);
  }

  return stories;
}

/** Infiere hint de UI a partir del texto de la HU o del nombre de entidad. */
export function inferUiHintFromText(text: string): string | undefined {
  const t = text.toLowerCase();
  if (/login|sign[\s-]?in|iniciar sesi|otp|mfa|2fa|autentic/i.test(t)) return "form";
  if (/whatsapp|wasender|chat|conversaci|mensaje|copiloto|composer/.test(t)) return "chat";
  if (/kanban|pipeline|tablero|embudo|funnel|etapas?/.test(t)) return "kanban";
  if (/formulario|registrar|crear|editar|alta|capturar|inscribir/.test(t)) return "form";
  if (/calendario|agenda|cita|horario/.test(t)) return "calendar";
  if (/wizard|paso a paso|onboarding|registrar servidor|mcp/.test(t)) return "wizard";
  if (/dashboard|panel|métricas|metricas|kpi|resumen ejecutivo/.test(t)) return "dashboard";
  if (/tabla|listado|consultar|ver lista|grid|catálogo|catalogo|bit[aá]cora/.test(t)) return "table";
  return undefined;
}

/** Clasificación semántica ligera (nombre de entidad + texto HU). */
export function inferClassification(
  entityName: string,
  storyText?: string,
): EntityClassification {
  const combined = `${entityName} ${storyText ?? ""}`.toLowerCase();

  if (/^config|^setting|^param|^price|^rate|^plan$|^policy/.test(entityName.toLowerCase())) {
    return "Configuration";
  }

  const hint = inferUiHintFromText(combined);
  if (hint === "form" || hint === "wizard") return "Configuration";
  if (hint === "kanban") return "WorkflowProcess";

  const workflowPatterns = [
    /order/, /request/, /task/, /ticket/, /invoice/, /payment/, /booking/,
    /appointment/, /claim/, /shipment/, /workflow/, /campaign/, /lead/,
    /subscription/, /incident/, /approval/, /project$/,
  ];
  if (workflowPatterns.some((p) => p.test(combined))) return "WorkflowProcess";

  return "DataRegistry";
}

function formatStoryPurpose(story: ParsedUserStory): string {
  const lines: string[] = [];
  if (story.role || story.want || story.benefit) {
    if (story.role) lines.push(`**Como:** ${story.role}`);
    if (story.want) lines.push(`**Quiero:** ${story.want}`);
    if (story.benefit) lines.push(`**Para:** ${story.benefit}`);
  } else {
    lines.push(story.title);
  }
  // Sin `*Referencia:* ${story.id}` redundante: el `useCase.id` en
  // `buildUiProjectInstructions` ya expone `story.id`; duplicar aquí producía
  // nombres de useCase como "**Como:** ... \n*Referencia:* US-CRUD". Ver
  // CHANGELOG [Unreleased] → Fixed → "Pantallas: sin *Referencia:* duplicado
  // en useCase.name".
  return lines.join("  \n");
}

function defaultEntityScreenName(entityName: string): string {
  return `Gestión de ${entityName}`;
}

function defaultEntityPurpose(entityName: string): string {
  return `Pantalla para administrar la entidad \`${entityName}\`.`;
}

function resolveEntityScreenRoute(
  _entityName: string,
  screenName: string,
  uiHint: string | undefined,
  isAuthFlow: boolean,
  matchedEndpoints: ReturnType<typeof matchEndpointsForEntity>,
  routeFromMatrix?: string,
  chatProductDeclared = false,
): string {
  if (isAuthFlow || /login|sign[\s-]?in|iniciar sesión/i.test(screenName)) {
    return "/login";
  }
  if (uiHint === "chat") {
    return chatProductDeclared ? "/chat" : inferScreenRoute(screenName, uiHint);
  }

  const apiRoute = matchedEndpoints[0]?.path
    ? inferRouteFromApiPath(matchedEndpoints[0].path)
    : undefined;
  if (apiRoute) return apiRoute;

  return routeFromMatrix || inferScreenRoute(screenName, uiHint);
}

function resolvePageNameForPlanItem(
  item: Pick<PantallaPlanItem, "screenName" | "route" | "name">,
  matchedEndpoints: ReturnType<typeof matchEndpointsForEntity>,
): string {
  if (item.route === "/login") return "LoginPage";
  const segment = matchedEndpoints[0]?.path.match(/\/api\/v\d+\/([^/?]+)/i)?.[1];
  if (segment) return inferPageNameFromApiPathSegment(segment);
  return inferPageComponentName(item.screenName);
}

function resolvePrimaryApiForPlanItem(
  matched: ReturnType<typeof matchEndpointsForEntity>,
  opts: { isAuthFlow: boolean; screenName: string; endpoints: ReturnType<typeof extractHttpEndpointsFromMarkdown> },
): string | undefined {
  if (opts.isAuthFlow || /login|sign[\s-]?in|otp|mfa|auth/i.test(opts.screenName)) {
    const auth = inferAuthEndpoints(opts.endpoints);
    return auth.length > 0 ? formatEndpointList(auth, 2) : undefined;
  }
  return matched.length > 0 ? formatEndpointList(matched, 2) : undefined;
}

function storyRef(story: ParsedUserStory): string {
  return story.id ? `${story.id} — ${story.title}` : story.title;
}

function resolveContextFromStory(story: ParsedUserStory): string | undefined {
  const parts = [story.role, story.want].filter(Boolean);
  if (parts.length === 0) return story.title;
  return `Como ${story.role ?? "usuario"}, quiero ${story.want ?? story.title}`;
}

/** Slug estable para pantallas derivadas solo de HU (sin tabla §3). */
export function huOnlyEntitySlug(story: ParsedUserStory): string {
  if (story.id) return story.id.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  return story.title
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48) || "hu-screen";
}

/**
 * Cruza entidades §3 con historias de usuario y produce el plan de pantallas.
 * - Cada entidad §3 → pantalla (enriquecida si hay HU vinculada), salvo infra-only.
 * - HU sin entidad → pantalla adicional (flujos transversales).
 * - Heurística: chat/HITL/MCP admin cuando el texto lo sugiere.
 */
export function buildPantallasPlan(
  mddMarkdown: string,
  userStoriesMarkdown?: string | null,
  apiContractsMarkdown?: string | null,
  inventory?: DomainInventory | null,
): PantallaPlanItem[] {
  const fromMatrix =
    inventory?.crudMatrix
      .filter((r) => !r.infraOnly && !AUTH_ENTITY_FAMILY.has(r.entity) && r.mvp)
      .map((r) => r.entity) ?? [];
  const fromMdd = extractEntityNamesFromMdd(mddMarkdown).filter(
    (e) =>
      !INFRA_ONLY_SCREEN_ENTITIES.has(e.toLowerCase()) &&
      !JUNCTION_OR_GLUE_SCREEN_ENTITIES.has(e.toLowerCase()),
  );
  const adminViews = extractMddAdminViewLines(mddMarkdown);
  const journeyFirst = adminViews.length >= 4;
  // Prefer CrudMatrix order, then MDD §3 (PLAN-CASCADE-90 P1)
  const entityNames = [...new Set([...fromMatrix, ...fromMdd])];
  const keyFieldsByEntity = extractEntityKeyFieldsFromMdd(mddMarkdown);
  const stories = parseUserStoriesMarkdown(userStoriesMarkdown ?? "");
  const endpoints = extractHttpEndpointsFromMarkdown(apiContractsMarkdown ?? "");
  const defaultRoles = extractRolesFromMdd(mddMarkdown);
  const defaultRole = defaultRoles[0] ?? "Usuario autenticado";
  const domainCorpus = `${mddMarkdown}\n${userStoriesMarkdown ?? ""}\n${JSON.stringify(inventory?.processes ?? [])}`.toLowerCase();
  const chatProductDeclared = mddDeclaresChatProduct(mddMarkdown);

  const screenHintByEntity = new Map(
    (inventory?.crudMatrix ?? [])
      .filter((r) => r.screenHint)
      .map((r) => [r.entity.toLowerCase(), r.screenHint!] as const),
  );

  const linkedByEntity = new Map<string, ParsedUserStory[]>();
  const matchedStoryIndexes = new Set<number>();

  for (const entity of entityNames) {
    const matched: ParsedUserStory[] = [];
    stories.forEach((story, idx) => {
      if (storyMatchesEntity(story, entity)) {
        matched.push(story);
        matchedStoryIndexes.add(idx);
      }
    });
    if (matched.length > 0) linkedByEntity.set(entity, matched);
  }

  const plan: PantallaPlanItem[] = [];

  for (const viewLabel of adminViews) {
    const uiHint = inferUiHintFromText(viewLabel) ?? "dashboard";
    const slug = slugFromAdminViewLabel(viewLabel);
    const matched = matchEndpointsForEntity(slug, endpoints);
    const role = /superadmin/i.test(viewLabel)
      ? "Super Admin"
      : /tenant|inquilino/i.test(viewLabel)
        ? "Admin inquilino"
        : defaultRole;
    plan.push({
      name: slug || "admin-view",
      keyFields: ["id"],
      restEndpoint: matched[0] ? `${matched[0].method} ${matched[0].path}` : undefined,
      classification: uiHint === "wizard" ? "Configuration" : "WorkflowProcess",
      uiHint,
      screenName: viewLabel,
      purpose: `Vista administrativa del MDD §2.2: ${viewLabel}.`,
      source: "hu-only",
      role: normalizeRoleLabel(role),
      route:
        uiHint === "dashboard" && /dashboard|panel/i.test(viewLabel)
          ? inferScreenRoute(viewLabel, uiHint)
          : `/admin/${slug || "view"}`,
      pageName: inferPageComponentName(viewLabel),
      uiStates: inferUiStates(viewLabel, uiHint),
      primaryApi:
        matched.length > 0
          ? formatEndpointList(matched, 2)
          : /login|auth/i.test(viewLabel)
            ? formatEndpointList(inferAuthEndpoints(endpoints), 2)
            : undefined,
      implementationMode: "pull-registry",
    });
  }

  for (const entityName of entityNames) {
    if (JUNCTION_OR_GLUE_SCREEN_ENTITIES.has(entityName.toLowerCase())) continue;

    const linked = linkedByEntity.get(entityName) ?? [];
    if (journeyFirst && linked.length === 0) {
      const coveredByAdmin = adminViews.some((v) => adminViewMatchesEntity(v, entityName));
      const hasScreenHint = screenHintByEntity.has(entityName.toLowerCase());
      if (!coveredByAdmin && !hasScreenHint) continue;
    }

    const primary = linked[0];
    const storyText = linked.map((s) => s.searchText).join(" ");
    const role = primary?.role ? normalizeRoleLabel(primary.role) : defaultRole;
    const isAuthFlow =
      AUTH_FLOW_ENTITIES.has(entityName.toLowerCase()) &&
      /login|mfa|auth|otp|iniciar sesi/i.test(storyText || primary?.title || "");
    const screenName = isAuthFlow
      ? primary?.title?.trim() || "Inicio de sesión"
      : primary?.title?.trim() || defaultEntityScreenName(entityName);
    let uiHint = isAuthFlow
      ? "form"
      : primary
        ? inferUiHintFromText(`${primary.want ?? ""} ${primary.title}`)
        : inferUiHintFromText(entityName);
    if (
      chatProductDeclared &&
      /convers|mensaje|whatsapp|chat|copiloto/i.test(entityName + storyText)
    ) {
      uiHint = "chat";
    }
    const matched = matchEndpointsForEntity(entityName, endpoints);
    const isPostActionOnly = entityHasPostWithoutGetList(matched);
    const primaryApi = resolvePrimaryApiForPlanItem(matched, {
      isAuthFlow,
      screenName,
      endpoints,
    });

    if (isPostActionOnly && !isAuthFlow) {
      uiHint = "form";
    }

    // Política v1: pantalla CRUD sin API ni HU → no generar (evita zombie screens)
    if (!primaryApi && linked.length === 0) continue;

    const routeFromMatrix = screenHintByEntity.get(entityName.toLowerCase());
    const route = resolveEntityScreenRoute(
      entityName,
      screenName,
      uiHint,
      isAuthFlow,
      matched,
      routeFromMatrix,
      chatProductDeclared,
    );
    if (uiHint === "chat" && !chatProductDeclared) {
      uiHint = inferUiHintFromText(entityName) ?? "table";
    }

    const purposeSuffix = isPostActionOnly
      ? " Pantalla de acción/detalle (sin listado GET v1)."
      : "";

    plan.push({
      name: entityName,
      keyFields:
        keyFieldsByEntity.get(entityName) ??
        keyFieldsByEntity.get(entityName.toLowerCase()) ??
        ["id"],
      restEndpoint: matched[0] ? `${matched[0].method} ${matched[0].path}` : undefined,
      classification: inferClassification(entityName, storyText),
      uiHint,
      screenName,
      purpose: (primary ? formatStoryPurpose(primary) : defaultEntityPurpose(entityName)) + purposeSuffix,
      resolveContext: primary ? resolveContextFromStory(primary) : undefined,
      userStoryRefs: linked.length > 0 ? linked.map(storyRef) : undefined,
      source: primary ? "entity+hu" : "entity",
      role,
      route,
      pageName: resolvePageNameForPlanItem({ screenName, route, name: entityName }, matched),
      uiStates: inferUiStates(screenName, uiHint),
      primaryApi: primaryApi && primaryApi !== "—" ? primaryApi : undefined,
      userStoryId: primary?.id,
      implementationMode: "pull-registry",
    });
  }

  // Complex surfaces from domain corpus when missing in plan (solo si MDD declara producto chat)
  if (
    chatProductDeclared &&
    /whatsapp|wasender|conversaci[oó]n|mensaje/i.test(domainCorpus) &&
    !plan.some((p) => p.route === "/chat" || p.uiHint === "chat")
  ) {
    plan.push({
      name: "chat-shell",
      keyFields: ["id"],
      classification: "WorkflowProcess",
      uiHint: "chat",
      screenName: "Chat del copiloto",
      purpose: "Shell de conversación multi-turno (canal WhatsApp / web).",
      source: "hu-only",
      role: defaultRole,
      route: "/chat",
      pageName: "CopilotChatPage",
      uiStates: "loading, streaming, error, empty, hitl-paused",
      primaryApi: formatEndpointList(
        endpoints.filter((e) => /message|whatsapp|webhook|process/i.test(e.path)),
        2,
      ),
      implementationMode: "pull-registry",
    });
  }
  if (/bit[aá]cora|failed.?request|peticiones?\s+no\s+cumpl/i.test(domainCorpus) && !plan.some((p) => /bitacora|failed/i.test(p.name))) {
    plan.push({
      name: "failed_request_logs",
      keyFields: ["id"],
      classification: "DataRegistry",
      uiHint: "table",
      screenName: "Bitácora de peticiones no cumplidas",
      purpose: "Listar y revisar solicitudes fallidas / HITL.",
      source: "hu-only",
      role: "Admin",
      route: "/admin/bitacora",
      pageName: "FailedRequestsPage",
      uiStates: "loading, empty, error, success",
      primaryApi: formatEndpointList(
        endpoints.filter((e) => /failed|bitacora|bitácora/i.test(e.path)),
        2,
      ),
      implementationMode: "pull-registry",
    });
  }
  if (/\bmcp\b|bitrix/i.test(domainCorpus) && !plan.some((p) => /mcp/i.test(p.name))) {
    plan.push({
      name: "mcp_plugins",
      keyFields: ["id"],
      classification: "Configuration",
      uiHint: "wizard",
      screenName: "Registro de servidores MCP",
      purpose: "Wizard de registro dinámico de MCP (p. ej. Bitrix24) y herramientas.",
      source: "hu-only",
      role: "Super Admin",
      route: "/admin/mcp",
      pageName: "McpRegisterPage",
      uiStates: "loading, error, success, disabled",
      primaryApi: formatEndpointList(
        endpoints.filter((e) => /mcp/i.test(e.path)),
        2,
      ),
      implementationMode: "pull-registry",
    });
  }

  stories.forEach((story, idx) => {
    if (matchedStoryIndexes.has(idx)) return;
    const slug = huOnlyEntitySlug(story);
    let uiHint = inferUiHintFromText(story.searchText);
    if (chatProductDeclared && /whatsapp|chat|mensaje|convers/i.test(story.searchText)) {
      uiHint = "chat";
    }
    const screenName = story.title;
    const authEps = inferAuthEndpoints(endpoints);
    const matched = matchEndpointsForEntity(slug, endpoints);
    const isAuthStory = /login|auth|otp|mfa|iniciar sesi|inicio de sesi/i.test(screenName);
    const primaryApi = isAuthStory
      ? authEps.length > 0
        ? formatEndpointList(authEps, 2)
        : matched.length > 0
          ? formatEndpointList(matched, 2)
          : undefined
      : matched.length > 0
        ? formatEndpointList(matched, 2)
        : undefined;

    if (uiHint === "chat" && !chatProductDeclared) {
      uiHint = inferUiHintFromText(story.searchText) === "chat" ? "form" : uiHint;
    }

    plan.push({
      name: slug,
      keyFields: ["id"],
      restEndpoint: isAuthStory
        ? authEps[0]
          ? `${authEps[0].method} ${authEps[0].path}`
          : undefined
        : matched[0]
          ? `${matched[0].method} ${matched[0].path}`
          : undefined,
      classification: inferClassification(slug, story.searchText),
      uiHint,
      screenName,
      purpose: formatStoryPurpose(story),
      resolveContext: resolveContextFromStory(story),
      userStoryRefs: [storyRef(story)],
      source: "hu-only",
      role: story.role ? normalizeRoleLabel(story.role) : defaultRole,
      route: isAuthStory
          ? "/login"
          : uiHint === "chat" && chatProductDeclared
            ? "/chat"
            : inferScreenRoute(screenName, uiHint),
      pageName: isAuthStory
        ? "LoginPage"
        : resolvePageNameForPlanItem({ screenName, route: undefined, name: slug }, matched),
      uiStates: inferUiStates(screenName, uiHint),
      primaryApi: primaryApi && primaryApi !== "—" ? primaryApi : undefined,
      userStoryId: story.id,
      implementationMode: "pull-registry",
    });
  });

  // ProcessInventory surfaces (chat, admin, etc.) when not already covered
  for (const proc of inventory?.processes ?? []) {
    for (const hint of proc.screenHints ?? []) {
      if (hint === "chat" && !chatProductDeclared) continue;
      const route =
        hint === "chat" || (/whatsapp|mensaje/i.test(proc.name) && chatProductDeclared)
          ? "/chat"
          : hint === "admin" || /admin|bit[aá]cora/i.test(proc.name)
            ? `/admin/${proc.id.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}`
            : `/${hint.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}`;
      if (plan.some((p) => p.route === route || p.name === proc.id)) continue;
      plan.push({
        name: proc.id,
        keyFields: ["id"],
        classification: "WorkflowProcess",
        uiHint: hint === "chat" ? "chat" : hint === "admin" ? "table" : "form",
        screenName: proc.name,
        purpose: `Proceso: ${proc.name}${proc.trigger ? ` (trigger: ${proc.trigger})` : ""}`,
        source: "hu-only",
        role: defaultRole,
        route,
        pageName: inferPageComponentName(proc.name),
        uiStates: inferUiStates(proc.name, hint === "chat" ? "chat" : "table"),
        implementationMode: "pull-registry",
      });
    }
  }

  return finalizePantallaPlan(plan);
}

/** Dedup routes and assign v1InScope (API+US or hu-only journey). */
export function finalizePantallaPlan(plan: PantallaPlanItem[]): PantallaPlanItem[] {
  const seenRoutes = new Map<string, number>();
  const result: PantallaPlanItem[] = [];

  for (const item of plan) {
    const scoped = {
      ...item,
      v1InScope: resolvePantallaV1InScope(item),
    };
    const route = scoped.route?.replace(/\/+$/, "");
    if (route) {
      const prevIdx = seenRoutes.get(route);
      if (prevIdx != null) {
        const prev = result[prevIdx]!;
        const keepNew =
          scoped.v1InScope &&
          !prev.v1InScope &&
          Boolean(scoped.primaryApi);
        if (!keepNew) continue;
        result[prevIdx] = scoped;
        continue;
      }
      seenRoutes.set(route, result.length);
    }
    result.push(scoped);
  }
  return result;
}
