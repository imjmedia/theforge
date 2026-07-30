import {
  GOVERNANCE_DOCS_PREFIX,
  GOVERNANCE_INSTALL_TARGETS_PREFIX,
} from "@theforge/shared-types";
import type { ProjectGovernanceFacts } from "../suggest-agent-governance-artifacts.js";
import {
  defaultDocumentPathMapTable,
  defaultMultiTargetInstallTableRows,
  replaceFeatureDirPlaceholders,
} from "./install-map.util.js";
import { formatWorkshopSupplementSection } from "@theforge/shared-types";
import {
  buildSddConflictSection,
  contentHasSddConflicts,
  stripSddConflictSections,
} from "./sdd-conflict.util.js";

const AGENT_PROMPT_PATH = `${GOVERNANCE_DOCS_PREFIX}references/AGENT-PROMPT.md`;

const AGENTS_SDD_DUAL_SECTION = "## Documentos SDD (layout dual)";
const AGENTS_INSTALL_SECTION = "## Instalación de gobernanza";

export function buildAgentsDualSpecKitSection(featureDir?: string): string {
  return (
    AGENTS_SDD_DUAL_SECTION +
    "\n\n" +
    "Lee primero el layout **spec-kit** en la raíz del repo; `docs/sdd/*` es espejo para gobernanza. " +
    "**No te limites a MDD, Spec, Plan y Tasks**: implementa según el alcance del proyecto leyendo también arquitectura, casos, H.U., design system, pantallas, API, flujos, infra y ADRs cuando estén en el ZIP.\n\n" +
    defaultDocumentPathMapTable(featureDir) +
    "\n\n" +
    formatWorkshopSupplementSection(featureDir) +
    "\n"
  );
}

export function buildAgentsInstallSection(): string {
  return (
    AGENTS_INSTALL_SECTION +
    "\n\n" +
    "El ZIP incluye SSOT en `docs/agent-governance/` y bundles pre-mapeados en `" +
    GOVERNANCE_INSTALL_TARGETS_PREFIX +
    "{target}/`. Instala según tu IDE:\n\n" +
    "1. Lee `IMPLEMENT.md` y `.specify/memory/constitution.md`.\n" +
    "2. Lee `docs/agent-governance/COMO-USAR-GOBERNANZA-IA.md` y `docs/agent-governance/INSTALACION.md`.\n" +
    "3. Ejecuta `scripts/install-governance-{tu-ide}.sh` o copia desde `install-targets/{tu-ide}/`.\n" +
    "4. Pega **`PROMPT-INICIAL.{tu-ide}.md`** en sesión 0 (índice en `PROMPT-INICIAL.md`).\n\n" +
    defaultMultiTargetInstallTableRows() +
    "\n\n" +
    "- **Uso del paquete:** `docs/agent-governance/COMO-USAR-GOBERNANZA-IA.md`\n" +
    "- **Onboarding:** `docs/agent-governance/agent-onboarding.md`\n"
  );
}

const AGENTS_INSTALL_CANONICAL_MARKERS = [
  "install-targets/",
  "install-governance-",
  "PROMPT-INICIAL.{tu-ide}.md",
  "docs/agent-governance/references/*",
  ".cursor/references/*",
] as const;

export function extractMarkdownSection(
  content: string,
  heading: string,
): { start: number; end: number; text: string } | null {
  const idx = content.indexOf(heading);
  if (idx < 0) return null;
  const afterHeading = idx + heading.length;
  const rest = content.slice(afterHeading);
  const nextHeading = rest.search(/\n## [^#]/);
  const end = nextHeading >= 0 ? afterHeading + nextHeading : content.length;
  return { start: idx, end, text: content.slice(idx, end) };
}

export function replaceMarkdownSection(content: string, heading: string, replacement: string): string {
  const section = extractMarkdownSection(content, heading);
  if (!section) return content;
  const before = content.slice(0, section.start).trimEnd();
  const after = content.slice(section.end).trimStart();
  const parts = [before, replacement.trimEnd()];
  if (after) parts.push(after);
  return `${parts.join("\n\n")}\n`;
}

export function isStaleAgentsInstallSection(section: string): boolean {
  if (/\.cursor\/specifications\//i.test(section)) return true;
  if (/\.cursor\/workflows\//i.test(section)) return true;
  return AGENTS_INSTALL_CANONICAL_MARKERS.some((marker) => !section.includes(marker));
}

const AGENTS_CRITICAL_RULES_SECTION = "## Reglas críticas";

export function buildAgentsCriticalRulesSection(): string {
  return (
    AGENTS_CRITICAL_RULES_SECTION +
    "\n\n" +
    "Estas reglas aplican **independientemente del IDE** (Antigravity, Copilot, Codex, etc.):\n\n" +
    "1. **Git:** conventional commits cuando el repo los use; sin `Co-authored-by` de agentes IA salvo petición explícita.\n" +
    "2. **Stack:** respeta el MDD §2 y Blueprint; no introduzcas frameworks no documentados.\n" +
    "3. **Seguridad:** auth, secretos y contratos API según MDD §6 y `api-contracts.md`.\n" +
    "4. **SDD:** ante conflicto entre artefactos, **gana el MDD**; reporta gaps vía MCP `report_documentation_gap` si aplica.\n" +
    "5. **Alcance:** implementa solo la tarea abierta; no expandas scope sin aprobación.\n" +
    "6. **Frontend / Design System:** toda creación de UI debe seguir los **tokens y estilos** de **`design-system.md`** (espejo `docs/sdd/ux-ui-guide.md`); sin valores ad-hoc.\n"
  );
}

export function defaultAgentsMd(featureDir?: string): string {
  return (
    "# AGENTS\n\n" +
    "Punto de entrada para agentes de código. Usa **`PROMPT-INICIAL.{tu-ide}.md`** en sesión 0.\n\n" +
    buildAgentsCriticalRulesSection().trimEnd() +
    "\n\n" +
    buildAgentsDualSpecKitSection(featureDir).trimEnd() +
    "\n\n" +
    buildAgentsInstallSection().trimEnd() +
    "\n"
  );
}
export function buildCursorAgentMd(role: string, description: string, loadPaths: string[]): string {
  return (
    `# Subagente: ${role}\n\n` +
    `${description}\n\n` +
    "## Cuándo delegar\n\n" +
    `- Tareas acotadas de ${role.toLowerCase()} sin tocar otras capas.\n\n` +
    "## Cargar antes de actuar\n\n" +
    loadPaths.map((p) => `- \`${p}\``).join("\n") +
    "\n\n## Gates\n\n" +
    "- Lint, typecheck y tests del paquete tocado.\n" +
    "- Respeta contratos y auth del MDD.\n"
  );
}

export function buildDynamicCursorAgents(facts: ProjectGovernanceFacts): Record<string, string> {
  const out: Record<string, string> = {};
  if (facts.mobileStack) {
    out[`${GOVERNANCE_DOCS_PREFIX}agents/mobile-implementer.md`] = buildCursorAgentMd(
      "Mobile",
      `Implementación ${facts.mobileStack} según MDD §2 y Blueprint.`,
      ["AGENTS.md", "docs/sdd/mdd.md", "docs/sdd/blueprint.md", "docs/sdd/tasks.md"],
    );
  }
  if (facts.backendStack) {
    out[`${GOVERNANCE_DOCS_PREFIX}agents/backend-implementer.md`] = buildCursorAgentMd(
      "Backend",
      `API y lógica ${facts.backendStack} según MDD §4 y Architecture.`,
      ["AGENTS.md", "docs/sdd/mdd.md", "docs/sdd/architecture.md", "docs/sdd/api-contracts.md"],
    );
  }
  if (facts.hasUiSurface && (facts.frontendStack || facts.mobileStack)) {
    const stack = facts.frontendStack ?? facts.mobileStack ?? "UI";
    out[`${GOVERNANCE_DOCS_PREFIX}agents/frontend-implementer.md`] = buildCursorAgentMd(
      "Frontend",
      `UI ${stack}: toda creación de frontend debe usar tokens y estilos de **design-system.md** (Design System).`,
      [
        "AGENTS.md",
        "docs/sdd/mdd.md",
        "docs/sdd/ux-ui-guide.md",
        "specs/NNN-slug/design-system.md",
        "docs/sdd/pantallas.md",
        "docs/sdd/blueprint.md",
      ],
    );
  }
  return out;
}

export function buildDynamicCursorCommands(facts: ProjectGovernanceFacts): Record<string, string> {
  const out: Record<string, string> = {};
  out[`${GOVERNANCE_DOCS_PREFIX}commands/implementar-tarea.md`] =
    "# Implementar tarea\n\n" +
    `1. Lee \`${AGENT_PROMPT_PATH}\` y la tarea pendiente en \`docs/sdd/tasks.md\` (espejo spec-kit).\n` +
    "2. Actualiza `docs/sdd/PROGRESO.md` al terminar.\n" +
    "3. Ejecuta gates del paquete (lint, typecheck, tests).\n";

  if (facts.backendStack) {
    out[`${GOVERNANCE_DOCS_PREFIX}commands/revisar-api.md`] =
      "# Revisar contratos API\n\n" +
      "Valida cambios contra `docs/sdd/api-contracts.md` y MDD §4.\n";
  }
  return out;
}
export function appendSddConflictToAgents(content: string, facts: ProjectGovernanceFacts): string {
  const section = buildSddConflictSection(facts);
  if (!section.trim()) return stripSddConflictSections(content);
  if (contentHasSddConflicts(content, facts)) return content;
  const base = stripSddConflictSections(content);
  return `${base.trimEnd()}\n\n${section.trim()}\n`;
}
export function ensureAgentsCanonicalSections(fileMap: Record<string, string>, featureDir?: string): void {
  const path = "AGENTS.md";
  let current = fileMap[path]?.trim() ?? "";

  if (!current.includes(AGENTS_CRITICAL_RULES_SECTION)) {
    const critical = buildAgentsCriticalRulesSection().trimEnd();
    if (current.length > 0) {
      const lines = current.split("\n");
      let insertAt = lines[0]?.startsWith("#") ? 1 : 0;
      while (insertAt < lines.length && (lines[insertAt] ?? "").trim() === "") insertAt++;
      const before = lines.slice(0, insertAt).join("\n");
      const after = lines.slice(insertAt).join("\n");
      current = `${before.trimEnd()}\n\n${critical}${after.trim() ? `\n\n${after}` : ""}`;
    } else {
      current = critical;
    }
    fileMap[path] = current;
  }

  current = fileMap[path]?.trim() ?? "";
  if (!current.includes(AGENTS_SDD_DUAL_SECTION)) {
    const dualSection = buildAgentsDualSpecKitSection(featureDir).trimEnd();
    if (current.length > 0) {
      const lines = current.split("\n");
      let insertAt = lines[0]?.startsWith("#") ? 1 : 0;
      while (insertAt < lines.length && (lines[insertAt] ?? "").trim() === "") insertAt++;
      const before = lines.slice(0, insertAt).join("\n");
      const after = lines.slice(insertAt).join("\n");
      current = `${before.trimEnd()}\n\n${dualSection}${after.trim() ? `\n\n${after}` : ""}`;
    } else {
      current = dualSection;
    }
    fileMap[path] = current;
  }

  current = fileMap[path]?.trim() ?? "";
  if (current.includes(AGENTS_INSTALL_SECTION)) {
    const installSection = extractMarkdownSection(current, AGENTS_INSTALL_SECTION);
    if (installSection && isStaleAgentsInstallSection(installSection.text)) {
      fileMap[path] = replaceMarkdownSection(current, AGENTS_INSTALL_SECTION, buildAgentsInstallSection());
    }
  } else {
    fileMap[path] = `${current.trimEnd()}\n\n${buildAgentsInstallSection().trimEnd()}\n`;
  }

  if (featureDir?.trim()) {
    fileMap[path] = replaceFeatureDirPlaceholders(fileMap[path] ?? "", featureDir.trim());
  }
}
