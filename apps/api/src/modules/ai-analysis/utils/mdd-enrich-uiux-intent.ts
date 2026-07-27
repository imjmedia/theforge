/**
 * @fileoverview Enriquecimiento UI/UX del MDD con intents de diseño.
 */

import { extractSection3Body } from "./mdd-sanitize.js";
import { mddExcludesWebUiSurface } from "./mdd-sanitize/internal.js";
import {
  heuristicUiComponentResolver,
  type UiComponentResolver,
} from "../../ui-mcp/ui-component-resolver.js";
import { extractRolesFromMdd, shouldAvoidKanban } from "../../ui-mcp/ui-screen-routes.util.js";
import { THEFORGE_PLATFORM_NOISE_TABLES } from "../../engine/mdd-platform-table-strip.util.js";

// ---------------------------------------------------------------------------
// UI/UX Design Intent Enrichment
// ---------------------------------------------------------------------------

/**
 * Clasificación semántica de una entidad de dominio (solo heurística §3 → fuera de alcance/Kanban).
 */
type EntityClassification = "WorkflowProcess" | "DataRegistry" | "Configuration";

/**
 * Heurísticas para clasificar una entidad según su nombre.
 */
function classifyEntity(name: string): EntityClassification {
  const lower = name.toLowerCase();

  // Logs / outbox / sesiones — registros append-only o técnicos, no kanban
  if (/^audit_events?$/.test(lower) || /^outbox_events?$/.test(lower) || /^sessions?$/.test(lower)) {
    return "DataRegistry";
  }

  // Configuraciones — entidades de parámetros, precios, settings
  const configPatterns = [
    /^config/, /^setting/, /^param/, /^price/, /^rate/, /^fee/,
    /^tariff/, /^threshold/, /^policy/, /^rule/, /^plan$/,
    /^promotion/, /^discount/, /^tax/, /^commission/,
  ];
  if (configPatterns.some((p) => p.test(lower))) return "Configuration";

  // WorkflowProcess — entidades con lifecycle (verbos, estados)
  const workflowPatterns = [
    /order/, /request/, /task/, /job/, /booking/, /reservation/,
    /appointment/, /claim/, /ticket/, /shipment/, /delivery/,
    /invoice/, /payment/, /transaction/, /application/,
    /process/, /workflow/, /campaign/, /project$/,
    /session/, /review/, /audit/, /subscription/,
    /enrollment/, /registration/, /nomination/, /proposal/,
    /incident/, /complaint/, /feedback/, /evaluation/,
    /approval/, /leave/, /attendance/, /notification/,
  ];
  if (workflowPatterns.some((p) => p.test(lower))) return "WorkflowProcess";

  // DataRegistry — entidades CRUD (sustantivos, referencias, catálogos)
  const registryPatterns = [
    /user/, /customer/, /client/, /member/, /patient/,
    /employee/, /vendor/, /supplier/, /partner/,
    /product/, /service/, /item/, /inventory/,
    /category/, /tag/, /label/, /type$/, /status/,
    /role/, /permission/, /group/, /team/, /department/,
    /location/, /address/, /branch/, /office/, /store/,
    /account/, /profile/, /contact/, /document$/,
    /file/, /image/, /asset/, /resource/,
    /template/, /content/, /article/, /post/,
    /schedule/, /calendar/, /event/,
  ];
  if (registryPatterns.some((p) => p.test(lower))) return "DataRegistry";

  // Por defecto: DataRegistry (seguro)
  return "DataRegistry";
}

/** Parsea los nombres de entidades (CREATE TABLE) de la sección §3 del MDD. */
function parseEntitiesFromSection3(section3: string): string[] {
  const entities: string[] = [];
  const regex = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:`|"|'|)(\w+)(?:`|"|'|)/gi;
  let match;
  while ((match = regex.exec(section3)) !== null) {
    const name = match[1];
    if (name && !entities.includes(name)) {
      entities.push(name);
    }
  }
  return entities;
}

/** Parsea entidades de dominio §3 excluyendo tablas ruido plataforma no mencionadas en §1. */
function parseDomainEntitiesFromSection3(section3: string, mddMarkdown: string): string[] {
  const all = parseEntitiesFromSection3(section3);
  const sec1 = (mddMarkdown.match(/(?:^|\n)##\s*1\.[\s\S]*?(?=\n##\s|\n#\s|$)/i)?.[0] ?? "").toLowerCase();
  return all.filter((name) => {
    if (!THEFORGE_PLATFORM_NOISE_TABLES.has(name)) return true;
    const needle = name.replace(/_/g, "[\\s_-]*");
    return new RegExp(needle, "i").test(sec1);
  });
}

function corpusMentionsTenantQuotaLlm(mddMarkdown: string): boolean {
  return /\b(tenant[s]?\s+quota|quota\s+(?:llm|ia|tokens?)|l[ií]mite\s+(?:de\s+)?(?:tokens?|ia|llm)|token\s+limit)\b/i.test(
    mddMarkdown,
  );
}

function buildPersonaJourneyParagraphs(
  roles: string[],
  entityCount: number,
  options: { cliOnly: boolean },
): string[] {
  const paragraphs: string[] = [];
  for (const role of roles.slice(0, 4)) {
    if (options.cliOnly) {
      paragraphs.push(
        `**${role}** opera vía API REST y CLI según §1; sin panel web en MVP. ` +
          `Flujos documentados en historias de usuario y \`api-contracts.md\` (${entityCount} entidades de dominio en §3).`,
      );
      continue;
    }
    paragraphs.push(
      `**${role}** accede al producto con objetivos concretos del dominio descrito en §1. ` +
        `Su journey principal combina autenticación y tareas sobre datos del modelo §3 ` +
        `(${entityCount} entidades de dominio) sin asumir un CRUD por tabla. ` +
        `Las pantallas, rutas y APIs ejecutables se documentan en \`pantallas.md\` y deben trazarse a historias de usuario.`,
    );
  }
  if (paragraphs.length < 2 && roles.length === 1) {
    paragraphs.push(
      options.cliOnly
        ? `Los flujos CLI/API conectan onboarding, operación diaria y tareas puntuales; estados de error y vacío deben documentarse en contratos y US.`
        : `El flujo transversal conecta onboarding, operación diaria y tareas puntuales (formularios, listados, feedback). ` +
            `Prioriza journeys completos sobre pantallas aisladas por entidad; estados \`loading\`, \`empty\` y \`error\` son obligatorios en login, dashboard y listados principales.`,
    );
  }
  return paragraphs.slice(0, 4);
}

/**
 * Genera la sección UI/UX Design Intent orientada a journeys (no mapeo entidad→componente).
 */
async function buildUiUxDesignIntentSection(
  mddMarkdown: string,
  section3: string,
): Promise<string | null> {
  const entityNames = parseDomainEntitiesFromSection3(section3, mddMarkdown);
  if (entityNames.length === 0) return null;

  const cliOnly = mddExcludesWebUiSurface(mddMarkdown);
  const roles = extractRolesFromMdd(mddMarkdown);
  const kanbanCandidates = entityNames.filter(
    (n) => classifyEntity(n) === "WorkflowProcess" && !shouldAvoidKanban(n),
  );
  const adminOnlyEntities = entityNames.filter(
    (n) => shouldAvoidKanban(n) || classifyEntity(n) === "Configuration",
  );

  const lines: string[] = [];
  lines.push("## UI/UX Design Intent");
  lines.push("");
  lines.push(
    "> Directrices de alto nivel para UI. El mapa ejecutable **pantalla → ruta → componente UI → API** " +
      "vive en `pantallas.md`. **No** uses tabla entidad→componente ni `GET /api/v1/{tabla}` genéricos.",
  );
  lines.push("");

  lines.push("### Personas y journeys");
  lines.push("");
  for (const p of buildPersonaJourneyParagraphs(roles, entityNames.length, { cliOnly })) {
    lines.push(p);
    lines.push("");
  }

  lines.push("### Matriz pantalla→componente");
  lines.push("");
  lines.push(
    "Detalle ejecutable en **`pantallas.md`** (spec-kit). Resumen de columnas obligatorias:",
  );
  lines.push("");
  lines.push("| Ruta | Componentes UI | API (api-contracts) | Estados |");
  lines.push("|------|----------------|---------------------|---------|");
  lines.push(
    "| _ver pantallas.md_ | _catálogo MCP activo o shadcn_ | _método + ruta exacta_ | _loading, empty, error_ |",
  );
  lines.push("");
  lines.push(
    "Roles con nav: " + roles.map((r) => `\`${r}\``).join(", ") + ". Cada fila de `pantallas.md` debe trazarse a una US con **🎨 Criterios UI**.",
  );
  lines.push("");

  lines.push("### Reglas de composición");
  lines.push("");
  lines.push("- **Formularios** = componente formulario del stack + schema Zod alineado al DTO de `api-contracts.md`.");
  lines.push("- **Listados** = tabla + filtros + paginación (nombres según `pantallas.md` / MCP activo); bajo `md` → cards apiladas.");
  lines.push("- **Dashboard** = KPIs + gráficas según catálogo activo; sin duplicar métricas sin US.");
  lines.push("- **Pipeline arrastrable (Kanban)** solo si el journey lo exige (validar en `pantallas.md`).");
  lines.push("- Endpoints **solo** de `api-contracts.md`; tokens **solo** de `design-system.md`.");
  lines.push("");

  lines.push("### Componentes transversales");
  lines.push("");
  if (!cliOnly) {
    lines.push("- **Layout shell** (`AppLayout` o equivalente): nav por rol (ítems, iconos, orden); rutas protegidas JWT (`role`, `tenant_id`).");
  }
  lines.push("- **Estado vacío:** CTA contextual en listados sin datos.");
  lines.push("- **Toast / feedback:** éxito tras POST/PUT; errores API cerca del formulario o banner.");
  if (corpusMentionsTenantQuotaLlm(mddMarkdown)) {
    lines.push("- **Modales globales:** quota LLM 80%/100% (documentar trigger en Tasks).");
  }
  lines.push("- **Responsive:** sm 640 / md 768 / lg 1024 / xl 1280; touch ≥ 44×44px; WCAG AA.");
  lines.push("");

  lines.push("### Fuera de alcance UI v1");
  lines.push("");
  lines.push("- CRUD admin por entidad §3 sin endpoint en `api-contracts.md`.");
  lines.push("- Pipeline arrastrable (Kanban) en entidades técnicas (sesiones OTP, audit logs, outbox).");
  if (kanbanCandidates.length > 0) {
    lines.push(
      `- Pipeline visual para \`${kanbanCandidates.slice(0, 6).join("`, `")}\` — solo si una US lo exige explícitamente.`,
    );
  }
  if (adminOnlyEntities.length > 0) {
    lines.push(
      `- Configuración interna (\`${adminOnlyEntities.slice(0, 8).join("`, `")}\`) sin pantalla en user stories.`,
    );
  }
  lines.push("");

  lines.push("### Referencia cruzada");
  lines.push("");
  lines.push("| Artefacto | Rol |");
  lines.push("|---|---|");
  lines.push("| `design-system.md` | Tokens, tema, accesibilidad (única SSOT visual) |");
  lines.push("| `pantallas.md` | Ruta, componentes UI, API, estados (**gana** sobre Blueprint §8) |");
  lines.push("| `ui-project.json` | Prototipo MCP (opcional; solo si el MCP activo lo soporta) |");
  lines.push("| `user-stories.md` / `tasks.md` | 🎨 Criterios UI y tareas **por pantalla** |");
  lines.push("");

  return lines.join("\n") + "\n";
}

/**
 * Enriquecimiento semántico: analiza el MDD y añade la sección
 * "## UI/UX Design Intent" con clasificación de entidades y sugerencias de UI.
 */
export async function enrichMddWithUiUxDesignIntent(
  markdown: string,
  _resolver: UiComponentResolver = heuristicUiComponentResolver,
): Promise<string> {
  const trimmed = (markdown ?? "").trim();
  if (!trimmed) return markdown;
  if (mddExcludesWebUiSurface(trimmed)) return markdown;
  if (/^##\s*UI\/UX\s+Design\s+Intent/im.test(trimmed) && isCompleteUiUxIntent(trimmed) && !isLegacyEntityUiIntent(trimmed)) {
    return markdown;
  }

  const section3 = extractSection3Body(trimmed);
  if (!section3) return markdown;

  const core = isLegacyEntityUiIntent(trimmed)
    ? stripUiUxDesignIntentSections(trimmed)
    : stripEmbeddedDesignIntentBlocks(trimmed);

  const section = await buildUiUxDesignIntentSection(core, section3);
  if (!section) return markdown;
  return `${core}\n\n${section}`;
}

function stripEmbeddedDesignIntentBlocks(markdown: string): string {
  return markdown
    .replace(
      /\n#{2,3}\s*(?:UI\/UX\s+)?Design\s+Intent[\s\S]*?(?=\n##\s+(?!#)|\n#\s+[-–—]{2,}|\n---\s*\n##|\n##\s+[1-7]\.\s|$)/gi,
      "",
    )
    .trimEnd();
}

function stripUiUxDesignIntentSections(markdown: string): string {
  let core = markdown.replace(/\n##\s*UI\/UX\s+Design\s+Intent[\s\S]*$/i, "").trim();
  core = stripEmbeddedDesignIntentBlocks(core);
  return core;
}

function isLegacyEntityUiIntent(markdown: string): boolean {
  return (
    /###\s*Entity Classification/i.test(markdown) ||
    /GET \/api\/v1\//i.test(markdown) ||
    /###\s*Journeys y roles/i.test(markdown) ||
    /###\s*Dominio §3 — \*\*no\*\* auto-mapear/i.test(markdown)
  );
}

function isCompleteUiUxIntent(markdown: string): boolean {
  return (
    /###\s*Personas y journeys/i.test(markdown) &&
    /###\s*Matriz pantalla/i.test(markdown) &&
    /###\s*Reglas de composición/i.test(markdown) &&
    /###\s*Componentes transversales/i.test(markdown) &&
    /###\s*Fuera de alcance UI v1/i.test(markdown)
  );
}

/** Regenera UI/UX cuando la sección existente usa columnas genéricas repetidas. */
export async function reconcileUiUxDesignIntent(
  markdown: string,
  _resolver: UiComponentResolver = heuristicUiComponentResolver,
): Promise<string> {
  const trimmed = (markdown ?? "").trim();
  if (!trimmed) return markdown;
  if (mddExcludesWebUiSurface(trimmed)) return markdown;

  const section3 = extractSection3Body(trimmed);
  if (!section3) return markdown;

  const hasUi = /##\s*UI\/UX\s+Design\s+Intent/i.test(trimmed);
  const legacy = isLegacyEntityUiIntent(trimmed);
  const complete = isCompleteUiUxIntent(trimmed);
  const genericHits = (trimmed.match(/\bid,\s*name,\s*status\b/g) ?? []).length;
  if (hasUi && complete && !legacy && genericHits < 4) return markdown;

  const core = hasUi || /#{2,3}\s*(?:UI\/UX\s+)?Design\s+Intent/i.test(trimmed)
    ? stripUiUxDesignIntentSections(trimmed)
    : stripEmbeddedDesignIntentBlocks(trimmed);

  const section = await buildUiUxDesignIntentSection(core, section3);
  if (!section) return markdown;
  return `${core}\n\n${section}`;
}