import type { ComplexityLevel, ProjectType } from "@theforge/shared-types";
import { GOVERNANCE_DOCS_PREFIX, detectWebSurfaces } from "@theforge/shared-types";
import { selectedPatternIdsFromMdd } from "@theforge/shared-types/mdd-governance-patterns";
import {
  complexityAtLeast,
  GOVERNANCE_ARCHETYPES,
  RULE_CATALOG,
  SKILL_CATALOG,
  type GovernanceArtifactStrength,
  type RuleCatalogEntry,
  type SkillCatalogEntry,
  type ArtifactTemplateContext,
} from "./agent-governance-catalog.js";

export interface RuleSpec {
  id: string;
  path: string;
  purpose: string;
  strength: GovernanceArtifactStrength;
}

export interface SkillSpec {
  id: string;
  path: string;
  folder: string;
  purpose: string;
  strength: GovernanceArtifactStrength;
}

export interface AgentGovernanceSuggestions {
  archetypes: string[];
  suggestedRules: RuleSpec[];
  suggestedSkills: SkillSpec[];
  rationale: string[];
}

export interface SuggestAgentGovernanceInput {
  mddMarkdown: string;
  blueprintMarkdown?: string | null;
  tasksMarkdown?: string | null;
  architectureMarkdown?: string | null;
  specMarkdown?: string | null;
  apiContractsMarkdown?: string | null;
  logicFlowsMarkdown?: string | null;
  uxUiGuideMarkdown?: string | null;
  uiScreensMarkdown?: string | null;
  infraMarkdown?: string | null;
  useCasesMarkdown?: string | null;
  userStoriesMarkdown?: string | null;
  /** Nombre del proyecto en TheForge (fallback si MDD §1 no tiene título). */
  projectName?: string | null;
  projectId?: string | null;
  stageId?: string | null;
  stageOrdinal?: number | null;
  /** NEW = greenfield; LEGACY = brownfield (Ariadne). Sin valor → NEW. */
  projectType?: ProjectType | null;
  complexity: ComplexityLevel;
  /** Gaps SDD cross-artifact pendientes (precisión). */
  sddPendingGaps?: string[];
}

export interface ProjectGovernanceFacts {
  projectTitle: string;
  projectId?: string;
  stageId?: string;
  stageOrdinal?: number;
  backendStack?: string;
  frontendStack?: string;
  mobileStack?: string;
  infraStack?: string;
  docPaths: string[];
  taskHeadings: string[];
  taskCheckboxes: string[];
  architectureLayers: string[];
  blueprintModules: string[];
  backendGlobs: string[];
  frontendGlobs: string[];
  npmScripts: string[];
  sddConflicts: string[];
  hasUiSurface: boolean;
}

function corpus(input: SuggestAgentGovernanceInput): string {
  return [
    input.mddMarkdown,
    input.blueprintMarkdown ?? "",
    input.tasksMarkdown ?? "",
    input.architectureMarkdown ?? "",
    input.specMarkdown ?? "",
    input.apiContractsMarkdown ?? "",
    input.logicFlowsMarkdown ?? "",
    input.uxUiGuideMarkdown ?? "",
    input.uiScreensMarkdown ?? "",
    input.infraMarkdown ?? "",
    input.useCasesMarkdown ?? "",
    input.userStoriesMarkdown ?? "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

function normalizeProjectTitleCandidate(raw: string): string | null {
  const trimmed = raw
    .trim()
    .replace(/^\*+|\*+$/g, "")
    .replace(/^[-*]\s+/, "")
    .replace(/^["'`]|["'`]$/g, "");
  if (!trimmed || /^#/.test(trimmed)) return null;
  if (/^este documento constituye/i.test(trimmed)) return null;
  const beforeBreak = trimmed.split(/\s*[—–-]\s+/)[0]?.split(/:\s+/)[0]?.trim();
  if (!beforeBreak || beforeBreak.length < 3) return null;
  if (/^master design document$/i.test(beforeBreak)) return null;
  if (/^documento maestro de dise/i.test(beforeBreak)) return null;
  return beforeBreak.slice(0, 120);
}

function isGenericMddH1(h1: string | undefined): boolean {
  if (!h1?.trim()) return true;
  const normalized = normalizeProjectTitleCandidate(h1);
  if (!normalized) return true;
  return (
    /^mdd\b/i.test(normalized) ||
    /^master design document$/i.test(normalized) ||
    /^documento maestro de dise/i.test(normalized)
  );
}

/** Extrae título de alta confianza desde §1 (bold entre paréntesis o em-dash). */
function extractTitleFromSection1(mdd: string): string | null {
  const sec1Match = mdd.match(/##\s*1\.[^\n]*\n([\s\S]*?)(?=\n##\s|\n#\s|$)/i);
  if (!sec1Match?.[1]) return null;
  const sec1 = sec1Match[1];

  const boldParen = sec1.match(/\*\*\(([^)]+)\)\*\*|\*\(([^)]+)\)\*/);
  if (boldParen) {
    const fromParen = (boldParen[1] ?? boldParen[2])?.trim();
    if (fromParen && fromParen.length >= 3) return fromParen.slice(0, 120);
  }

  for (const line of sec1.split("\n")) {
    const emDash = line.match(/^([^—–\n]{3,80})\s*[—–]\s+/);
    if (emDash?.[1]) {
      const candidate = normalizeProjectTitleCandidate(emDash[1]);
      if (candidate) return candidate;
    }
  }

  return null;
}

function extractTitleFromSection1Fallback(mdd: string): string | null {
  const sec1Match = mdd.match(/##\s*1\.[^\n]*\n([\s\S]*?)(?=\n##\s|\n#\s|$)/i);
  if (!sec1Match?.[1]) return null;
  for (const line of sec1Match[1].split("\n")) {
    const candidate = normalizeProjectTitleCandidate(line);
    if (candidate) return candidate;
  }
  return null;
}

/** MDD §1 o primer H1 como título del proyecto. */
export function extractProjectTitle(input: SuggestAgentGovernanceInput): string {
  const mdd = input.mddMarkdown ?? "";
  const fromProject = input.projectName?.trim();
  if (fromProject) return fromProject.slice(0, 120);

  const fromSec1 = extractTitleFromSection1(mdd);
  if (fromSec1) return fromSec1;
  const h1 = mdd.match(/^#\s+(.+)$/m)?.[1]?.trim();
  const genericH1 = isGenericMddH1(h1);
  if (h1 && !genericH1) {
    const fromH1 = normalizeProjectTitleCandidate(h1);
    if (fromH1) return fromH1;
  }
  const fromSec1Fallback = extractTitleFromSection1Fallback(mdd);
  if (fromSec1Fallback) return fromSec1Fallback;
  const named = mdd.match(/(?:nombre|proyecto|project)[:\s]+([^\n]+)/i)?.[1]?.trim();
  if (named) {
    const fromNamed = normalizeProjectTitleCandidate(named);
    if (fromNamed) return fromNamed;
  }
  return "Proyecto TheForge";
}

const ORM_BOILERPLATE_LINE_PATTERNS: RegExp[] = [
  /nest\/prisma\/typeorm/i,
  /prisma\/typeorm/i,
  /schema\.prisma.*(?:según|cuando|typeorm)/i,
  /typeorm.*schema\.prisma/i,
  /no inventar ORM/i,
  /no describas TypeORM/i,
  /Esquema de Prisma del Blueprint/i,
  /apunta a entidades.*schema\.prisma/i,
  /Monorepo Turborepo con NestJS, React, Prisma/i,
];

function extractMddSection(text: string, sectionNum: number): string {
  const re = new RegExp(
    `##\\s*${sectionNum}\\.[^\\n]*\\n([\\s\\S]*?)(?=\\n##\\s+\\d+\\.|\\n#\\s|$)`,
    "i",
  );
  return text.match(re)?.[1]?.trim() ?? "";
}

/** Cuerpo acotado de §2 (hasta el siguiente ## N.) para conflictos de stack en corpus multi-doc. */
function extractMddSection2Bounded(text: string): string {
  const bounded = text.match(/##\s*2\.[^\n]*\n([\s\S]*?)(?=\n##\s+\d+\.)/i)?.[1]?.trim();
  if (bounded) return bounded;
  const fallback = extractMddSection(text, 2);
  if (!fallback) return "";
  return fallback.split(/\n\n+/)[0]?.trim() ?? fallback;
}

function mentionsOrm(text: string, orm: "typeorm" | "prisma"): boolean {
  const re = orm === "typeorm" ? /\btypeorm\b/i : /\bprisma\b/i;
  return re.test(text);
}

/** Extrae bloque ```json ... ``` de una sección MDD (p. ej. §7 manifest). */
export function extractManifestJsonFromMddSection(section: string): Record<string, unknown> | undefined {
  const m = section.match(/```json\s*([\s\S]*?)```/i);
  if (!m?.[1]) return undefined;
  try {
    const obj = JSON.parse(m[1].trim()) as Record<string, unknown>;
    return typeof obj === "object" && obj !== null ? obj : undefined;
  } catch {
    return undefined;
  }
}

function normalizeOrmToken(value: string): "typeorm" | "prisma" | null {
  const v = value.trim().toLowerCase();
  if (v === "typeorm") return "typeorm";
  if (v === "prisma") return "prisma";
  return null;
}

/** ORM declarado en manifest §7 (`"orm": "typeorm"` plano o anidado en stack.backend). */
export function resolveOrmFromManifest(manifest: Record<string, unknown>): "typeorm" | "prisma" | null {
  const direct = manifest.orm;
  if (typeof direct === "string") {
    const norm = normalizeOrmToken(direct);
    if (norm) return norm;
  }
  const stack = manifest.stack as Record<string, unknown> | undefined;
  const backend = stack?.backend as Record<string, unknown> | undefined;
  const backendOrm = backend?.orm;
  if (typeof backendOrm === "string") {
    const norm = normalizeOrmToken(backendOrm);
    if (norm) return norm;
  }
  return null;
}

function isOrmBoilerplateLine(line: string): boolean {
  return ORM_BOILERPLATE_LINE_PATTERNS.some((re) => re.test(line));
}

function stripOrmBoilerplateLines(text: string): string {
  return text
    .split("\n")
    .filter((line) => !isOrmBoilerplateLine(line))
    .join("\n");
}

/** Cuerpo principal de §2 (antes del primer ## interno) para autoridad de stack/ORM/broker. */
function extractMddSection2StackAuthority(text: string): string {
  const sec2 = extractMddSection(text, 2);
  if (!sec2) return "";
  const primary = sec2.split(/\n##\s+/)[0]?.trim() ?? sec2;
  return stripOrmBoilerplateLines(primary);
}

function extractMddSection2PrimaryProse(text: string): string {
  const sec2 = extractMddSection(text, 2);
  if (!sec2) return "";
  return sec2.split(/\n##\s+/)[0]?.trim() ?? sec2;
}

/** Resuelve broker/cola dominante desde MDD §2 antes de marcar conflicto Kafka/RabbitMQ. */
export function resolveAuthoritativeMessageBroker(
  text: string,
): "bull" | "kafka" | "rabbitmq" | "conflict" | "unknown" {
  const authority = extractMddSection2PrimaryProse(text) || extractMddSection(text, 2) || text;
  const hasBull = /bullmq|\bbull\b/i.test(authority);
  const hasRedis = /\bredis\b/i.test(authority);
  const hasKafka = /kafka/i.test(authority);
  const hasRabbit = /rabbitmq/i.test(authority);

  if (hasBull || (hasRedis && !hasKafka && !hasRabbit)) return "bull";
  if (hasKafka && hasRabbit) return "conflict";
  if (hasKafka) return "kafka";
  if (hasRabbit) return "rabbitmq";
  return "unknown";
}

/** Resuelve ORM dominante desde MDD §2/§3, manifest §7 y corpus completo. */
export function resolveAuthoritativeOrm(text: string): "typeorm" | "prisma" | "conflict" | "unknown" {
  const sec2 = extractMddSection2StackAuthority(text);
  const sec2Typeorm = mentionsOrm(sec2, "typeorm");
  const sec2Prisma = mentionsOrm(sec2, "prisma");
  if (sec2Typeorm && !sec2Prisma) return "typeorm";
  if (sec2Prisma && !sec2Typeorm) return "prisma";
  if (sec2Typeorm && sec2Prisma) return "conflict";

  const sec3 = stripOrmBoilerplateLines(extractMddSection(text, 3));
  const sec3Typeorm = mentionsOrm(sec3, "typeorm");
  const sec3Prisma = mentionsOrm(sec3, "prisma");
  if (sec3Typeorm && !sec3Prisma) return "typeorm";
  if (sec3Prisma && !sec3Typeorm) return "prisma";
  if (sec3Typeorm && sec3Prisma) return "conflict";

  const sec7 = extractMddSection(text, 7);
  const manifest = extractManifestJsonFromMddSection(sec7);
  if (manifest) {
    const fromManifest = resolveOrmFromManifest(manifest);
    if (fromManifest === "typeorm" && !sec2Prisma && !sec3Prisma) return "typeorm";
    if (fromManifest === "prisma" && !sec2Typeorm && !sec3Typeorm) return "prisma";
    if (fromManifest === "typeorm" && (sec2Prisma || sec3Prisma)) return "conflict";
    if (fromManifest === "prisma" && (sec2Typeorm || sec3Typeorm)) return "conflict";
  }

  const cleaned = stripOrmBoilerplateLines(text);
  const corpusTypeorm = mentionsOrm(cleaned, "typeorm");
  const corpusPrisma = mentionsOrm(cleaned, "prisma");
  if (corpusTypeorm && !corpusPrisma) return "typeorm";
  if (corpusPrisma && !corpusTypeorm) return "prisma";

  return "unknown";
}

/** Resuelve gestor de paquetes desde MDD §2, manifest §7, overlay gobernanza y corpus. */
export function resolveAuthoritativePackageManager(
  mddMarkdown: string,
  extraCorpus?: string,
): "pnpm" | "yarn" | "npm" | null {
  const sec2 = extractMddSection(mddMarkdown, 2);
  const sec7 = extractMddSection(mddMarkdown, 7);
  const combined = [sec2, sec7, extraCorpus, mddMarkdown].filter(Boolean).join("\n");

  if (/pnpm-lock\.yaml|pnpm\s+workspace|\bpnpm\b/i.test(sec2)) return "pnpm";
  if (/yarn\.lock|\byarn\s+workspace\b/i.test(sec2)) return "yarn";
  if (/\bnpm\s+(?:install|ci|run)\b/i.test(sec2) && !/\bpnpm\b/i.test(sec2)) return "npm";

  const manifest = extractManifestJsonFromMddSection(sec7);
  if (manifest) {
    const pmField = manifest.packageManager;
    if (typeof pmField === "string") {
      if (/pnpm/i.test(pmField)) return "pnpm";
      if (/yarn/i.test(pmField)) return "yarn";
      if (/npm/i.test(pmField)) return "npm";
    }
    const stack = manifest.stack as Record<string, unknown> | undefined;
    const tooling = stack?.tooling as Record<string, unknown> | undefined;
    const stackPm = tooling?.package_manager ?? tooling?.packageManager;
    if (typeof stackPm === "string") {
      if (/pnpm/i.test(stackPm)) return "pnpm";
      if (/yarn/i.test(stackPm)) return "yarn";
      if (/npm/i.test(stackPm)) return "npm";
    }
  }

  if (extraCorpus && /\bpnpm\b/i.test(extraCorpus)) return "pnpm";

  if (/\bpnpm\b/i.test(mddMarkdown)) return "pnpm";

  if (
    /apps\/[\w-]+[\s\S]*packages\/|turborepo|monorepo[\s\S]{0,120}packages\//i.test(combined) &&
    !/yarn\.lock/i.test(combined)
  ) {
    return "pnpm";
  }

  if (/\byarn\b/i.test(mddMarkdown)) return "yarn";
  if (/\bnpm\b/i.test(mddMarkdown) && !/\bpnpm\b/i.test(mddMarkdown)) return "npm";

  return null;
}

/** Contradicciones frecuentes entre entregables SDD. */
export function detectSddConflicts(text: string): string[] {
  const conflicts: string[] = [];
  const ormResolution = resolveAuthoritativeOrm(text);
  if (ormResolution === "conflict") {
    conflicts.push(
      "TypeORM vs Prisma: prioriza el ORM declarado en MDD §2/Blueprint; no mezcles ambos en el mismo servicio.",
    );
  } else if (ormResolution === "unknown") {
    const cleaned = stripOrmBoilerplateLines(text);
    if (mentionsOrm(cleaned, "typeorm") && mentionsOrm(cleaned, "prisma")) {
      conflicts.push(
        "TypeORM vs Prisma: prioriza el ORM declarado en MDD §2/Blueprint; no mezcles ambos en el mismo servicio.",
      );
    }
  }
  const brokerResolution = resolveAuthoritativeMessageBroker(text);
  if (brokerResolution === "bull") {
    if (/kafka/i.test(text) || /rabbitmq/i.test(text)) {
      conflicts.push(
        "Cola/mensajería: prioriza BullMQ + Redis del MDD §2; ignora menciones sueltas de RabbitMQ/Kafka en Blueprint u otros entregables.",
      );
    }
  } else if (brokerResolution === "rabbitmq") {
    if (/bullmq|\bbull\b/i.test(text)) {
      conflicts.push(
        "Cola/mensajería: prioriza RabbitMQ del MDD §2; no uses BullMQ/Bull en workers ni tasks.",
      );
    }
  } else if (brokerResolution === "conflict") {
    conflicts.push(
      "Kafka vs RabbitMQ: usa el broker del MDD §2; no dupliques colas ni consumidores.",
    );
  } else if (brokerResolution === "unknown" && /kafka/i.test(text) && /rabbitmq/i.test(text)) {
    conflicts.push(
      "Kafka vs RabbitMQ: usa el broker del MDD §2; no dupliques colas ni consumidores.",
    );
  }
  const sec6 = extractMddSection(text, 6);
  if (/RS256|JWT_PRIVATE_KEY|par\s+de\s+claves/i.test(sec6)) {
    if (/\bJWT_SECRET\b/.test(text) && !/JWT_SECRET.*deprecad/i.test(text)) {
      conflicts.push(
        "JWT: prioriza RS256 con JWT_PRIVATE_KEY / JWT_PUBLIC_KEY (PEM); JWT_SECRET (HS256) quedó deprecado.",
      );
    }
  }
  if (
    /\bbcrypt\b/i.test(sec6) &&
    !/Argon2(?:id)?/i.test(sec6) &&
    /"hashing_algorithm"\s*:\s*"Argon2id"/i.test(text)
  ) {
    conflicts.push(
      "Hashing bootstrap: §6 documenta bcrypt (factor 12) para Super Admin; manifest debe usar bcrypt, no Argon2id.",
    );
  }
  const authoritativeUi = extractMddSection(text, 1) + "\n" + extractMddSection(text, 2);
  if (NO_UI_SURFACE_PATTERN.test(authoritativeUi) && /react hook form/i.test(text)) {
    conflicts.push(
      "Frontend: MVP API + CLI sin panel web; menciones a React Hook Form / UI web son post-MVP.",
    );
  }
  if (/mysql/i.test(text) && /postgres/i.test(text) && !/mysql.*postgres|postgres.*mysql/i.test(text)) {
    conflicts.push(
      "MySQL vs PostgreSQL: confirma el motor en MDD §3 antes de migraciones o schemas.",
    );
  }
  const sec2 = extractMddSection2Bounded(text);
  if (sec2.trim()) {
    const sec2Stacks = inferStacks(sec2);
    const rest = text.replace(sec2, "");
    const altStacks = inferStacks(rest);
    if (
      sec2Stacks.backend &&
      altStacks.backend &&
      sec2Stacks.backend.toLowerCase() !== altStacks.backend.toLowerCase()
    ) {
      conflicts.push(
        `Stack backend: prioriza ${sec2Stacks.backend} del MDD §2; no uses ${altStacks.backend} en Blueprint/Tasks/governance.`,
      );
    }
    if (sec2Stacks.infra && altStacks.infra && sec2Stacks.infra !== altStacks.infra) {
      conflicts.push(
        `Infra/deploy: prioriza ${sec2Stacks.infra} del MDD §2; no uses ${altStacks.infra} en otros entregables.`,
      );
    }
  }
  return conflicts;
}

/** Filtra extractos de tasks que mencionan stack ajeno al MDD §2. */
export function filterTaskExcerptsForProjectStack(
  items: string[],
  facts: Pick<ProjectGovernanceFacts, "backendStack">,
): string[] {
  const backend = (facts.backendStack ?? "").toLowerCase();
  if (!backend) return items;

  const rejectPatterns: RegExp[] = [];
  if (/spring/i.test(backend)) {
    rejectPatterns.push(/\bnestjs\b/i, /\bprisma\b/i, /schema\.prisma/i, /\bnest\//i);
  }
  if (/nestjs/i.test(backend)) {
    rejectPatterns.push(/\bspring\s*boot\b/i, /\btypeorm\b/i);
  }
  if (/typeorm/i.test(backend)) {
    rejectPatterns.push(/\bprisma\b/i, /schema\.prisma/i);
  }
  if (/prisma/i.test(backend)) {
    rejectPatterns.push(/\btypeorm\b/i);
  }

  if (rejectPatterns.length === 0) return items;
  const filtered = items.filter((line) => !rejectPatterns.some((re) => re.test(line)));
  return filtered.length > 0 ? filtered : items;
}

/** Primeras tareas concretas (checkboxes o headings) para AGENT-PROMPT y PROMPT-INICIAL. */
export function extractTaskCheckboxes(tasksMarkdown: string | null | undefined, limit = 5): string[] {
  const text = tasksMarkdown ?? "";
  const items: string[] = [];
  for (const line of text.split("\n")) {
    const checkbox = line.match(/^[-*]\s+\[ \]\s+(.+)/);
    if (checkbox?.[1]) {
      items.push(`- [ ] ${checkbox[1].trim().slice(0, 140)}`);
      if (items.length >= limit) return items;
    }
  }
  for (const line of text.split("\n")) {
    const bullet = line.match(/^[-*]\s+(?!\[)(.+)/);
    if (bullet?.[1] && bullet[1].trim().length > 4) {
      items.push(`- [ ] ${bullet[1].trim().slice(0, 140)}`);
      if (items.length >= limit) return items;
    }
  }
  for (const line of text.split("\n")) {
    const h = line.match(/^#{2,4}\s+(.+)/);
    if (h?.[1] && !/^(fase|sprint|epic|milestone)\b/i.test(h[1])) {
      items.push(`- [ ] ${h[1].trim().slice(0, 140)}`);
      if (items.length >= limit) return items;
    }
  }
  return items;
}

export const CLI_FRONTEND_STACK_LABEL = "CLI (Node/Commander) — sin panel web en MVP";

const NO_UI_SURFACE_PATTERN =
  /(?:sin|no)\s+(?:dashboard|frontend|ui|interfaz|pantalla|panel\s+web)|(?:mvp|fase\s*1)[^\n]{0,120}(?:sin|no\s+incluye|excluye|fuera\s+de)\s+(?:dashboard|frontend|ui|panel\s+web)|(?:panel|dashboard)\s+web[^\n]{0,40}fuera\s+del\s+alcance|fuera\s+del\s+alcance[^\n]{0,40}(?:mvp|panel\s+web|dashboard)|solo\s+APIs?\s+y\s+CLI|(?:panel|dashboard)\s+web\s+(?:fuera|excluido)|api[\s-]?only|mvp\s+api|cli[\s-]?only|solo\s+api|backend\s+only|without\s+dashboard|sin\s+interfaz|sin\s+dashboard/i;

const CLI_SURFACE_PATTERN =
  /cli[\s-]?only|mvp\s+cli|interfaz\s+(?:de\s+)?l[ií]nea\s+de\s+comandos|l[ií]nea\s+de\s+comandos|interfaz\s+cli|cliente\s+cli|command[\s-]?line|terminal\s+client|commander\s*\+\s*inquirer|\bcommander\b/i;

function detectCliSurface(authority: string): boolean {
  if (CLI_SURFACE_PATTERN.test(authority)) return true;
  return /\bCLI\b/.test(authority) && NO_UI_SURFACE_PATTERN.test(authority);
}

function hasUiSurface(
  text: string,
  authoritativeText?: string,
  mddMarkdown?: string | null,
  blueprintMarkdown?: string | null,
): boolean {
  const authority = authoritativeText ?? text;
  const noUiDeclared = NO_UI_SURFACE_PATTERN.test(authority);
  const mddSec2 = mddMarkdown ? extractMddSection(mddMarkdown, 2) : "";
  const webSurfacesDeclared = detectWebSurfaces(
    mddSec2 || mddMarkdown || "",
    blueprintMarkdown,
  );

  if (webSurfacesDeclared) return true;
  if (noUiDeclared) return false;

  return /react|vue|svelte|angular|next\.js|dashboard|frontend|\bui\b|mobile|expo|storybook|vite|tailwind|radix|shadcn/i.test(
    text,
  );
}

const ARIADNE_ACTIVE_SIGNALS: RegExp[] = [
  /\bintegraci[oó]n\s+mcp\s+ariadne\b/i,
  /\bmcp\s+ariadne\b/i,
  /\bAriadneSpecs\b/,
  /\bARIADNE_API\b/,
  /\.ariadne-project\b/,
  /\bvalidate_before_edit\b/,
  /\bget_component_graph\b/,
  /\bget_legacy_impact\b/,
  /\blist_known_projects\b/,
];

const DEFERRED_SCOPE_PATTERN =
  /(?:fase|phase)\s*2|futur[oa]s?|roadmap|opcional|planificad[oa]|m[aá]s\s+adelante|post-?mvp|considerar\s+integrar/i;

function isDeferredScopeContext(text: string, matchIndex: number, matchLength: number): boolean {
  const start = Math.max(0, matchIndex - 180);
  const end = Math.min(text.length, matchIndex + matchLength + 180);
  return DEFERRED_SCOPE_PATTERN.test(text.slice(start, end));
}

function hasActiveAriadneMention(text: string): boolean {
  for (const re of ARIADNE_ACTIVE_SIGNALS) {
    const flags = re.flags.includes("g") ? re.flags : `${re.flags}g`;
    const scanner = new RegExp(re.source, flags);
    let match: RegExpExecArray | null;
    while ((match = scanner.exec(text)) !== null) {
      if (!isDeferredScopeContext(text, match.index, match[0].length)) return true;
    }
  }

  const ariadneMention = /\bariadne\b/gi;
  let match: RegExpExecArray | null;
  while ((match = ariadneMention.exec(text)) !== null) {
    if (!isDeferredScopeContext(text, match.index, match[0].length)) return true;
  }

  return false;
}

function hasLegacyAriadneSignals(text: string): boolean {
  if (hasActiveAriadneMention(text)) return true;

  if (
    /strangler|código\s+existente|refactor\s+legacy/i.test(text) &&
    /\bariadne\b/i.test(text)
  ) {
    return true;
  }

  if (!/falkor/i.test(text)) return false;

  const falkorMention = /\bfalkor(?:db)?\b/gi;
  let match: RegExpExecArray | null;
  while ((match = falkorMention.exec(text)) !== null) {
    if (isDeferredScopeContext(text, match.index, match[0].length)) continue;
    if (/validate_before_edit|mcp\s+ariadne/i.test(text)) return true;
    if (
      /índice\s+de\s+código|grafo\s+de\s+código/i.test(text) &&
      /\bariadne\b|strangler|código\s+existente|refactor\s+legacy/i.test(text)
    ) {
      return true;
    }
  }

  return false;
}

function matchesSignals(text: string, signals: RegExp[]): boolean {
  return signals.some((re) => re.test(text));
}

const K8S_NEGATED_LINE =
  /\bsin\s+(?:gesti[oó]n\s+de\s+)?(?:kubernetes|\bk8s\b)|\bno\s+kubernetes|\bwithout\s+kubernetes|\bsin\s+kubernetes\s+en\s+v/i;

/** §7 con orchestrator PaaS (Railway/Fly) excluye skill/arquetipo K8s salvo despliegue explícito. */
function isKubernetesExcludedByPaaSOrchestrator(section7: string): boolean {
  if (!section7.trim()) return false;
  if (/"orchestrator"\s*:\s*"(?:Railway|Fly\.io|Fly|Dokploy|Render|Heroku)"/i.test(section7)) {
    return true;
  }
  if (
    /(?:orchestrator|provider|deployment_manager)\s*[:=]\s*["']?(?:Railway|Fly\.io|Fly|Dokploy)/i.test(
      section7,
    )
  ) {
    return true;
  }
  if (
    /producci[oó]n\s+en\s+(?:Railway|Fly)/i.test(section7) &&
    /sin\s+(?:kubernetes|\bk8s\b)/i.test(section7)
  ) {
    return true;
  }
  return false;
}

/** K8s/Helm como objetivo de despliegue, no menciones negadas ni scope v2 futuro. */
export function hasPositiveKubernetesSignals(text: string): boolean {
  for (const line of text.split("\n")) {
    if (!/kubernetes|\bk8s\b|\bhelm\b/i.test(line)) continue;
    if (K8S_NEGATED_LINE.test(line)) continue;
    if (/\bsin\s+kubernetes\s+en\s+v\d/i.test(line)) continue;
    if (/kubernetes\s*\(\s*v2\s*\)|\bk8s\b\s*\(\s*v2\s*\)/i.test(line)) continue;
    return true;
  }
  return false;
}

function detectKubernetesArchetype(mddMarkdown: string, fullText: string): boolean {
  const section7 = extractMddSection(mddMarkdown, 7) || extractMddSection(fullText, 7);
  if (isKubernetesExcludedByPaaSOrchestrator(section7)) return false;
  if (section7.trim() && hasPositiveKubernetesSignals(section7)) return true;
  return hasPositiveKubernetesSignals(mddMarkdown) || hasPositiveKubernetesSignals(fullText);
}

function detectArchetypes(
  text: string,
  complexity: ComplexityLevel,
  projectType: ProjectType | null | undefined,
  authoritativeUiText?: string,
  mddMarkdown?: string,
  blueprintMarkdown?: string | null,
): string[] {
  const found = new Set<string>();

  const hasBackend =
    /nestjs|express|fastify|fastapi|django|laravel|spring|hono|cloudflare\s+workers?|workers?\s+api/i.test(
      text,
    );
  const uiSurface = hasUiSurface(
    text,
    authoritativeUiText,
    mddMarkdown,
    blueprintMarkdown,
  );
  const hasFrontend = uiSurface && /react|vue|svelte|angular|next\.js/i.test(text);
  const hasMobile = uiSurface && /expo|react\s*native|react-native/i.test(text);
  const isMonorepo = /monorepo|lerna|pnpm\s+workspace|turborepo|packages\//i.test(text);
  const hasKubernetes = detectKubernetesArchetype(mddMarkdown ?? text, text);
  const hasDockerDeploy = /docker|dokploy|contenedor|railway|fly\.io/i.test(text);

  if (hasBackend && (hasFrontend || hasMobile) && isMonorepo) found.add("nestjs-react-monorepo");
  if (hasBackend && !hasFrontend && !hasMobile) found.add("api-only");
  if ((hasFrontend || hasMobile) && !hasBackend) found.add("spa-only");
  if (
    uiSurface &&
    (/design\s+system|paquete\s+ui|@\w+\/ui\b|storybook/i.test(text) ||
      detectWebSurfaces(
        extractMddSection(mddMarkdown ?? text, 2) || mddMarkdown || "",
        blueprintMarkdown,
      ))
  ) {
    found.add("design-system-ui");
  }
  if (projectType === "LEGACY" && hasLegacyAriadneSignals(text)) found.add("legacy-ariadne");
  if (/\bjwt\b|oauth|§\s*6|autenticaci[oó]n/i.test(text)) found.add("auth-jwt");
  if (hasKubernetes) found.add("kubernetes");
  else if (hasDockerDeploy || /§\s*7|serverless|cloudflare/i.test(text)) found.add("docker-dokploy");
  if (/\bmcp\b|model\s+context\s+protocol|figma\s+mcp/i.test(text)) found.add("mcp-enabled");

  if (complexity === "LOW" && found.size === 0) {
    if (hasBackend || hasFrontend || hasMobile) {
      found.add(
        hasBackend && (hasFrontend || hasMobile)
          ? "nestjs-react-monorepo"
          : hasBackend
            ? "api-only"
            : "spa-only",
      );
    }
  }

  return [...found].filter((a) =>
    (GOVERNANCE_ARCHETYPES as readonly string[]).includes(a),
  );
}

function firstMatchLabel(text: string, patterns: Array<[RegExp, string]>): string | undefined {
  for (const [re, label] of patterns) {
    if (re.test(text)) return label;
  }
  return undefined;
}

const BACKEND_STACK_PATTERNS: Array<[RegExp, string]> = [
  [/fastify/i, "Fastify"],
  [/fastapi/i, "FastAPI"],
  [/nestjs/i, "NestJS"],
  [/cloudflare\s+workers?|workers?\s+api/i, "Cloudflare Workers"],
  [/\bhono\b/i, "Hono"],
  [/express/i, "Express"],
  [/django/i, "Django"],
  [/laravel/i, "Laravel"],
  [/spring\s*boot/i, "Spring Boot"],
  [/go\s*\/\s*gin|\bgin\b.*go/i, "Go (Gin)"],
  [/supabase\s+edge/i, "Supabase Edge Functions"],
];

const INFRA_STACK_PATTERNS: Array<[RegExp, string]> = [
  [/railway/i, "Railway"],
  [/serverless/i, "Serverless"],
  [/cloudflare/i, "Cloudflare"],
  [/dokploy/i, "Dokploy"],
  [/kubernetes|\bk8s\b/i, "Kubernetes"],
  [/docker/i, "Docker"],
];

export function inferStacks(
  text: string,
  options?: {
    authoritativeUiText?: string;
    authoritativeStackText?: string;
    mddMarkdown?: string | null;
    blueprintMarkdown?: string | null;
  },
): {
  backend?: string;
  frontend?: string;
  mobile?: string;
  infra?: string;
} {
  const authority = options?.authoritativeUiText ?? text;
  const stackAuthority = options?.authoritativeStackText?.trim() || text;
  const uiSurface = hasUiSurface(
    text,
    authority,
    options?.mddMarkdown,
    options?.blueprintMarkdown,
  );

  const backendFromAuthority =
    firstMatchLabel(stackAuthority, BACKEND_STACK_PATTERNS) ??
    stackAuthority.match(/(?:backend|servidor|api)[:\s]+([A-Za-z][A-Za-z0-9.\s/]{1,48})/i)?.[1]
      ?.trim()
      .split(/\s/)[0];
  const backend =
    backendFromAuthority ??
    firstMatchLabel(text, BACKEND_STACK_PATTERNS);

  const mobile = uiSurface
    ? firstMatchLabel(text, [
        [/react\s*native|react-native/i, "React Native"],
        [/\bexpo\b/i, "Expo"],
        [/flutter/i, "Flutter"],
      ])
    : undefined;

  let frontend: string | undefined;
  if (uiSurface) {
    frontend = mobile
      ? undefined
      : firstMatchLabel(text, [
          [/tailwind\s*\+\s*radix|radix\s*ui/i, "Tailwind + Radix UI"],
          [/tailwind/i, "Tailwind CSS"],
          [/shadcn/i, "shadcn/ui"],
          [/next\.js/i, "Next.js"],
          [/react/i, "React"],
          [/\bvue\b/i, "Vue"],
          [/svelte/i, "Svelte"],
          [/angular/i, "Angular"],
        ]);
  } else if (detectCliSurface(authority)) {
    frontend = CLI_FRONTEND_STACK_LABEL;
  }

  const infra =
    firstMatchLabel(stackAuthority, INFRA_STACK_PATTERNS) ??
    firstMatchLabel(text, INFRA_STACK_PATTERNS);

  const backendMatch = backendFromAuthority
    ? null
    : stackAuthority.match(
        /(?:backend|servidor|api)[:\s]+([A-Za-z][A-Za-z0-9.\s/]{1,48})/i,
      );
  const frontendMatch = uiSurface
    ? stackAuthority.match(/(?:frontend|cliente|ui|mobile)[:\s]+([A-Za-z][A-Za-z0-9.\s/]{1,48})/i)
    : null;

  return {
    backend: backend ?? backendMatch?.[1]?.trim().split(/\s/)[0],
    frontend: frontend ?? frontendMatch?.[1]?.trim().split(/\s/)[0],
    mobile,
    infra,
  };
}

function inferDomainSkillFolder(
  text: string,
  blueprintModules: string[],
  _projectName?: string | null,
): string | undefined {
  const scoreModule = (name: string): number => {
    const n = name.toLowerCase();
    if (/shared|common|utils|types|config|test|spec/i.test(n)) return 1;
    if (/backend|api|server|service|core|kms-/i.test(n)) return 10;
    if (/web|mobile|app|frontend|ui/i.test(n)) return 8;
    return 5;
  };

  const candidates: string[] = [];
  for (const mod of blueprintModules) {
    const clean = mod.replace(/[`'"\\]/g, "").trim().replace(/\/$/, "");
    if (!clean) continue;
    const segments = clean.split("/").filter(Boolean);
    const leaf = segments[segments.length - 1];
    if (leaf && !/^(src|lib|app|dist|test|tests)$/i.test(leaf)) {
      candidates.push(leaf);
      continue;
    }
    if (/^(apps|packages)$/i.test(segments[0] ?? "") && segments[1]) {
      candidates.push(segments[1]!);
      continue;
    }
    if (segments[0]) candidates.push(segments[0]!);
  }

  if (candidates.length > 0) {
    return [...candidates].sort((a, b) => scoreModule(b) - scoreModule(a))[0];
  }

  const treeDir = text.match(
    /(?:^|\n)[-*\s`]*([a-z0-9][a-z0-9_-]*(?:\/[a-z0-9_-]+)?)\/(?:src|lib|app)\//im,
  )?.[1];
  if (treeDir) {
    const base = treeDir.split("/").pop() ?? treeDir;
    if (base) return base;
  }
  const pkg = text.match(/packages\/([a-z0-9_-]+)/i)?.[1];
  if (pkg && scoreModule(pkg) > 1) return pkg;
  const app = text.match(/(?:^|\s|`)([a-z0-9_-]+)\/(?:src|lib|app)\//im)?.[1];
  if (app && !/^(apps|packages|src)$/i.test(app)) return app;
  return "project-package";
}

/** Palabras de prosa española frecuentes en blueprints SDD — no son rutas de repo. */
const BLUEPRINT_PROSE_DENYLIST = new Set([
  "entidades",
  "entidad",
  "todos",
  "todo",
  "si",
  "sí",
  "tabla",
  "tablas",
  "schemas",
  "schema",
  "en",
  "el",
  "la",
  "los",
  "las",
  "un",
  "una",
  "modulos",
  "módulos",
  "modulo",
  "módulo",
  "capa",
  "capas",
  "fase",
  "stack",
  "convenciones",
  "observabilidad",
  "autenticacion",
  "autenticación",
  "autorizacion",
  "autorización",
  "seguridad",
  "modelo",
  "datos",
  "implementacion",
  "implementación",
  "componentes",
  "transversales",
  "opcional",
  "pendiente",
  "nota",
  "ver",
  "usa",
  "usar",
  "con",
  "para",
  "desde",
  "cada",
  "otros",
  "otras",
  "lista",
  "listas",
  "incluye",
  "incluir",
  "cubre",
  "cubrir",
  "resumen",
  "detalle",
  "detalles",
  "seccion",
  "sección",
]);

function isBlueprintProseToken(token: string): boolean {
  const normalized = token
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "");
  return BLUEPRINT_PROSE_DENYLIST.has(normalized);
}

/** Valid repo path: kms-backend/, packages/foo/, apps/api/ — not prose bullets. */
export function isValidBlueprintModulePath(raw: string): boolean {
  const clean = raw.replace(/[`'"\\]/g, "").trim().replace(/\/$/, "");
  if (!clean || clean.length < 2 || clean.length > 80) return false;
  if (/[*:]/.test(raw)) return false;
  if (/\*\*[^*]+\*\*/.test(raw)) return false;
  if (/:\s*\S/.test(raw.trim())) return false;

  const segments = clean.split("/").filter(Boolean);
  if (segments.length === 0) return false;
  if (segments.some((s) => isBlueprintProseToken(s))) return false;

  const validSegment = (s: string) => /^[a-z0-9][a-z0-9._-]*$/i.test(s);
  if (!segments.every(validSegment)) return false;

  if (segments[0] === "apps" || segments[0] === "packages") {
    return segments.length >= 2 && segments.length <= 4;
  }
  if (/^kms-/i.test(segments[0]!)) {
    return segments.length <= 3;
  }
  if (segments.length === 1) {
    return false;
  }
  return false;
}

function extractBlueprintModuleFromLine(line: string): string | null {
  const trimmed = line.trim();
  if (!trimmed || /^#/.test(trimmed)) return null;

  const backtickPath = trimmed.match(/`([a-z0-9][a-z0-9._/-]*)`/i);
  if (backtickPath?.[1] && isValidBlueprintModulePath(backtickPath[1])) {
    return backtickPath[1].trim().replace(/\/$/, "");
  }

  const backtickBullet = trimmed.match(/^[-*]\s+`([^`\n]+)`/);
  if (backtickBullet?.[1] && isValidBlueprintModulePath(backtickBullet[1])) {
    return backtickBullet[1].trim().replace(/\/$/, "");
  }

  if (/^[-*]\s+[A-Za-zÀ-ÿ]+\s+`/i.test(trimmed)) {
    return null;
  }

  const tree = trimmed.match(
    /^[-*]?\s*`?((?:apps|packages|kms-[a-z0-9_-]+)(?:\/[a-z0-9._-]+)*)\/?`?(?:\s|$)/i,
  );
  if (tree?.[1] && isValidBlueprintModulePath(tree[1])) {
    return tree[1].trim().replace(/\/$/, "");
  }

  const indentedTree = trimmed.match(
    /^\s{2,}`?((?:apps|packages|kms-[a-z0-9_-]+)(?:\/[a-z0-9._-]+)*)\/?`?/i,
  );
  if (indentedTree?.[1] && isValidBlueprintModulePath(indentedTree[1])) {
    return indentedTree[1].trim().replace(/\/$/, "");
  }

  const inlinePath = trimmed.match(
    /\b((?:apps|packages|kms-[a-z0-9_-]+)(?:\/[a-z0-9._-]+)*)\/?(?:\s|$|[,.])/i,
  );
  if (inlinePath?.[1] && isValidBlueprintModulePath(inlinePath[1])) {
    return inlinePath[1].trim().replace(/\/$/, "");
  }

  return null;
}

function extractBlueprintModules(bpText: string): string[] {
  const tree: string[] = [];
  const bullets: string[] = [];

  for (const line of bpText.split("\n")) {
    const mod = extractBlueprintModuleFromLine(line);
    if (!mod) continue;
    const isTreeLine =
      /\/$/.test(line.trim()) ||
      /^\s{2,}/.test(line) ||
      /^(apps|packages|kms-)/i.test(mod);
    if (isTreeLine) tree.push(mod);
    else bullets.push(mod);
  }

  const merged = [...new Set([...tree, ...bullets])];
  const prioritized = [
    ...merged.filter((m) => m.includes("/") || /^kms-/i.test(m)),
    ...merged.filter((m) => !m.includes("/") && !/^kms-/i.test(m)),
  ];
  return prioritized.filter(isValidBlueprintModulePath).slice(0, 12);
}

/** Omite módulos que son solo tokens de prosa sin estructura de path real. */
function blueprintModulesForOverlay(modules: string[]): string[] {
  const valid = modules.filter(isValidBlueprintModulePath);
  const structured = valid.filter((m) => m.includes("/") || /^kms-/i.test(m));
  return structured;
}

function classifyGlobPath(path: string): "backend" | "frontend" | "both" {
  const p = path.toLowerCase();
  if (/web|ui|frontend|mobile|client|dashboard/.test(p)) return "frontend";
  if (/api|backend|server|kms-|worker|service/.test(p)) return "backend";
  return "both";
}

function inferCodebaseGlobs(blueprintModules: string[], text: string): {
  backend: string[];
  frontend: string[];
} {
  const backend = new Set<string>();
  const frontend = new Set<string>();
  const all = new Set<string>();

  for (const mod of blueprintModules) {
    const clean = mod.replace(/[`'"\\]/g, "").trim().replace(/\/$/, "");
    if (!clean || !isValidBlueprintModulePath(clean)) continue;
    all.add(`${clean}/**`);
    const kind = classifyGlobPath(clean);
    if (kind === "backend" || kind === "both") backend.add(`${clean}/**`);
    if (kind === "frontend" || kind === "both") frontend.add(`${clean}/**`);
  }

  for (const line of text.split("\n")) {
    const backtickDir = line.match(/`((?:apps|packages|kms-[a-z0-9_-]+)(?:\/[a-z0-9._-]+)*)\/?`/i)?.[1];
    const treeDir = line.match(
      /(?:^|\s)`?((?:apps|packages|kms-[a-z0-9_-]+)(?:\/[a-z0-9._-]+)+)\/?`?(?:\s|$)/i,
    )?.[1];
    const inlineDir = line.match(
      /\b((?:apps|packages|kms-[a-z0-9_-]+)(?:\/[a-z0-9._-]+)*)\/?(?:\s|$|[,.])/i,
    )?.[1];
    const dir = backtickDir ?? treeDir ?? inlineDir;
    if (!dir || !isValidBlueprintModulePath(dir)) continue;
    all.add(`${dir}/**`);
    const kind = classifyGlobPath(dir);
    if (kind === "backend" || kind === "both") backend.add(`${dir}/**`);
    if (kind === "frontend" || kind === "both") frontend.add(`${dir}/**`);
  }

  if (backend.size === 0) {
    backend.add("src/**");
    backend.add("packages/**/src/**");
  }
  if (frontend.size === 0 && hasUiSurface(text)) {
    frontend.add("apps/web/**");
    frontend.add("packages/**/src/**");
  }

  return {
    backend: [...backend].slice(0, 6),
    frontend: [...frontend].slice(0, 6),
  };
}

type PackageManager = "pnpm" | "npm" | "yarn";

function stripDockerfileBlocksForScriptInference(text: string): string {
  return text
    .replace(/```dockerfile[\s\S]*?```/gi, "")
    .replace(/^(?:FROM|RUN|COPY|WORKDIR|CMD|ENTRYPOINT|EXPOSE|ENV)\s+.+$/gim, "");
}

function detectPrimaryPackageManager(text: string): PackageManager {
  const corpus = stripDockerfileBlocksForScriptInference(text);
  const resolved = resolveAuthoritativePackageManager(corpus, corpus);
  if (resolved) return resolved;
  return "npm";
}

function inferNpmScripts(text: string): string[] {
  const corpus = stripDockerfileBlocksForScriptInference(text);
  const pm = detectPrimaryPackageManager(corpus);
  const scripts: string[] = [];

  if (pm === "pnpm") {
    if (/pnpm\s+(?:run\s+)?(?:test|lint|typecheck|build)/i.test(corpus)) {
      scripts.push("pnpm test / lint / typecheck / build");
    }
    for (const match of corpus.matchAll(/pnpm\s+(?:run\s+)?(test|lint|typecheck|build)\b/gi)) {
      scripts.push(`pnpm ${match[1]!.toLowerCase()}`);
    }
  } else if (pm === "yarn") {
    for (const match of corpus.matchAll(/yarn\s+(test|lint|typecheck|build)\b/gi)) {
      scripts.push(`yarn ${match[1]!.toLowerCase()}`);
    }
  } else {
    for (const match of corpus.matchAll(/npm\s+run\s+(test|lint|typecheck|build)\b/gi)) {
      scripts.push(`npm run ${match[1]!.toLowerCase()}`);
    }
  }

  if (/turbo\s+run\s+(\w+)/i.test(corpus)) {
    const turbo = corpus.match(/turbo\s+run\s+(\w+)/i)?.[1];
    if (turbo) scripts.push(`turbo run ${turbo}`);
  }

  const scriptBlock = corpus.match(/"scripts"\s*:\s*\{([^}]+)\}/s);
  if (scriptBlock?.[1]) {
    for (const m of scriptBlock[1].matchAll(/"(test|lint|typecheck|build)"/g)) {
      const cmd = m[1]!;
      if (pm === "pnpm") scripts.push(`pnpm ${cmd}`);
      else if (pm === "yarn") scripts.push(`yarn ${cmd}`);
      else scripts.push(`npm run ${cmd}`);
    }
  }

  if (scripts.length === 0 && pm === "pnpm") {
    scripts.push("pnpm build", "pnpm test", "pnpm lint");
  }

  return [...new Set(scripts)].slice(0, 6);
}

/** Extrae hechos estructurados del proyecto para inyectar en plantillas de gobernanza. */
export function extractProjectGovernanceFacts(
  input: SuggestAgentGovernanceInput,
): ProjectGovernanceFacts {
  const text = corpus(input);
  const authoritativeUiText = [input.mddMarkdown, input.specMarkdown].filter(Boolean).join("\n\n");
  const authoritativeStackText = extractMddSection(input.mddMarkdown ?? "", 2);
  const stacks = inferStacks(text, {
    authoritativeUiText,
    authoritativeStackText,
    mddMarkdown: input.mddMarkdown,
    blueprintMarkdown: input.blueprintMarkdown,
  });
  const projectTitle = extractProjectTitle(input);
  const blueprintModules = blueprintModulesForOverlay(
    extractBlueprintModules(input.blueprintMarkdown ?? ""),
  );
  const globs = inferCodebaseGlobs(blueprintModules, text);
  const taskCheckboxes = filterTaskExcerptsForProjectStack(
    extractTaskCheckboxes(input.tasksMarkdown),
    { backendStack: stacks.backend },
  );
  const sddConflicts = detectSddConflicts(text);
  const npmScriptCorpus = [authoritativeStackText, text].filter(Boolean).join("\n\n");

  const optionalDocs: Array<[boolean, string]> = [
    [!!input.blueprintMarkdown?.trim(), "docs/sdd/blueprint.md"],
    [!!input.specMarkdown?.trim(), "docs/sdd/spec.md"],
    [!!input.architectureMarkdown?.trim(), "docs/sdd/architecture.md"],
    [!!input.tasksMarkdown?.trim(), "docs/sdd/tasks.md"],
    [!!input.useCasesMarkdown?.trim(), "docs/sdd/use-cases.md"],
    [!!input.userStoriesMarkdown?.trim(), "docs/sdd/user-stories.md"],
    [!!input.apiContractsMarkdown?.trim(), "docs/sdd/api-contracts.md"],
    [!!input.logicFlowsMarkdown?.trim(), "docs/sdd/logic-flows.md"],
    [!!input.uxUiGuideMarkdown?.trim(), "docs/sdd/ux-ui-guide.md"],
    [!!input.uiScreensMarkdown?.trim(), "docs/sdd/pantallas.md"],
    [!!input.infraMarkdown?.trim(), "docs/sdd/infra.md"],
  ];

  const docPaths = [
    "docs/sdd/mdd.md",
    ...optionalDocs.filter(([ok]) => ok).map(([, p]) => p),
    `${GOVERNANCE_DOCS_PREFIX}references/THEFORGE-DOC-CONSUMPTION-GUIDE.md`,
    `${GOVERNANCE_DOCS_PREFIX}COMO-USAR-GOBERNANZA-IA.md`,
    "AGENTS.md",
  ];

  const taskHeadings: string[] = [];
  const tasksText = input.tasksMarkdown ?? "";
  for (const line of tasksText.split("\n")) {
    const h = line.match(/^#{1,3}\s+(.+)/);
    if (h?.[1]) taskHeadings.push(h[1].trim().slice(0, 120));
    if (taskHeadings.length >= 12) break;
  }

  const architectureLayers: string[] = [];
  const archText = input.architectureMarkdown ?? "";
  for (const line of archText.split("\n")) {
    const h = line.match(/^#{2,3}\s+(.+)/);
    if (h?.[1]) architectureLayers.push(h[1].trim().slice(0, 100));
    if (architectureLayers.length >= 10) break;
  }

  return {
    projectTitle,
    projectId: input.projectId ?? undefined,
    stageId: input.stageId ?? undefined,
    stageOrdinal: input.stageOrdinal ?? undefined,
    backendStack: stacks.backend,
    frontendStack: stacks.frontend,
    mobileStack: stacks.mobile,
    infraStack: stacks.infra,
    docPaths,
    taskHeadings,
    taskCheckboxes,
    architectureLayers,
    blueprintModules,
    backendGlobs: globs.backend,
    frontendGlobs: globs.frontend,
    npmScripts: inferNpmScripts(npmScriptCorpus),
    sddConflicts,
    hasUiSurface: hasUiSurface(
      text,
      authoritativeUiText,
      input.mddMarkdown,
      input.blueprintMarkdown,
    ),
  };
}

function wizardArchitectureActive(mdd: string): boolean {
  const ids = selectedPatternIdsFromMdd(mdd);
  const archIds = new Set([
    "hexagonal",
    "clean-architecture",
    "microservices",
    "monolith-modular",
    "cqrs",
    "event-driven",
    "soa",
    "serverless",
  ]);
  for (const id of ids) {
    if (archIds.has(id)) return true;
  }
  return false;
}

function ruleStrength(
  rule: RuleCatalogEntry,
  text: string,
  archetypes: string[],
  complexity: ComplexityLevel,
  projectType: ProjectType | null | undefined,
  authoritativeUiText?: string,
  uiScreensMarkdown?: string | null,
  mddMarkdown?: string | null,
  blueprintMarkdown?: string | null,
): GovernanceArtifactStrength | null {
  if (!complexityAtLeast(complexity, rule.minComplexity)) return null;

  if (rule.id === "git-commits") return "strong";
  if (rule.id === "orchestrator" && complexity !== "LOW") return "weak";

  if (
    rule.id === "stack-frontend" &&
    !hasUiSurface(text, authoritativeUiText, mddMarkdown, blueprintMarkdown)
  ) {
    return null;
  }

  if (rule.id === "ui-pantallas") {
    if (uiScreensMarkdown?.trim()) return "strong";
    if (!hasUiSurface(text, authoritativeUiText, mddMarkdown, blueprintMarkdown)) return null;
    return matchesSignals(text, rule.signals) ? "weak" : null;
  }

  const signalHit = matchesSignals(text, rule.signals);
  const archetypeHit = rule.archetypes?.some((a) => archetypes.includes(a)) ?? false;
  const wizardHit = rule.id === "architecture-patterns" && wizardArchitectureActive(text);

  if (!signalHit && !archetypeHit && !wizardHit) return null;

  if (rule.id === "git-commits" || rule.id === "stack-backend" || rule.id === "stack-frontend") {
    return signalHit || archetypeHit ? "strong" : "weak";
  }
  if (rule.id === "mcp-governance" && projectType === "LEGACY" && hasLegacyAriadneSignals(text)) {
    return "strong";
  }
  if (rule.id === "security-auth" && /\bjwt\b|oauth/i.test(text)) return "strong";
  if (wizardHit) return "strong";

  return signalHit && archetypeHit ? "strong" : signalHit || archetypeHit ? "weak" : null;
}

function skillStrength(
  skill: SkillCatalogEntry,
  text: string,
  archetypes: string[],
  complexity: ComplexityLevel,
  projectType: ProjectType | null | undefined,
  authoritativeUiText?: string,
  uiScreensMarkdown?: string | null,
  mddMarkdown?: string | null,
  blueprintMarkdown?: string | null,
): GovernanceArtifactStrength | null {
  if (!complexityAtLeast(complexity, skill.minComplexity)) return null;

  if (
    skill.id === "design-system-ui" &&
    !hasUiSurface(text, authoritativeUiText, mddMarkdown, blueprintMarkdown)
  ) {
    return null;
  }
  if (skill.id === "mcp-ariadne") {
    if (projectType !== "LEGACY" || !hasLegacyAriadneSignals(text)) return null;
  }

  if (skill.id === "ui-pantallas") {
    if (uiScreensMarkdown?.trim()) return "strong";
    if (!hasUiSurface(text, authoritativeUiText, mddMarkdown, blueprintMarkdown)) return null;
    return matchesSignals(text, skill.signals) ? "weak" : null;
  }

  const signalHit = matchesSignals(text, skill.signals);
  const archetypeHit = skill.archetypes?.some((a) => archetypes.includes(a)) ?? false;

  if (skill.id === "design-system-ui" && detectWebSurfaces(
    extractMddSection(mddMarkdown ?? text, 2) || mddMarkdown || "",
    blueprintMarkdown,
  )) {
    return archetypeHit || signalHit ? "strong" : "weak";
  }

  if (skill.id === "domain-package" && complexity !== "LOW") {
    return complexity === "HIGH" || signalHit ? "strong" : "weak";
  }

  if (skill.id === "deploy-docker") {
    if (archetypes.includes("kubernetes")) return null;
    if (archetypes.includes("docker-dokploy")) return signalHit ? "strong" : "weak";
  }
  if (skill.id === "deploy-kubernetes") {
    if (!archetypes.includes("kubernetes")) return null;
    return "strong";
  }

  if (!signalHit && !archetypeHit) return null;

  if (skill.id === "mcp-ariadne" && projectType === "LEGACY" && hasLegacyAriadneSignals(text)) {
    return "strong";
  }
  if (skill.id === "design-system-ui" && archetypes.includes("design-system-ui")) return "strong";
  if (skill.id === "ui-pantallas" && uiScreensMarkdown?.trim()) return "strong";

  return signalHit && archetypeHit ? "strong" : "weak";
}

function capByComplexity(
  rules: RuleSpec[],
  skills: SkillSpec[],
  complexity: ComplexityLevel,
): { rules: RuleSpec[]; skills: SkillSpec[] } {
  if (complexity === "LOW") {
    const git = rules.find((r) => r.id === "git-commits");
    const stack = rules.find((r) => r.id === "stack-backend" || r.id === "stack-frontend");
    return {
      rules: [git, stack].filter((r): r is RuleSpec => !!r).slice(0, 2),
      skills: [],
    };
  }
  if (complexity === "MEDIUM") {
    const uiPantallasSkill = skills.find((s) => s.id === "ui-pantallas");
    const otherSkills = skills.filter((s) => s.id !== "ui-pantallas");
    const capped = otherSkills.slice(0, uiPantallasSkill ? 1 : 2);
    if (uiPantallasSkill) capped.unshift(uiPantallasSkill);
    return {
      rules: rules.slice(0, 5),
      skills: capped.slice(0, 2),
    };
  }
  return {
    rules: rules.slice(0, 8),
    skills: skills.slice(0, 5),
  };
}

function resolveSkillPath(skill: SkillCatalogEntry, folder?: string): string {
  if (skill.dynamicFolder && folder) {
    return `docs/agent-governance/skills/${folder}/SKILL.md`;
  }
  return skill.path;
}

/**
 * Detecta arquetipos y artefactos (rules/skills) sugeridos desde MDD, Blueprint, Tasks, Architecture y complejidad.
 */
export function suggestAgentGovernanceArtifacts(
  input: SuggestAgentGovernanceInput,
): AgentGovernanceSuggestions {
  const text = corpus(input);
  const authoritativeUiText = [input.mddMarkdown, input.specMarkdown].filter(Boolean).join("\n\n");
  const projectType = input.projectType ?? "NEW";
  const archetypes = detectArchetypes(
    text,
    input.complexity,
    projectType,
    authoritativeUiText,
    input.mddMarkdown,
    input.blueprintMarkdown,
  );
  const rationale: string[] = [];
  const facts = extractProjectGovernanceFacts(input);
  const domainFolder = inferDomainSkillFolder(text, facts.blueprintModules, input.projectName);

  if (archetypes.length > 0) {
    rationale.push(`Arquetipos detectados: ${archetypes.join(", ")}.`);
  }

  const authoritativeStackText = extractMddSection(input.mddMarkdown ?? "", 2);
  const stacks = inferStacks(text, {
    authoritativeUiText,
    authoritativeStackText,
    mddMarkdown: input.mddMarkdown,
    blueprintMarkdown: input.blueprintMarkdown,
  });
  const stackParts = [stacks.backend, stacks.frontend, stacks.mobile, stacks.infra].filter(Boolean);
  if (stackParts.length > 0) {
    rationale.push(`Stack (MDD §2): ${stackParts.join(", ")}.`);
  }

  const suggestedRules: RuleSpec[] = [];
  for (const rule of RULE_CATALOG) {
    const strength = ruleStrength(
      rule,
      text,
      archetypes,
      input.complexity,
      projectType,
      authoritativeUiText,
      input.uiScreensMarkdown,
      input.mddMarkdown,
      input.blueprintMarkdown,
    );
    if (!strength) continue;
    suggestedRules.push({
      id: rule.id,
      path: rule.path,
      purpose: rule.description,
      strength,
    });
    rationale.push(
      `Rule \`${rule.id}\`: ${rule.description} (señal ${strength === "strong" ? "fuerte" : "moderada"}, min ${rule.minComplexity}).`,
    );
  }

  const suggestedSkills: SkillSpec[] = [];
  for (const skill of SKILL_CATALOG) {
    const strength = skillStrength(
      skill,
      text,
      archetypes,
      input.complexity,
      projectType,
      authoritativeUiText,
      input.uiScreensMarkdown,
      input.mddMarkdown,
      input.blueprintMarkdown,
    );
    if (!strength) continue;
    const folder = skill.dynamicFolder && domainFolder ? domainFolder : skill.folder;
    const path = resolveSkillPath(skill, folder);
    suggestedSkills.push({
      id: skill.id,
      path,
      folder,
      purpose: skill.description,
      strength,
    });
    rationale.push(
      `Skill \`${skill.id}\`: ${skill.description} (señal ${strength === "strong" ? "fuerte" : "moderada"}).`,
    );
  }

  const capped = capByComplexity(suggestedRules, suggestedSkills, input.complexity);

  if (input.complexity === "LOW") {
    rationale.push("Complejidad LOW: máximo 2 rules, sin skills obligatorias.");
  } else if (input.complexity === "HIGH" && archetypes.includes("nestjs-react-monorepo")) {
    rationale.push("Complejidad HIGH + monorepo: considerar AGENTS.md anidados bajo packages/.");
  }

  if (input.tasksMarkdown?.trim()) {
    rationale.push("Tasks disponibles: PROMPT-INICIAL, AGENT-PROMPT y PROGRESO derivados del checklist.");
  }
  if (facts.sddConflicts.length > 0) {
    rationale.push(`Conflictos SDD detectados: ${facts.sddConflicts.length} (ver AGENTS.md / AGENT-PROMPT).`);
  }

  return {
    archetypes,
    suggestedRules: capped.rules,
    suggestedSkills: capped.skills,
    rationale,
  };
}

/** Bloque para inyectar en el user prompt del LLM. */
export function formatSuggestedArtifactsPromptBlock(
  suggestions: AgentGovernanceSuggestions,
): string {
  const lines = [
    "## ARTEFACTOS SUGERIDOS (detector TheForge — obligatorio)",
    "",
    "Genera **exactamente** estos artefactos del catálogo (paths y propósito). " +
      "Puedes enriquecer el contenido con datos del MDD/Blueprint/Tasks/Architecture; **no** inventes otros skills " +
      "salvo **1** skill de dominio nombrada explícitamente en §1.",
    "",
  ];

  if (suggestions.archetypes.length > 0) {
    lines.push(`**Arquetipos:** ${suggestions.archetypes.join(", ")}`, "");
  }

  if (suggestions.suggestedRules.length > 0) {
    lines.push("### Rules a generar", "");
    for (const r of suggestions.suggestedRules) {
      lines.push(`- \`${r.path}\` — ${r.purpose} (señal: ${r.strength})`);
    }
    lines.push("");
  }

  if (suggestions.suggestedSkills.length > 0) {
    lines.push("### Skills a generar", "");
    for (const s of suggestions.suggestedSkills) {
      lines.push(`- \`${s.path}\` — ${s.purpose} (señal: ${s.strength})`);
    }
    lines.push("");
  }

  if (suggestions.rationale.length > 0) {
    lines.push("### Rationale (incluir resumen en COMO-USAR § tabla)", "");
    for (const r of suggestions.rationale.slice(0, 12)) {
      lines.push(`- ${r}`);
    }
  }

  return lines.join("\n");
}

export function buildArtifactTemplateContext(
  suggestions: AgentGovernanceSuggestions,
  complexity: ComplexityLevel,
  input: SuggestAgentGovernanceInput,
): ArtifactTemplateContext {
  const text = corpus(input);
  const authoritativeUiText = [input.mddMarkdown, input.specMarkdown].filter(Boolean).join("\n\n");
  const authoritativeStackText = extractMddSection(input.mddMarkdown ?? "", 2);
  const stacks = inferStacks(text, {
    authoritativeUiText,
    authoritativeStackText,
    mddMarkdown: input.mddMarkdown,
    blueprintMarkdown: input.blueprintMarkdown,
  });
  const facts = extractProjectGovernanceFacts(input);
  return {
    complexity,
    archetypes: suggestions.archetypes,
    domainSkillFolder: inferDomainSkillFolder(text, facts.blueprintModules, input.projectName),
    backendStack: stacks.backend,
    frontendStack: stacks.frontend ?? stacks.mobile,
    mobileStack: stacks.mobile,
    infraStack: stacks.infra,
    projectFacts: facts,
  };
}
