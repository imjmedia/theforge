import { Logger } from "@nestjs/common";
import {
  AGENT_GOVERNANCE_TEMPLATE_VERSION,
  buildGovernanceInstallMap,
  buildMultiTargetInstallMaps,
  buildTheforgeDocConsumptionGuide,
  expectedPromptInicialPaths,
  formatDocumentMarkdown,
  formatDocumentPathMapTable,
  GOVERNANCE_THEFORGE_DOC_CONSUMPTION_GUIDE,
  GOVERNANCE_DOCS_PREFIX,
  migrateGovernancePath,
  ROOT_THEFORGE_DOC_CONSUMPTION_GUIDE,
  type AgentGovernanceFile,
  type AgentGovernanceScaffold,
  type AgentGovernanceSuggestionsManifest,
  type ComplexityLevel,
  type GovernanceTarget,
  specKitFeatureDir,
} from "@theforge/shared-types";
import { buildAllPromptIniciales, buildPromptInicialIndexMd } from "./governance-prompt-inicial.js";
import { buildMultiTargetBundle, remapGovernanceScaffold } from "./governance-target-map.js";
import {
  getRuleById,
  getSkillById,
} from "./agent-governance-catalog.js";
import {
  buildArtifactTemplateContext,
  extractProjectGovernanceFacts,
  type AgentGovernanceSuggestions,
  type ProjectGovernanceFacts,
  type SuggestAgentGovernanceInput,
} from "./suggest-agent-governance-artifacts.js";
import {
  alignDeliverableMarkdownWithMddSecurity,
  detectTruncatedMddMarkdown,
  ensurePostMvpUiSurfaceBanner,
  sanitizeMddForExport,
} from "../../ai-analysis/utils/mdd-sanitize.js";
import {
  alignTasksWithMddConflicts,
  finalizeInfraMarkdownForExport,
  finalizeUserStoriesMarkdownForExport,
} from "../../documentation-gap/sdd-align-at-persist.util.js";
import { injectProposedComponentDiagramIntoSection2 } from "../../ai-analysis/utils/mdd-component-diagram.util.js";
import { qualifyBlueprintPostMvpUiMentions } from "../../engine/blueprint-enrich-ui-system.js";
import {
  defaultInstallMapTableRows,
  defaultDocumentPathMapTable,
  defaultMultiTargetInstallTableRows,
  replaceFeatureDirPlaceholders,
} from "./agent-governance/install-map.util.js";
import {
  buildSddConflictSection,
  buildSddConflictTable,
  stripSddConflictSections,
  contentHasSddConflicts,
} from "./agent-governance/sdd-conflict.util.js";
import {
  defaultTheforgeDocSyncRule,
  renderRuleFromCatalog,
} from "./agent-governance/rules-artifacts.util.js";
import {
  defaultTheforgeDocSyncSkill,
  renderSkillFromCatalog,
} from "./agent-governance/skills-artifacts.util.js";
import {
  appendSddConflictToAgents,
  buildDynamicCursorAgents,
  buildDynamicCursorCommands,
  defaultAgentsMd,
  ensureAgentsCanonicalSections,
} from "./agent-governance/agents-artifacts.util.js";

const logger = new Logger("AgentGovernanceUtil");

/** Rutas que siempre se regeneran desde plantillas canónicas (inmunes al LLM). */
const LLM_PROOF_CANONICAL_PATHS = [
  `${GOVERNANCE_DOCS_PREFIX}INSTALACION.md`,
  "scripts/install-agent-governance.sh",
  "scripts/install-governance-cursor.sh",
  "scripts/install-governance-antigravity.sh",
  "scripts/install-governance-claude-code.sh",
  "scripts/install-governance-github-copilot.sh",
  "scripts/install-governance-windsurf.sh",
  "scripts/install-governance-openhands.sh",
  "scripts/install-governance-all.sh",
] as const;

const DUPLICATE_PROMPT_PATHS = [
  `${GOVERNANCE_DOCS_PREFIX}PROMPT-INICIAL.md`,
  "docs/agent-governance/PROMPT-INICIAL.md",
] as const;

const DOC_CONSUMPTION_GUIDE_PATH = GOVERNANCE_THEFORGE_DOC_CONSUMPTION_GUIDE;

/** Contexto interno del proyecto para agentes (consumido por `/implementar-tarea`). */
export const AGENT_PROMPT_PATH = `${GOVERNANCE_DOCS_PREFIX}references/AGENT-PROMPT.md`;

/** Enlace MCP The Forge para agentes implementadores. */
export const THEFORGE_LINK_PATH = `${GOVERNANCE_DOCS_PREFIX}references/THEFORGE-LINK.md`;

/** Rule alwaysApply: sincronizar docs SDD vía MCP cuando el código contradice la documentación. */
export const THEFORGE_DOC_SYNC_RULE_PATH = `${GOVERNANCE_DOCS_PREFIX}rules/theforge-doc-sync.mdc`;

/** Skill: reportar gaps de documentación vía MCP The Forge. */
export const THEFORGE_DOC_SYNC_SKILL_PATH = `${GOVERNANCE_DOCS_PREFIX}skills/theforge-doc-sync/SKILL.md`;

/** Rutas obligatorias en todos los niveles de complejidad. */
export const AGENT_GOVERNANCE_REQUIRED_ALL = [
  "AGENTS.md",
  "CLAUDE.md",
  "PROMPT-INICIAL.md",
  AGENT_PROMPT_PATH,
  `${GOVERNANCE_DOCS_PREFIX}agent-onboarding.md`,
  `${GOVERNANCE_DOCS_PREFIX}COMO-USAR-GOBERNANZA-IA.md`,
  `${GOVERNANCE_DOCS_PREFIX}INSTALACION.md`,
  "docs/sdd/PROGRESO.md",
  THEFORGE_LINK_PATH,
  THEFORGE_DOC_SYNC_RULE_PATH,
  THEFORGE_DOC_SYNC_SKILL_PATH,
  `${GOVERNANCE_DOCS_PREFIX}mcp.json.example`,
] as const;

// ── Multi-target (export-only remap en governance-target-map.ts) ─────

export type { GovernanceTarget };
export { remapGovernanceScaffold };

/** Rutas obligatorias a partir de MEDIUM. */
export const AGENT_GOVERNANCE_REQUIRED_MEDIUM = [
  `${GOVERNANCE_DOCS_PREFIX}references/workflows.md`,
  `${GOVERNANCE_DOCS_PREFIX}references/CURSOR_SKILLS_Y_RULES.md`,
  `${GOVERNANCE_DOCS_PREFIX}references/PROMPT_HANDOFF_AGENTE.md`,
  "scripts/install-agent-governance.sh",
  GOVERNANCE_THEFORGE_DOC_CONSUMPTION_GUIDE,
  ROOT_THEFORGE_DOC_CONSUMPTION_GUIDE,
  "IMPLEMENT.md",
] as const;

function stripJsonFences(raw: string): string {
  return raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
}

function defaultClaudeShim(): string {
  return (
    "# Claude Code — Instrucciones del proyecto\n\n" +
    "Este archivo es el punto de entrada para **Claude Code** (claude.ai / Claude Code CLI).\n\n" +
    "## Carga automática\n\n" +
    "Claude Code carga este archivo al iniciar una sesión en el repositorio.\n\n" +
    "## Contenido\n\n" +
    "Lee `@AGENTS.md` para la gobernanza completa del proyecto (stack, reglas, skills, workflows).\n" +
    "Los archivos de referencia están en `docs/agent-governance/`.\n\n" +
    "## Comandos rápidos\n\n" +
    "- `npm run build` — build completo\n" +
    "- `npm run test` — tests unitarios\n" +
    "- `npm run lint` — lint del proyecto\n\n" +
    "## Reglas\n\n" +
    "- No uses la palabra \"militar\" — usa \"alta criticidad\" o \"misión crítica\".\n" +
    "- Sigue el MDD como constitución del proyecto.\n" +
    "- Usa los patrones de arquitectura definidos en el Blueprint.\n"
  );
}

function generateClaudeMdWithContext(facts: ProjectGovernanceFacts): string {
  const stack = [facts.backendStack, facts.frontendStack, facts.infraStack]
    .filter(Boolean)
    .join(", ");
  const sections: string[] = [
    `# ${facts.projectTitle} — Claude Code Instructions\n`,
    "## Stack\n",
    stack ? `${stack}\n` : "Ver MDD §2 para stack completo.\n",
    "## Commands\n",
    "- Build: `npm run build`",
    "- Test: `npm run test`",
    "- Lint: `npm run lint`",
    "",
    "## Architecture\n",
  ];
  if (facts.architectureLayers.length > 0) {
    sections.push(facts.architectureLayers.slice(0, 8).join(", ") + "\n");
  } else {
    sections.push("Ver docs/sdd/architecture.md\n");
  }
  if (facts.blueprintModules.length > 0) {
    sections.push("## Modules\n");
    sections.push(facts.blueprintModules.slice(0, 12).join(", ") + "\n");
  }
  sections.push("## Key Files\n");
  sections.push(facts.docPaths.slice(0, 8).map((f) => `- ${f}`).join("\n") + "\n");
  sections.push("## Rules\n");
  sections.push("- No uses \"militar\" — usa \"alta criticidad\" o \"misión crítica\".");
  sections.push("- Sigue el MDD como constitución del proyecto.");
  sections.push("- Usa los patrones de arquitectura definidos en el Blueprint.");
  if (facts.npmScripts.length > 0) {
    sections.push("\n## npm scripts\n");
    sections.push(facts.npmScripts.slice(0, 10).map((s) => `\`${s}\``).join(", ") + "\n");
  }
  sections.push("");
  return sections.join("\n");
}


function defaultDocConsumptionGuide(featureDir?: string): string {
  return buildTheforgeDocConsumptionGuide(featureDir);
}

function mcpJsonExampleSpecificityScore(content: string): number {
  const trimmed = content.trim();
  if (!trimmed) return -1;
  let score = trimmed.length;
  if (!/\{\{API_URL\}\}/.test(trimmed)) score += 500;
  if (!/\{\{MCP_M2M_SECRET\}\}/.test(trimmed)) score += 200;
  if (!/\{\{PROJECT_ID\}\}/.test(trimmed)) score += 50;
  try {
    const parsed = JSON.parse(trimmed) as { mcpServers?: Record<string, unknown> };
    const servers = parsed.mcpServers ?? {};
    const keys = Object.keys(servers);
    score += keys.length * 100;
    for (const key of keys) {
      if (key !== "example") score += 300;
    }
  } catch {
    score -= 1000;
  }
  return score;
}

function mergeMcpJsonExampleContent(a: string, b: string): string {
  return mcpJsonExampleSpecificityScore(a) >= mcpJsonExampleSpecificityScore(b) ? a : b;
}

const MCP_JSON_EXAMPLE_CANONICAL = `${GOVERNANCE_DOCS_PREFIX}mcp.json.example`;

function setFileMapEntry(fileMap: Record<string, string>, path: string, content: string): void {
  const normalized = normalizePath(path);
  if (normalized === MCP_JSON_EXAMPLE_CANONICAL && fileMap[normalized]?.trim()) {
    fileMap[normalized] = mergeMcpJsonExampleContent(fileMap[normalized]!, content);
    return;
  }
  fileMap[normalized] = content;
}

function deduplicateMcpJsonExample(fileMap: Record<string, string>): void {
  const rootPath = "mcp.json.example";
  const rootContent = fileMap[rootPath]?.trim();
  const docContent = fileMap[MCP_JSON_EXAMPLE_CANONICAL]?.trim();
  if (!rootContent) return;
  if (docContent) {
    fileMap[MCP_JSON_EXAMPLE_CANONICAL] = mergeMcpJsonExampleContent(rootContent, docContent);
  } else {
    fileMap[MCP_JSON_EXAMPLE_CANONICAL] = rootContent;
  }
  delete fileMap[rootPath];
}


function defaultAgentOnboarding(): string {
  return (
    "# Onboarding para agentes implementadores\n\n" +
    "1. **Sesión 0:** pega **`PROMPT-INICIAL.{tu-ide}.md`** (elige el archivo de tu herramienta; ver índice `PROMPT-INICIAL.md`).\n" +
    "2. Lee **`IMPLEMENT.md`** y **`.specify/memory/constitution.md`** (layout spec-kit primario).\n" +
    "3. Lee **`docs/agent-governance/COMO-USAR-GOBERNANZA-IA.md`** (guía principal).\n" +
    "4. Instala gobernanza según tu IDE — **`docs/agent-governance/INSTALACION.md`** (scripts `install-governance-{target}.sh`).\n" +
    `5. Contexto del proyecto: **\`${AGENT_PROMPT_PATH}\`**; checklist en **\`specs/NNN-slug/tasks.md\`** (espejo \`docs/sdd/tasks.md\`).\n` +
    "6. Consulta la guía de consumo: `" + DOC_CONSUMPTION_GUIDE_PATH + "`.\n" +
    "7. Carga `AGENTS.md` y las reglas/skills instaladas según la tarea.\n" +
    "8. Sesiones siguientes: sigue la sección «Sesiones siguientes» de tu `PROMPT-INICIAL.{tu-ide}.md`.\n"
  );
}


function defaultInstalacion(featureDir?: string): string {
  const featureRef = featureDir ?? "specs/NNN-slug";
  return (
    "# Instalación de gobernanza IA en el repo destino\n\n" +
    "Este paquete TheForge entrega reglas, skills y referencias bajo **`docs/agent-governance/`** (SSOT canónico). " +
    "Para cada IDE hay una carpeta **`install-targets/{target}/`** en el ZIP y un script de copia al destino real " +
    "(`.cursor/`, `.agents/`, `.claude/`, etc.).\n\n" +
    "## Matriz multi-target\n\n" +
    defaultMultiTargetInstallTableRows() +
    "\n\n" +
    "## Orden de instalación recomendado\n\n" +
    `1. **Spec-kit en raíz** — Descomprime \`.specify/\` y \`${featureRef}/\` (constitution, spec, plan, tasks).\n` +
    "2. **Elige tu IDE** — Ejecuta el script correspondiente (§ abajo) o copia desde `install-targets/{target}/`.\n" +
    "3. **Prompt inicial** — Pega **`PROMPT-INICIAL.{tu-ide}.md`** (ver índice `PROMPT-INICIAL.md`).\n" +
    "4. **Verificar espejos** — Confirma que `docs/sdd/*` refleja los entregables (no es SSOT alternativo).\n\n" +
    "### Mapeo spec-kit ↔ docs/sdd\n\n" +
    defaultDocumentPathMapTable(featureDir) +
    "\n\n" +
    "## Cursor — Script (recomendado)\n\n" +
    "```bash\n" +
    "chmod +x scripts/install-governance-cursor.sh\n" +
    "./scripts/install-governance-cursor.sh\n" +
    "```\n\n" +
    "## Antigravity — Script\n\n" +
    "```bash\n" +
    "chmod +x scripts/install-governance-antigravity.sh\n" +
    "./scripts/install-governance-antigravity.sh\n" +
    "```\n\n" +
    "## Claude Code / Copilot / Windsurf / OpenHands\n\n" +
    "Usa `scripts/install-governance-{claude-code|github-copilot|windsurf|openhands}.sh` según tu herramienta.\n\n" +
    "## Instalar todos los targets\n\n" +
    "```bash\n" +
    "chmod +x scripts/install-governance-all.sh\n" +
    "./scripts/install-governance-all.sh\n" +
    "```\n\n" +
    "## Opción manual (Cursor)\n\n" +
    "| Archivo en ZIP | Destino en repo destino |\n" +
    "|----------------|-------------------------|\n" +
    defaultInstallMapTableRows() +
    "\n" +
    "## Verificación\n\n" +
    "- `AGENTS.md` y `CLAUDE.md` quedan en la **raíz** del repo.\n" +
    "- Consulta `MANIFEST.json` → `installMaps` para el mapeo exacto por IDE.\n"
  );
}

function defaultInstallScript(): string {
  return defaultInstallScriptForTarget("cursor");
}

function defaultInstallScriptForTarget(target: GovernanceTarget): string {
  const root = 'ROOT="$(cd "$(dirname "$0")/.." && pwd)"';
  switch (target) {
    case "cursor":
      return (
        "#!/usr/bin/env bash\n" +
        "# Instala gobernanza IA (Cursor) desde install-targets/cursor/ o docs/agent-governance/\n" +
        "set -euo pipefail\n" +
        `${root}\n` +
        'BUNDLE="$ROOT/install-targets/cursor"\n' +
        'SRC="$ROOT/docs/agent-governance"\n' +
        'mkdir -p "$ROOT/.cursor/rules" "$ROOT/.cursor/skills" "$ROOT/.cursor/references" "$ROOT/.cursor/agents" "$ROOT/.cursor/commands"\n' +
        'copy_from() { local base="$1"; [[ -d "$base/rules" ]] && cp -f "$base/rules/"*.mdc "$ROOT/.cursor/rules/" 2>/dev/null || true; [[ -d "$base/skills" ]] && cp -R "$base/skills/"* "$ROOT/.cursor/skills/" 2>/dev/null || true; [[ -d "$base/references" ]] && cp -f "$base/references/"* "$ROOT/.cursor/references/" 2>/dev/null || true; [[ -d "$base/agents" ]] && cp -R "$base/agents/"* "$ROOT/.cursor/agents/" 2>/dev/null || true; [[ -d "$base/commands" ]] && cp -R "$base/commands/"* "$ROOT/.cursor/commands/" 2>/dev/null || true; [[ -f "$base/mcp.json.example" ]] && cp -f "$base/mcp.json.example" "$ROOT/.cursor/mcp.json"; }\n' +
        'if [[ -d "$BUNDLE" ]]; then copy_from "$BUNDLE"; else copy_from "$SRC"; fi\n' +
        'echo "Gobernanza Cursor instalada en .cursor/"\n'
      );
    case "antigravity":
      return (
        "#!/usr/bin/env bash\n" +
        "# Instala skills Antigravity desde install-targets/antigravity/\n" +
        "set -euo pipefail\n" +
        `${root}\n` +
        'BUNDLE="$ROOT/install-targets/antigravity"\n' +
        'mkdir -p "$ROOT/.agents/skills" "$ROOT/.agents/references"\n' +
        '[[ -d "$BUNDLE/skills" ]] && cp -R "$BUNDLE/skills/"* "$ROOT/.agents/skills/" 2>/dev/null || true\n' +
        '[[ -d "$BUNDLE/references" ]] && cp -f "$BUNDLE/references/"* "$ROOT/.agents/references/" 2>/dev/null || true\n' +
        '[[ -f "$BUNDLE/mcp.json.example" ]] && mkdir -p "$ROOT/.gemini/config" && cp -f "$BUNDLE/mcp.json.example" "$ROOT/.gemini/config/mcp_config.json"\n' +
        'echo "Gobernanza Antigravity instalada en .agents/"\n'
      );
    case "claude-code":
      return (
        "#!/usr/bin/env bash\n" +
        "set -euo pipefail\n" +
        `${root}\n` +
        'BUNDLE="$ROOT/install-targets/claude-code"\n' +
        'mkdir -p "$ROOT/.claude/rules" "$ROOT/.claude/skills" "$ROOT/.claude/commands"\n' +
        '[[ -d "$BUNDLE/rules" ]] && cp -f "$BUNDLE/rules/"*.md "$ROOT/.claude/rules/" 2>/dev/null || true\n' +
        '[[ -d "$BUNDLE/skills" ]] && cp -R "$BUNDLE/skills/"* "$ROOT/.claude/skills/" 2>/dev/null || true\n' +
        '[[ -d "$BUNDLE/commands" ]] && cp -R "$BUNDLE/commands/"* "$ROOT/.claude/commands/" 2>/dev/null || true\n' +
        '[[ -f "$BUNDLE/mcp.json.example" ]] && cp -f "$BUNDLE/mcp.json.example" "$ROOT/.mcp.json"\n' +
        'echo "Gobernanza Claude Code instalada en .claude/"\n'
      );
    case "github-copilot":
      return (
        "#!/usr/bin/env bash\n" +
        "set -euo pipefail\n" +
        `${root}\n` +
        'BUNDLE="$ROOT/install-targets/github-copilot"\n' +
        'mkdir -p "$ROOT/.github/instructions"\n' +
        '[[ -d "$BUNDLE/instructions" ]] && cp -f "$BUNDLE/instructions/"* "$ROOT/.github/instructions/" 2>/dev/null || true\n' +
        'echo "Instrucciones Copilot instaladas en .github/instructions/"\n'
      );
    case "windsurf":
      return (
        "#!/usr/bin/env bash\n" +
        "set -euo pipefail\n" +
        `${root}\n` +
        'BUNDLE="$ROOT/install-targets/windsurf"\n' +
        'mkdir -p "$ROOT/.devin/rules" "$ROOT/.devin/skills"\n' +
        '[[ -d "$BUNDLE/rules" ]] && cp -f "$BUNDLE/rules/"*.md "$ROOT/.devin/rules/" 2>/dev/null || true\n' +
        '[[ -d "$BUNDLE/skills" ]] && cp -R "$BUNDLE/skills/"* "$ROOT/.devin/skills/" 2>/dev/null || true\n' +
        'echo "Gobernanza Windsurf/Devin instalada en .devin/"\n'
      );
    case "openhands":
    case "hermes":
      return (
        "#!/usr/bin/env bash\n" +
        "set -euo pipefail\n" +
        `${root}\n` +
        'BUNDLE="$ROOT/install-targets/openhands"\n' +
        'mkdir -p "$ROOT/.openhands/rules" "$ROOT/.openhands/skills"\n' +
        '[[ -d "$BUNDLE/rules" ]] && cp -f "$BUNDLE/rules/"*.mdc "$ROOT/.openhands/rules/" 2>/dev/null || true\n' +
        '[[ -d "$BUNDLE/skills" ]] && cp -R "$BUNDLE/skills/"* "$ROOT/.openhands/skills/" 2>/dev/null || true\n' +
        '[[ -f "$BUNDLE/mcp.json.example" ]] && cp -f "$BUNDLE/mcp.json.example" "$ROOT/.openhands/mcp.json"\n' +
        'echo "Gobernanza OpenHands instalada en .openhands/"\n'
      );
    default:
      return defaultInstallScriptForTarget("cursor");
  }
}

function defaultInstallAllScript(): string {
  return (
    "#!/usr/bin/env bash\n" +
    "# Instala gobernanza para todos los targets soportados\n" +
    "set -euo pipefail\n" +
    'DIR="$(cd "$(dirname "$0")" && pwd)"\n' +
    'for s in install-governance-cursor.sh install-governance-antigravity.sh install-governance-claude-code.sh install-governance-github-copilot.sh install-governance-windsurf.sh install-governance-openhands.sh; do\n' +
    '  if [[ -x "$DIR/$s" ]]; then "$DIR/$s"; fi\n' +
    "done\n" +
    'echo "Todos los install-governance-*.sh ejecutados."\n'
  );
}

/** Plantillas de scripts install-governance-{target}.sh para el ZIP. */
export function buildGovernanceInstallScripts(): Record<string, string> {
  return {
    "scripts/install-agent-governance.sh": defaultInstallScript(),
    "scripts/install-governance-cursor.sh": defaultInstallScriptForTarget("cursor"),
    "scripts/install-governance-antigravity.sh": defaultInstallScriptForTarget("antigravity"),
    "scripts/install-governance-claude-code.sh": defaultInstallScriptForTarget("claude-code"),
    "scripts/install-governance-github-copilot.sh": defaultInstallScriptForTarget("github-copilot"),
    "scripts/install-governance-windsurf.sh": defaultInstallScriptForTarget("windsurf"),
    "scripts/install-governance-openhands.sh": defaultInstallScriptForTarget("openhands"),
    "scripts/install-governance-all.sh": defaultInstallAllScript(),
  };
}

function formatSuggestionsRationaleTable(suggestions: AgentGovernanceSuggestions | null | undefined): string {
  if (!suggestions?.rationale.length && !suggestions?.suggestedRules.length) return "";

  const rows: string[] = [];
  for (const r of suggestions?.suggestedRules ?? []) {
    rows.push(`| \`${r.path}\` | rule | ${r.purpose} | ${r.strength} |`);
  }
  for (const s of suggestions?.suggestedSkills ?? []) {
    rows.push(`| \`${s.path}\` | skill | ${s.purpose} | ${s.strength} |`);
  }

  let block =
    "## 8. Por qué se incluyeron estos skills/rules\n\n" +
    "Sugerencias del **detector TheForge** según MDD, Blueprint, complejidad y patrones wizard.\n\n";

  if (suggestions?.archetypes.length) {
    const archetypes = suggestions.archetypes.filter((a) => a !== "legacy-ariadne");
    if (archetypes.length > 0) {
      block += `**Arquetipos:** ${archetypes.join(", ")}\n\n`;
    }
  }

  if (rows.length > 0) {
    block +=
      "| Artefacto | Tipo | Propósito | Señal |\n" +
      "|-----------|------|-----------|-------|\n" +
      rows.join("\n") +
      "\n\n";
  }

  const extra = (suggestions?.rationale ?? [])
    .filter((line) => !/\blegacy-ariadne\b/i.test(line) && !/\bmcp-ariadne\b/i.test(line))
    .slice(0, 8);
  if (extra.length > 0) {
    block += "**Notas del detector:**\n\n";
    for (const line of extra) block += `- ${line}\n`;
    block += "\n";
  }

  return block;
}

function defaultComoUsarGovernanza(suggestions?: AgentGovernanceSuggestions | null): string {
  return (
    "# Cómo usar la gobernanza de agentes IA\n\n" +
    "## 1. Qué es este paquete\n\n" +
    "Este directorio es un **scaffold ejecutable** generado por **TheForge** " +
    "como entregable `agent_governance`, derivado del MDD del proyecto. Contiene reglas, skills y " +
    "referencias para que agentes de código implementen el repositorio con el stack y dominio acordados.\n\n" +
    "Los archivos están en **`docs/agent-governance/`** (visible al extraer el ZIP). " +
    "En el repo destino se instalan en **`.cursor/`** — ver **`INSTALACION.md`** en esta carpeta.\n\n" +
    "## 2. Instalación\n\n" +
    "1. Copia el contenido del ZIP a la **raíz del repositorio destino**.\n" +
    "2. Lee **`INSTALACION.md`** (esta carpeta) y ejecuta el script o la tabla de mapeo.\n" +
    "3. `AGENTS.md` y `CLAUDE.md` permanecen en la raíz; rules/skills van a `.cursor/`.\n\n" +
    "Árbol en el ZIP (sin carpetas ocultas):\n\n" +
    "```\n" +
    "AGENTS.md\n" +
    "CLAUDE.md\n" +
    "PROMPT-INICIAL.md\n" +
    "docs/agent-governance/\n" +
    "├── COMO-USAR-GOBERNANZA-IA.md\n" +
    "├── INSTALACION.md\n" +
    "├── agent-onboarding.md\n" +
    "├── rules/\n" +
    "├── skills/\n" +
    "├── references/\n" +
    "└── mcp.json.example\n" +
    "scripts/install-agent-governance.sh\n" +
    "MANIFEST.json\n" +
    "```\n\n" +
    "## 3. Artefactos\n\n" +
    "| Artefacto | Función |\n" +
    "|-----------|--------|\n" +
    "| `AGENTS.md` | Punto de entrada cross-tool; incluye tabla de instalación |\n" +
    "| `CLAUDE.md` | Shim que delega en `AGENTS.md` (`@AGENTS.md`) |\n" +
    "| `PROMPT-INICIAL.md` | Prompt paste-ready sesión 0 (Cursor, Claude Code, Copilot) |\n" +
    `| \`${AGENT_PROMPT_PATH}\` | Contexto interno del proyecto (→ \`.cursor/references/\`) |\n` +
    "| `docs/agent-governance/rules/*.mdc` | Política (se copia a `.cursor/rules/`) |\n" +
    "| `docs/agent-governance/skills/*/SKILL.md` | Guías de dominio (→ `.cursor/skills/`) |\n" +
    "| `docs/agent-governance/references/` | Workflows, handoff, mantenimiento (→ `.cursor/references/`) |\n" +
    "| `docs/agent-governance/mcp.json.example` | Plantilla MCP (→ `.cursor/mcp.json`) |\n" +
    "| `MANIFEST.json` | Índice, `installMap` y `templateVersion` |\n\n" +
    "## 4. Orden de lectura recomendado\n\n" +
    "1. Este archivo\n" +
    "2. `INSTALACION.md`\n" +
    "3. `AGENTS.md` (raíz)\n" +
    "4. `agent-onboarding.md`\n" +
    "5. Rules con `alwaysApply: true` (tras instalar en `.cursor/rules/`)\n" +
    "6. MDD y Blueprint del proyecto\n\n" +
    "## 5. Subflujos y cuándo cargar qué\n\n" +
    "- **Feature:** `AGENTS.md` → rule de stack → skill de dominio → `references/workflows.md`\n" +
    "- **Debug:** rule de stack + workflows (Debug)\n" +
    "- **Refactor brownfield (solo LEGACY):** skill MCP Ariadne si el MDD lo declara\n" +
    "- **Consumo docs TheForge:** sección 7\n\n" +
    "## 6. Mantenimiento\n\n" +
    "- Regenera desde TheForge Workshop tras cambios en el MDD.\n" +
    "- Nuevas rules/skills: `references/CURSOR_SKILLS_Y_RULES.md`.\n" +
    "- Handoff: `references/PROMPT_HANDOFF_AGENTE.md`.\n\n" +
    "## 7. Consumo de documentación TheForge\n\n" +
    "Consulta **`references/THEFORGE-DOC-CONSUMPTION-GUIDE.md`** " +
    "(incluida en este paquete bajo `docs/agent-governance/references/`).\n" +
    formatSuggestionsRationaleTable(suggestions)
  );
}

function defaultCursorSkillsYRules(): string {
  return (
    "# Skills y reglas de Cursor en este proyecto\n\n" +
    "Guía para **añadir o mantener** Agent Skills y Cursor Rules.\n\n" +
    "## Dónde vive cada cosa\n\n" +
    "| Artefacto | Ruta en repo (tras instalar) | Fuente en ZIP |\n" +
    "|-----------|------------------------------|---------------|\n" +
    "| Entrada agente | `AGENTS.md` | raíz del ZIP |\n" +
    "| Skills | `.cursor/skills/<nombre>/SKILL.md` | `docs/agent-governance/skills/` |\n" +
    "| Reglas | `.cursor/rules/<nombre>.mdc` | `docs/agent-governance/rules/` |\n" +
    "| Referencias | `.cursor/references/` | `docs/agent-governance/references/` |\n\n" +
    "## Checklist al añadir o cambiar\n\n" +
    "1. Skill nueva: `.cursor/skills/<name>/SKILL.md` con frontmatter `name` y `description`.\n" +
    "2. Regla nueva: `.cursor/rules/<name>.mdc` con `description` y `globs` o `alwaysApply`.\n" +
    "3. Actualiza `AGENTS.md` si cambia el mapa global.\n" +
    "4. Documenta el subflujo en `workflows.md`.\n"
  );
}

function defaultPromptHandoff(): string {
  return (
    "# Prompt: handoff entre agentes (pegar en nueva conversación)\n\n" +
    "Copia el bloque siguiente y envíalo al **nuevo agente** al cambiar de sesión o modelo.\n\n" +
    "---\n\n" +
    "## Instrucciones para el agente (handoff)\n\n" +
    "Continúas el trabajo en este repositorio. Antes de implementar:\n\n" +
    "0. Lee `@AGENTS.md` y `docs/agent-governance/COMO-USAR-GOBERNANZA-IA.md`.\n" +
    "1. Confirma que gobernanza está instalada en `.cursor/` (ver `docs/agent-governance/INSTALACION.md`).\n" +
    "2. Inventario: `.cursor/skills/*/SKILL.md` y `.cursor/rules/*.mdc`.\n" +
    "3. Carga la skill/rule del subflujo (ver `@.cursor/references/workflows.md`).\n" +
    "4. Respeta gates (lint, typecheck, tests) del MDD.\n\n" +
    "**Contexto del handoff (rellena el humano):**\n\n" +
    "- Objetivo pendiente:\n" +
    "- Archivos ya modificados:\n" +
    "- Restricciones:\n\n" +
    "---\n\n" +
    "Fin del prompt de handoff.\n"
  );
}

function defaultWorkflows(complexity: ComplexityLevel): string {
  const lines = [
    "# Workflows de agente\n\n",
    "Cada subflujo: **trigger** → **roles** → **gates** → **archivos a cargar**.\n\n",
    "## Feature\n\n",
    "- **Trigger:** nueva funcionalidad o ticket de producto\n",
    "- **Roles:** PM (alcance) → Dev → QA → Reviewer\n",
    "- **Gates:** lint, typecheck, tests del paquete tocado\n",
    "- **Cargar:** `AGENTS.md`, rules de stack, skill de dominio\n\n",
    "## Debug\n\n",
    "- **Trigger:** bug, regresión, fallo de CI\n",
    "- **Roles:** Dev → QA\n",
    "- **Gates:** reproducir + test que falle en rojo antes del fix\n",
    "- **Cargar:** rules de stack, `workflows.md`\n\n",
    "## Consumo docs TheForge\n\n",
    "- **Trigger:** implementar desde entregables SDD\n",
    "- **Cargar:** MDD, Blueprint, `" + DOC_CONSUMPTION_GUIDE_PATH + "`\n\n",
  ];
  if (complexity !== "LOW") {
    lines.push(
      "## Refactor\n\n",
      "- **Trigger:** refactor con impacto multi-archivo\n",
      "- **Gates:** análisis de impacto; MCP de grafo si el MDD lo declara\n",
      "- **Cargar:** skill MCP/arquitectura si aplica\n\n",
      "## PR / Review\n\n",
      "- **Trigger:** abrir o revisar pull request\n",
      "- **Gates:** diff acotado, convenciones del repo\n\n",
    );
  }
  if (complexity === "HIGH") {
    lines.push(
      "## Auditoría de módulo\n\n",
      "- **Trigger:** revisión completa de un módulo o paquete\n",
      "- **Gates:** lint + typecheck + tests en verde\n\n",
      "## Publicación de paquete\n\n",
      "- **Trigger:** solo con petición explícita que nombre el paquete\n",
      "- **Gates:** QA humano + checklist de release del proyecto\n\n",
    );
  }
  lines.push(
    "## Doc gap sync (The Forge MCP)\n\n",
    "- **Trigger:** el código contradice el SDD (inline) o, al cerrar la tarea / antes de commit, el `git diff` introduce algo no contemplado (endpoint, entidad, flujo, tarea)\n",
    "- **Roles:** Dev implementador\n",
    "- **Gates:** evidencia con referencia (§, T-, `docs/sdd/`, `tasks.md`); descripción ≥40 chars; `affectedArtifacts` acotados\n",
    "- **Acción:** MCP `report_documentation_gap` → reconciliación parcial auto-aplicada (el MDD se parchea siempre primero); reserva abrir etapa para hitos reales, no para drift de doc\n",
    "- **Cargar:** `.theforge-project.json`, `" + THEFORGE_LINK_PATH + "`, skill `theforge-doc-sync`\n\n",
  );
  return lines.join("");
}

function defaultMcpJson(): string {
  return JSON.stringify(
    {
      mcpServers: {
        theforge: {
          url: "{{API_URL}}/mcp",
          headers: {
            Authorization: "Bearer {{MCP_M2M_SECRET}}",
          },
        },
      },
    },
    null,
    2,
  );
}

function defaultTheforgeLinkMd(facts: ProjectGovernanceFacts): string {
  const projectId = facts.projectId ?? "<projectId>";
  const stageId = facts.stageId ?? "<stageId>";
  return (
    "# Enlace The Forge\n\n" +
    "Este handoff está vinculado a un proyecto The Forge. Usa el MCP server con tu **Secret MCP** (M2M).\n\n" +
    "## Identificadores\n\n" +
    `| Campo | Valor |\n| --- | --- |\n| projectId | \`${projectId}\` |\n| stageId | \`${stageId}\` |\n\n` +
    "## Herramientas MCP relevantes\n\n" +
    "- `report_documentation_gap` — reporta cuando la documentación SDD es incorrecta/incompleta (actualiza el MDD y regenera artefactos afectados)\n" +
    "- `get_agent_session_log` — timeline de gaps y reconciliaciones\n" +
    "- `get_change_log` — bitácora de cambios en documentos\n\n" +
    "## Configuración\n\n" +
    "Copia `docs/agent-governance/mcp.json.example` → `.cursor/mcp.json` y sustituye `{{API_URL}}` y `{{MCP_M2M_SECRET}}`.\n" +
    "Obtén el secret en The Forge → Perfil → Secret MCP.\n"
  );
}



function formatStackSection(facts: ProjectGovernanceFacts): string {
  const lines: string[] = [];
  if (facts.backendStack) lines.push(`- **Backend:** ${facts.backendStack}`);
  if (facts.frontendStack) lines.push(`- **Frontend:** ${facts.frontendStack}`);
  if (facts.mobileStack) lines.push(`- **Mobile:** ${facts.mobileStack}`);
  if (facts.infraStack) lines.push(`- **Infra / deploy:** ${facts.infraStack}`);
  return lines.length > 0 ? lines.join("\n") : "- Deriva el stack del MDD §2 y del Blueprint.";
}


interface CatalogStackSections {
  modules: boolean;
  backendGlobs: boolean;
  frontendGlobs: boolean;
  npmScripts: boolean;
}

function detectCatalogStackSections(content: string): CatalogStackSections {
  return {
    modules: /\*\*Módulos Blueprint:\*\*/i.test(content),
    backendGlobs: /\*\*Globs backend:\*\*/i.test(content),
    frontendGlobs: /\*\*Globs frontend:\*\*/i.test(content),
    npmScripts: /\*\*Scripts detectados:\*\*/i.test(content),
  };
}

function shouldSkipCatalogStackSection(
  section: keyof CatalogStackSections,
  options?: { compact?: boolean; skipSections?: Partial<CatalogStackSections> },
): boolean {
  if (options?.compact) return true;
  return options?.skipSections?.[section] === true;
}

function buildProjectFactsBlock(
  facts: ProjectGovernanceFacts,
  options?: {
    includeSddConflicts?: boolean;
    compact?: boolean;
    skipSections?: Partial<CatalogStackSections>;
  },
): string {
  const parts: string[] = [`## Hechos del proyecto (${facts.projectTitle})\n`];
  const stack = formatStackSection(facts);
  if (stack) parts.push(stack, "");
  if (
    facts.blueprintModules.length > 0 &&
    !shouldSkipCatalogStackSection("modules", options)
  ) {
    parts.push("**Módulos Blueprint:**", ...facts.blueprintModules.map((m) => `- \`${m}\``), "");
  }
  if (facts.backendGlobs.length > 0 && !shouldSkipCatalogStackSection("backendGlobs", options)) {
    parts.push("**Globs backend:**", ...facts.backendGlobs.map((g) => `- \`${g}\``), "");
  }
  if (
    facts.hasUiSurface &&
    facts.frontendGlobs.length > 0 &&
    !shouldSkipCatalogStackSection("frontendGlobs", options)
  ) {
    parts.push("**Globs frontend:**", ...facts.frontendGlobs.map((g) => `- \`${g}\``), "");
  }
  if (facts.npmScripts.length > 0 && !shouldSkipCatalogStackSection("npmScripts", options)) {
    parts.push("**Scripts npm/pnpm:**", ...facts.npmScripts.map((s) => `- \`${s}\``), "");
  }
  if (facts.architectureLayers.length > 0) {
    parts.push("**Capas:**", ...facts.architectureLayers.map((l) => `- ${l}`), "");
  }
  if (facts.taskCheckboxes.length > 0) {
    parts.push("**Tasks (extracto):**", ...facts.taskCheckboxes.slice(0, 5), "");
  } else if (facts.taskHeadings.length > 0) {
    parts.push("**Tasks (extracto):**", ...facts.taskHeadings.slice(0, 6).map((t) => `- ${t}`), "");
  }
  parts.push(
    "**Docs SDD:**",
    ...facts.docPaths.filter((p) => p.startsWith("docs/sdd/")).map((p) => `- \`${p}\``),
    "",
  );
  if (facts.approach === "UX_FIRST") {
    parts.push(
      "**Metodología:** UX-First (Traducción Técnica).",
      "- Las pantallas de UI (`pantallas.md`) dictan los contratos de API (`api-contracts.md`).",
      "- Contrato Vinculante: obligatorio para desarrolladores y agentes IA respetar estrictamente los endpoints y DTOs pactados con diseño.",
      "",
    );
  }
  if (facts.sddConflicts.length > 0 && options?.includeSddConflicts !== false) {
    parts.push(buildSddConflictSection(facts).trim(), "");
  }
  return parts.join("\n");
}


function buildTasksPreview(facts: ProjectGovernanceFacts): string {
  if (facts.taskCheckboxes.length > 0) {
    return facts.taskCheckboxes.slice(0, 5).join("\n");
  }
  if (facts.taskHeadings.length > 0) {
    return facts.taskHeadings.slice(0, 5).map((h) => `- [ ] ${h}`).join("\n");
  }
  return "- Consulta `docs/sdd/tasks.md` (espejo de spec-kit) para el checklist completo.";
}

/** Contexto interno del proyecto (stack, módulos, tareas) para sesiones iterativas. */
function buildAgentPromptMd(facts: ProjectGovernanceFacts, complexity: ComplexityLevel): string {
  const docList = facts.docPaths.map((p) => `- \`${p}\``).join("\n");
  const tasksPreview = buildTasksPreview(facts);
  const archPreview =
    facts.architectureLayers.length > 0
      ? facts.architectureLayers.map((l) => `- ${l}`).join("\n")
      : "- Consulta `docs/sdd/architecture.md` si existe.";
  const modulesPreview =
    facts.blueprintModules.length > 0
      ? facts.blueprintModules.map((m) => `- \`${m}\``).join("\n")
      : "- Consulta `docs/sdd/blueprint.md` para módulos y rutas.";

  return (
    "# Agent prompt — contexto del proyecto\n\n" +
    "Referencia **interna** generada por TheForge. " +
    "Úsala tras la sesión 0 (`PROMPT-INICIAL.md`) o con `/implementar-tarea`.\n\n" +
    "## Documentos del proyecto\n\n" +
    docList +
    "\n\n## Stack detectado\n\n" +
    formatStackSection(facts) +
    "\n\n## Módulos / rutas (Blueprint)\n\n" +
    modulesPreview +
    "\n\n## Capas de arquitectura\n\n" +
    archPreview +
    "\n\n## Primeras tareas (desde Tasks)\n\n" +
    tasksPreview +
    "\n\n" +
    buildSddConflictSection(facts) +
    "## Instrucciones para el agente\n\n" +
    "1. Si `.cursor/rules/` no existe, **Ejecuta en terminal** `chmod +x scripts/install-agent-governance.sh && ./scripts/install-agent-governance.sh` y verifica la instalación. No pidas al usuario salvo que falle.\n" +
    "2. Lee `AGENTS.md`, `IMPLEMENT.md`, `.specify/memory/constitution.md` y `" + DOC_CONSUMPTION_GUIDE_PATH + "`.\n" +
    "3. Implementa siguiendo **Tasks** (canónico en spec-kit bajo `specs/…/tasks.md`, espejo `docs/sdd/tasks.md`), **Blueprint/plan** y el resto de entregables SDD del ZIP; actualiza `docs/sdd/PROGRESO.md` al cerrar ítems.\n" +
    (complexity !== "LOW"
      ? "4. Respeta subflujos en `docs/agent-governance/references/workflows.md`.\n"
      : "4. Ejecuta lint/typecheck/tests del paquete tocado antes de cerrar.\n")
  );
}

function buildProgresoMd(
  facts: ProjectGovernanceFacts,
  _tasksMarkdown?: string | null,
  mddMarkdown?: string | null,
  featureDir?: string,
  pendingSddGaps?: string[],
): string {
  const conflictTable = buildSddConflictTable(facts);
  const featureRef = featureDir?.trim() || "specs/NNN-slug";
  const lines = [
    "# Progreso de implementación\n\n",
    "Registro **ligero** de avance del **" +
    facts.projectTitle +
    "**. El checklist canónico vive en **" +
    featureRef +
    "/tasks.md** (espejo: `docs/sdd/tasks.md`).\n\n",
    "Marca `[x]` aquí solo como atajo rápido; al cerrar ítems, sincroniza con el archivo canónico de tasks.\n\n",
  ];

  if (mddMarkdown?.trim() && detectTruncatedMddMarkdown(mddMarkdown)) {
    lines.push(
      "> **⚠️ MDD incompleto:** el export detectó truncamiento (p. ej. JSON sin cerrar en §4). " +
        "Regenera el MDD en The Forge antes de implementar contratos o infra.\n\n",
    );
  }

  lines.push("## Referencias\n\n", formatDocumentPathMapTable(featureRef), "\n\n");

  if (conflictTable.trim()) {
    lines.push(conflictTable.trim(), "\n\n");
  }

  if (pendingSddGaps?.length) {
    lines.push("## Gaps SDD pendientes\n\n");
    lines.push(
      "Estos ítems fueron detectados por validadores de precisión The Forge. Resuélvelos en el SDD antes de marcar tareas como completas.\n\n",
    );
    for (const g of pendingSddGaps.slice(0, 20)) {
      lines.push(`- [ ] ${g}\n`);
    }
    if (pendingSddGaps.length > 20) {
      lines.push(`- [ ] … y ${pendingSddGaps.length - 20} gaps más (ver analyze en Workshop)\n`);
    }
    lines.push("\n");
  }

  lines.push("## Checklist rápido (primeras tareas abiertas)\n\n", buildTasksPreview(facts), "\n");
  return lines.join("");
}

const GOVERNANCE_LEGACY_DOC_LINK_REPLACEMENTS: Array<[RegExp, string]> = [
  [/\]\(\.\/MDD\.md\)/gi, "](docs/sdd/mdd.md)"],
  [/\]\(\.\/mdd\.md\)/gi, "](docs/sdd/mdd.md)"],
  [/\]\(\.\/blueprint\.md\)/gi, "](docs/sdd/blueprint.md)"],
  [/\]\(\.\/tasks\.md\)/gi, "](docs/sdd/tasks.md)"],
  [/\]\(\.\/spec\.md\)/gi, "](docs/sdd/spec.md)"],
  [/`\.\/MDD\.md`/gi, "`docs/sdd/mdd.md`"],
  [/`\.\/mdd\.md`/gi, "`docs/sdd/mdd.md`"],
  [/`\.\/blueprint\.md`/gi, "`docs/sdd/blueprint.md`"],
  [/`\.\/tasks\.md`/gi, "`docs/sdd/tasks.md`"],
  [/`MDD\.md`/gi, "`docs/sdd/mdd.md`"],
  [/(?<![/`\w])blueprint\.md(?![/`\w])/gi, "docs/sdd/blueprint.md"],
  [/(?<![/`\w])Blueprint\.md(?![/`\w])/gi, "docs/sdd/blueprint.md"],
  [/(?<![/`\w])Architecture\.md(?![/`\w])/gi, "docs/sdd/architecture.md"],
  [/(?<![/`\w])architecture\.md(?![/`\w])/gi, "docs/sdd/architecture.md"],
  [/`Blueprint\.md`/gi, "`docs/sdd/blueprint.md`"],
  [/`Architecture\.md`/gi, "`docs/sdd/architecture.md`"],
];

/** Corrige enlaces legacy (`./MDD.md`, `MDD.md`) a rutas `docs/sdd/` y spec-kit. */
function fixGovernanceRelativeDocPaths(content: string, featureDir?: string): string {
  let out = content;
  for (const [pattern, replacement] of GOVERNANCE_LEGACY_DOC_LINK_REPLACEMENTS) {
    out = out.replace(pattern, replacement);
  }
  const tasksCanonical = featureDir?.trim()
    ? `${featureDir.trim()}/tasks.md`
    : "specs/NNN-slug/tasks.md";
  out = out.replace(/\]\(\.\/tasks\.md\)/gi, `](${tasksCanonical})`);
  out = out.replace(/`tasks\.md`/gi, `\`${tasksCanonical}\``);
  return out;
}

function isLlmBoilerplateAgentOnboarding(content: string): boolean {
  return (
    /Bienvenido al proyecto/i.test(content) ||
    /Blueprint\.md \(Blueprint/i.test(content) ||
    /Architecture\.md \(Arquitectura/i.test(content) ||
    /skills\/kms\/SKILL\.md/i.test(content)
  );
}


const THIN_CONTENT_MIN_CHARS = 140;

/** Opciones para reconciliar/parsear sin reutilizar bloques genéricos obsoletos. */
export interface AgentGovernanceOverlayOptions {
  forceFreshOverlay?: boolean;
}

function isThinGovernanceContent(content: string): boolean {
  const trimmed = content.trim();
  if (trimmed.length < THIN_CONTENT_MIN_CHARS) return true;
  if (/parametrizar desde MDD/i.test(trimmed) && trimmed.length < 420) return true;
  if (/^#\s+\w+\s*\n\nDeriva comandos exactos/i.test(trimmed)) return true;
  return false;
}

function isStaleProjectFactsSection(content: string, facts: ProjectGovernanceFacts): boolean {
  const match = content.match(/## Hechos del proyecto \(([^)]+)\)/i);
  if (!match) return false;
  const embeddedTitle = match[1].trim();
  if (/^theforge$/i.test(embeddedTitle) || /^proyecto theforge$/i.test(embeddedTitle)) {
    return true;
  }
  if (facts.projectTitle && embeddedTitle !== facts.projectTitle) return true;
  if (/parametrizar desde MDD/i.test(content)) return true;
  if (facts.backendGlobs.length > 0 && /\*\*Globs backend:\*\*/i.test(content)) {
    const hasCurrentGlob = facts.backendGlobs.some((g) => content.includes(g));
    if (!hasCurrentGlob) return true;
  }
  if (facts.blueprintModules.length > 0 && /\*\*Módulos Blueprint:\*\*/i.test(content)) {
    const hasModule = facts.blueprintModules.some((m) => content.includes(m));
    if (!hasModule) return true;
  }
  if (facts.frontendStack && !content.includes(facts.frontendStack)) return true;
  if (
    facts.frontendStack?.startsWith("CLI") &&
    !/\*\*Frontend:\*\*\s*CLI/i.test(content)
  ) {
    return true;
  }
  if (facts.backendStack && !new RegExp(`\\*\\*Backend:\\*\\*\\s*${facts.backendStack}`, "i").test(content)) {
    return true;
  }
  return false;
}

function stripDetectedScriptsBlock(content: string): string {
  return content.replace(
    /\n\*\*Scripts detectados:\*\*[\s\S]*?(?=\n\*\*|\n## [^#]|\n#\s|$)/i,
    "",
  );
}

function stripProjectFactsSection(content: string): string {
  const lines = content.split("\n");
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    if (/^## Hechos del proyecto \(/i.test(lines[i] ?? "")) {
      start = i;
      break;
    }
  }
  if (start < 0) return content;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^## [^#]/.test(lines[i] ?? "")) {
      end = i;
      break;
    }
  }
  const before = lines.slice(0, start).join("\n").trimEnd();
  const after = lines.slice(end).join("\n").trimStart();
  if (before && after) return `${before}\n\n${after}`;
  return before || after || "";
}

function shouldReplaceGovernanceArtifact(
  existing: string | undefined,
  facts: ProjectGovernanceFacts,
  forceFreshOverlay: boolean,
): boolean {
  if (!existing?.trim()) return true;
  if (forceFreshOverlay) return true;
  if (isThinGovernanceContent(existing)) return true;
  if (/Hechos del proyecto \(TheForge\)/i.test(existing)) return true;
  if (isStaleProjectFactsSection(existing, facts)) return true;
  return false;
}

function overlayProjectFacts(
  content: string,
  facts: ProjectGovernanceFacts,
  overlayOptions?: AgentGovernanceOverlayOptions,
  artifactPath?: string,
): string {
  const forceFreshOverlay = overlayOptions?.forceFreshOverlay === true;
  const isStackRule =
    artifactPath?.includes("/rules/stack-backend") ||
    artifactPath?.includes("/rules/stack-frontend");
  const catalogSections = isStackRule ? detectCatalogStackSections(content) : {};
  const skipSections = isStackRule ? catalogSections : undefined;
  const includeSddConflicts = !contentHasSddConflicts(content, facts);
  const block = buildProjectFactsBlock(facts, { skipSections, includeSddConflicts });
  const prepareBase = (raw: string): string => {
    let base = stripSddConflictSections(raw);
    if (isStackRule) base = stripDetectedScriptsBlock(base);
    return base;
  };
  if (/## Hechos del proyecto \(/i.test(content)) {
    if (forceFreshOverlay || isStaleProjectFactsSection(content, facts)) {
      logger.debug(
        `[agent-gov] overlayProjectFacts replacing stale TheForge block projectTitle=${facts.projectTitle} forceFreshOverlay=${forceFreshOverlay}`,
      );
      let base = prepareBase(content);
      base = stripProjectFactsSection(base);
      return base.trim() ? `${base.trimEnd()}\n\n${block}` : block;
    }
    return content;
  }
  const base = prepareBase(content);
  return `${base.trimEnd()}\n\n${block}`;
}


function dropDuplicateGovernancePromptPaths(fileMap: Record<string, string>): void {
  for (const path of DUPLICATE_PROMPT_PATHS) {
    delete fileMap[path];
  }
}

/** Entregables SDD opcionales para incluir en export ZIP bajo docs/sdd/. */
export interface ProjectDeliverableExportInput {
  mddMarkdown?: string | null;
  blueprintMarkdown?: string | null;
  specMarkdown?: string | null;
  architectureMarkdown?: string | null;
  tasksMarkdown?: string | null;
  useCasesMarkdown?: string | null;
  userStoriesMarkdown?: string | null;
  apiContractsMarkdown?: string | null;
  logicFlowsMarkdown?: string | null;
  uxUiGuideMarkdown?: string | null;
  uiScreensMarkdown?: string | null;
  infraMarkdown?: string | null;
}

const SDD_EXPORT_ENTRIES: Array<{
  key: keyof ProjectDeliverableExportInput;
  path: string;
}> = [
  { key: "mddMarkdown", path: "docs/sdd/mdd.md" },
  { key: "blueprintMarkdown", path: "docs/sdd/blueprint.md" },
  { key: "specMarkdown", path: "docs/sdd/spec.md" },
  { key: "architectureMarkdown", path: "docs/sdd/architecture.md" },
  { key: "tasksMarkdown", path: "docs/sdd/tasks.md" },
  { key: "useCasesMarkdown", path: "docs/sdd/use-cases.md" },
  { key: "userStoriesMarkdown", path: "docs/sdd/user-stories.md" },
  { key: "apiContractsMarkdown", path: "docs/sdd/api-contracts.md" },
  { key: "logicFlowsMarkdown", path: "docs/sdd/logic-flows.md" },
  { key: "uxUiGuideMarkdown", path: "docs/sdd/ux-ui-guide.md" },
  { key: "uiScreensMarkdown", path: "docs/sdd/pantallas.md" },
  { key: "infraMarkdown", path: "docs/sdd/infra.md" },
];

/** Añade entregables del proyecto al scaffold de export (docs/sdd/*). */
export function appendProjectDeliverablesToScaffold(
  scaffold: AgentGovernanceScaffold,
  deliverables: ProjectDeliverableExportInput,
): AgentGovernanceScaffold {
  const fileMap: Record<string, string> = {};
  for (const file of scaffold.files) {
    setFileMapEntry(fileMap, file.path, file.content);
  }
  deduplicateMcpJsonExample(fileMap);

  const rawMdd = deliverables.mddMarkdown?.trim() ?? "";
  const sanitizedMdd = rawMdd
    ? injectProposedComponentDiagramIntoSection2(sanitizeMddForExport(rawMdd))
    : "";

  const governanceCorpus = fileMap["AGENTS.md"]?.trim() ?? "";
  const infraExportCorpus = [
    governanceCorpus,
    deliverables.tasksMarkdown,
    deliverables.userStoriesMarkdown,
  ]
    .filter(Boolean)
    .join("\n")
    .trim();
  const infraExportOpts = infraExportCorpus
    ? { extraCorpus: infraExportCorpus, packageManagerCorpus: infraExportCorpus }
    : undefined;

  const written: string[] = [];
  const skipped: string[] = [];
  for (const { key, path } of SDD_EXPORT_ENTRIES) {
    let content = deliverables[key]?.trim();
    if (!content && key !== "mddMarkdown") {
      skipped.push(path);
      continue;
    }
    if (key === "mddMarkdown") {
      if (!sanitizedMdd) {
        skipped.push(path);
        continue;
      }
      content = sanitizedMdd;
    } else {
      if (key === "uxUiGuideMarkdown" && content) {
        content = formatDocumentMarkdown(content);
      }
      if (sanitizedMdd) {
        if (key === "tasksMarkdown" && content) {
          content = alignTasksWithMddConflicts(sanitizedMdd, content);
        } else if (key === "userStoriesMarkdown" && content) {
          content = finalizeUserStoriesMarkdownForExport(sanitizedMdd, content);
        } else if (key === "infraMarkdown" && content) {
          content = finalizeInfraMarkdownForExport(sanitizedMdd, content, infraExportOpts);
        } else if (key === "architectureMarkdown" && content) {
          content = alignDeliverableMarkdownWithMddSecurity(sanitizedMdd, content);
        } else if (key === "uxUiGuideMarkdown" && content) {
          content = ensurePostMvpUiSurfaceBanner(sanitizedMdd, content);
        } else if (key === "blueprintMarkdown") {
          content = qualifyBlueprintPostMvpUiMentions(sanitizedMdd, content!);
        }
      }
    }
    const hadExisting = Boolean(fileMap[path]?.trim());
    fileMap[path] = content!;
    written.push(hadExisting ? `${path} (overwrite)` : path);
  }
  logger.debug(
    `[agent-gov] appendProjectDeliverablesToScaffold written=${written.join(", ") || "none"} skipped=${skipped.join(", ") || "none"}`,
  );

  const files = recordToFileEntries(fileMap);
  const paths = files.map((f) => f.path);
  return {
    manifest: {
      ...scaffold.manifest,
      files: paths,
      installMap: buildGovernanceInstallMap(paths, "cursor"),
    },
    files,
  };
}

/** Rutas obligatorias según complejidad (sin MANIFEST.json). */
export function getRequiredAgentGovernancePaths(complexity: ComplexityLevel): string[] {
  const paths: string[] = [...AGENT_GOVERNANCE_REQUIRED_ALL];
  if (complexity !== "LOW") {
    paths.push(...AGENT_GOVERNANCE_REQUIRED_MEDIUM);
  }
  return paths;
}

function normalizePath(path: string): string {
  return migrateGovernancePath(path);
}

function recordToFileEntries(files: Record<string, string>): AgentGovernanceFile[] {
  return Object.entries(files)
    .filter(([path, content]) => path.trim().length > 0 && typeof content === "string")
    .map(([path, content]) => ({ path: normalizePath(path), content }))
    .filter((f) => f.path.length > 0 && f.path !== "MANIFEST.json")
    .sort((a, b) => a.path.localeCompare(b.path));
}

function capRulesAndSkills(files: Record<string, string>): Record<string, string> {
  const rules = Object.keys(files).filter(
    (p) => p.startsWith(`${GOVERNANCE_DOCS_PREFIX}rules/`) && p.endsWith(".mdc"),
  );
  const skills = Object.keys(files).filter(
    (p) => p.includes(`${GOVERNANCE_DOCS_PREFIX}skills/`) && p.endsWith("SKILL.md"),
  );
  const out = { ...files };
  if (rules.length > 8) {
    for (const drop of rules.slice(8)) delete out[drop];
  }
  if (skills.length > 5) {
    for (const drop of skills.slice(5)) delete out[drop];
  }
  return out;
}

function parseLlmFilesPayload(parsed: unknown): Record<string, string> {
  if (!parsed || typeof parsed !== "object") return {};
  const root = parsed as Record<string, unknown>;

  if (root.files && typeof root.files === "object" && !Array.isArray(root.files)) {
    const out: Record<string, string> = {};
    for (const [path, value] of Object.entries(root.files as Record<string, unknown>)) {
      if (typeof value === "string") setFileMapEntry(out, path, value);
    }
    deduplicateMcpJsonExample(out);
    return out;
  }

  if (Array.isArray(root.files)) {
    const out: Record<string, string> = {};
    for (const item of root.files) {
      if (!item || typeof item !== "object") continue;
      const { path, content } = item as { path?: unknown; content?: unknown };
      if (typeof path === "string" && typeof content === "string") {
        setFileMapEntry(out, path, content);
      }
    }
    deduplicateMcpJsonExample(out);
    return out;
  }

  return {};
}

type FallbackFactory = (
  complexity: ComplexityLevel,
  suggestions?: AgentGovernanceSuggestions | null,
  governanceInput?: SuggestAgentGovernanceInput,
) => string;

const FALLBACK_BY_PATH: Record<string, FallbackFactory> = {
  "AGENTS.md": (_c, _s, input) => {
    const facts = input ? extractProjectGovernanceFacts(input) : undefined;
    const base = defaultAgentsMd(undefined, facts);
    if (!facts) return base;
    return overlayProjectFacts(base, facts);
  },

  "CLAUDE.md": (_c, _s, input) => {
    if (!input) return defaultClaudeShim();
    const facts = extractProjectGovernanceFacts(input);
    return generateClaudeMdWithContext(facts);
  },
  "PROMPT-INICIAL.md": () => buildPromptInicialIndexMd(),
  [AGENT_PROMPT_PATH]: (c, _s, input) =>
    buildAgentPromptMd(
      input
        ? extractProjectGovernanceFacts(input)
        : {
            projectTitle: "Proyecto TheForge",
            docPaths: ["docs/sdd/mdd.md"],
            taskHeadings: [],
            taskCheckboxes: [],
            architectureLayers: [],
            blueprintModules: [],
            backendGlobs: [],
            frontendGlobs: [],
            npmScripts: [],
            sddConflicts: [],
            hasUiSurface: false,
          },
      c,
    ),
  "docs/sdd/PROGRESO.md": (_c, _s, input) => {
    const featureDir =
      input?.stageOrdinal != null && input?.projectName
        ? specKitFeatureDir(input.stageOrdinal, input.projectName)
        : undefined;
    return buildProgresoMd(
      input
        ? extractProjectGovernanceFacts(input)
        : {
            projectTitle: "Proyecto TheForge",
            docPaths: [],
            taskHeadings: [],
            taskCheckboxes: [],
            architectureLayers: [],
            blueprintModules: [],
            backendGlobs: [],
            frontendGlobs: [],
            npmScripts: [],
            sddConflicts: [],
            hasUiSurface: false,
          },
      input?.tasksMarkdown,
      input?.mddMarkdown,
      featureDir,
      input?.sddPendingGaps,
    );
  },
  [`${GOVERNANCE_DOCS_PREFIX}agent-onboarding.md`]: (_c, _s, input) => {
    const base = defaultAgentOnboarding();
    if (!input) return base;
    return overlayProjectFacts(base, extractProjectGovernanceFacts(input));
  },
  [`${GOVERNANCE_DOCS_PREFIX}COMO-USAR-GOBERNANZA-IA.md`]: (_c, s) => defaultComoUsarGovernanza(s),
  [`${GOVERNANCE_DOCS_PREFIX}INSTALACION.md`]: () => defaultInstalacion(),
  [`${GOVERNANCE_DOCS_PREFIX}references/workflows.md`]: (c) => defaultWorkflows(c),
  [`${GOVERNANCE_DOCS_PREFIX}references/CURSOR_SKILLS_Y_RULES.md`]: () => defaultCursorSkillsYRules(),
  [`${GOVERNANCE_DOCS_PREFIX}references/PROMPT_HANDOFF_AGENTE.md`]: () => defaultPromptHandoff(),
  [DOC_CONSUMPTION_GUIDE_PATH]: () => defaultDocConsumptionGuide(),
  [`${GOVERNANCE_DOCS_PREFIX}mcp.json.example`]: () => defaultMcpJson(),
  [THEFORGE_LINK_PATH]: (_c, _s, input) =>
    defaultTheforgeLinkMd(
      input
        ? extractProjectGovernanceFacts(input)
        : { projectTitle: "Proyecto TheForge", docPaths: [], taskHeadings: [], taskCheckboxes: [], architectureLayers: [], blueprintModules: [], backendGlobs: [], frontendGlobs: [], npmScripts: [], sddConflicts: [], hasUiSurface: false },
    ),
  [THEFORGE_DOC_SYNC_RULE_PATH]: () => defaultTheforgeDocSyncRule(),
  [THEFORGE_DOC_SYNC_SKILL_PATH]: () => defaultTheforgeDocSyncSkill(),
  "scripts/install-agent-governance.sh": () => defaultInstallScript(),
};

function applyCanonicalGovernanceDefaults(
  fileMap: Record<string, string>,
  complexity: ComplexityLevel,
  suggestions?: AgentGovernanceSuggestions | null,
  governanceInput?: SuggestAgentGovernanceInput,
  featureDir?: string,
): void {
  for (const path of LLM_PROOF_CANONICAL_PATHS) {
    if (path === `${GOVERNANCE_DOCS_PREFIX}INSTALACION.md`) {
      fileMap[path] = defaultInstalacion(featureDir);
      continue;
    }
    if (path.startsWith("scripts/install-governance-") || path === "scripts/install-agent-governance.sh") {
      const scripts = buildGovernanceInstallScripts();
      if (scripts[path]) fileMap[path] = scripts[path]!;
      continue;
    }
    const factory = FALLBACK_BY_PATH[path];
    if (factory) {
      let content = factory(complexity, suggestions, governanceInput);
      if (featureDir?.trim()) {
        content = replaceFeatureDirPlaceholders(content, featureDir.trim());
      }
      fileMap[path] = content;
    }
  }
  dropDuplicateGovernancePromptPaths(fileMap);
}

function ensureDocConsumptionGuide(fileMap: Record<string, string>, featureDir?: string): void {
  if (!fileMap[DOC_CONSUMPTION_GUIDE_PATH]?.trim()) {
    fileMap[DOC_CONSUMPTION_GUIDE_PATH] = defaultDocConsumptionGuide(featureDir);
  } else if (featureDir?.trim()) {
    fileMap[DOC_CONSUMPTION_GUIDE_PATH] = replaceFeatureDirPlaceholders(
      fileMap[DOC_CONSUMPTION_GUIDE_PATH]!,
      featureDir.trim(),
    );
  }
}


function applyRequiredFileFallbacks(
  fileMap: Record<string, string>,
  complexity: ComplexityLevel,
  suggestions?: AgentGovernanceSuggestions | null,
  governanceInput?: SuggestAgentGovernanceInput,
  featureDir?: string,
): string[] {
  const missing: string[] = [];
  for (const required of getRequiredAgentGovernancePaths(complexity)) {
    if (!fileMap[required]?.trim()) {
      missing.push(required);
      const factory = FALLBACK_BY_PATH[required];
      if (factory) {
        let content = factory(complexity, suggestions, governanceInput);
        if (featureDir?.trim()) {
          content = replaceFeatureDirPlaceholders(content, featureDir.trim());
        }
        fileMap[required] = content;
      }
    }
  }
  ensureAgentsCanonicalSections(fileMap, featureDir);
  ensureDocConsumptionGuide(fileMap, featureDir);
  return missing;
}

function injectDynamicCursorArtifacts(
  fileMap: Record<string, string>,
  facts: ProjectGovernanceFacts,
  complexity: ComplexityLevel,
): void {
  if (complexity === "LOW") return;
  for (const [path, content] of Object.entries(buildDynamicCursorAgents(facts))) {
    if (!fileMap[path]?.trim()) fileMap[path] = content;
  }
  for (const [path, content] of Object.entries(buildDynamicCursorCommands(facts))) {
    if (!fileMap[path]?.trim()) fileMap[path] = content;
  }
}

function enrichGovernanceArtifacts(
  fileMap: Record<string, string>,
  complexity: ComplexityLevel,
  governanceInput: SuggestAgentGovernanceInput,
  overlayOptions?: AgentGovernanceOverlayOptions,
  featureDir?: string,
): void {
  const facts = extractProjectGovernanceFacts(governanceInput);
  const overlayOpts = overlayOptions;
  logger.debug(
    `[agent-gov] enrichGovernanceArtifacts projectTitle=${facts.projectTitle} forceFreshOverlay=${overlayOptions?.forceFreshOverlay === true} fileCount=${Object.keys(fileMap).length}`,
  );
  const agentsPath = "AGENTS.md";
  if (fileMap[agentsPath]?.trim()) {
    fileMap[agentsPath] = appendSddConflictToAgents(
      overlayProjectFacts(fileMap[agentsPath], facts, overlayOpts),
      facts,
    );
  }
  for (const [path, content] of Object.entries(fileMap)) {
    const isRuleOrSkill =
      path.startsWith(`${GOVERNANCE_DOCS_PREFIX}rules/`) ||
      path.includes(`${GOVERNANCE_DOCS_PREFIX}skills/`);
    const forceFresh = overlayOptions?.forceFreshOverlay === true;
    if (
      isRuleOrSkill &&
      content.trim() &&
      /## Hechos del proyecto \(/i.test(content) &&
      !isStaleProjectFactsSection(content, facts) &&
      !forceFresh
    ) {
      continue;
    }
    if (
      isRuleOrSkill &&
      content.trim() &&
      shouldReplaceGovernanceArtifact(content, facts, forceFresh)
    ) {
      fileMap[path] = overlayProjectFacts(content, facts, overlayOpts, path);
    }
  }
  const agentPromptPath = AGENT_PROMPT_PATH;
  const promptPath = "PROMPT-INICIAL.md";
  const progresoPath = "docs/sdd/PROGRESO.md";
  const tasksMd = governanceInput.tasksMarkdown?.trim();
  if (tasksMd) {
    fileMap[promptPath] = buildPromptInicialIndexMd();
    fileMap[agentPromptPath] = buildAgentPromptMd(facts, complexity);
    fileMap[progresoPath] = buildProgresoMd(
      facts,
      governanceInput.tasksMarkdown,
      governanceInput.mddMarkdown,
      featureDir,
      governanceInput.sddPendingGaps,
    );
  } else {
    if (
      shouldReplaceGovernanceArtifact(
        fileMap[agentPromptPath],
        facts,
        overlayOptions?.forceFreshOverlay === true,
      )
    ) {
      fileMap[agentPromptPath] = buildAgentPromptMd(facts, complexity);
    }
    if (
      shouldReplaceGovernanceArtifact(fileMap[promptPath], facts, overlayOptions?.forceFreshOverlay === true)
    ) {
      fileMap[promptPath] = buildPromptInicialIndexMd();
    }
    if (
      shouldReplaceGovernanceArtifact(fileMap[progresoPath], facts, overlayOptions?.forceFreshOverlay === true)
    ) {
      fileMap[progresoPath] = buildProgresoMd(
        facts,
        governanceInput.tasksMarkdown,
        governanceInput.mddMarkdown,
        featureDir,
      );
    }
  }
  if (facts.projectId || facts.stageId) {
    fileMap[THEFORGE_LINK_PATH] = defaultTheforgeLinkMd(facts);
  }
  const onboardingPath = `${GOVERNANCE_DOCS_PREFIX}agent-onboarding.md`;
  const onboardingExisting = fileMap[onboardingPath];
  if (
    shouldReplaceGovernanceArtifact(
      onboardingExisting,
      facts,
      overlayOptions?.forceFreshOverlay === true,
    ) ||
    isLlmBoilerplateAgentOnboarding(onboardingExisting ?? "")
  ) {
    fileMap[onboardingPath] = overlayProjectFacts(defaultAgentOnboarding(), facts, overlayOpts);
  }
  const comoUsarPath = `${GOVERNANCE_DOCS_PREFIX}COMO-USAR-GOBERNANZA-IA.md`;
  const comoUsarExisting = fileMap[comoUsarPath];
  if (
    shouldReplaceGovernanceArtifact(
      comoUsarExisting,
      facts,
      overlayOptions?.forceFreshOverlay === true,
    ) ||
    (facts.sddConflicts.length > 0 && !/## Hechos del proyecto \(/i.test(comoUsarExisting ?? ""))
  ) {
    fileMap[comoUsarPath] = overlayProjectFacts(
      comoUsarExisting?.trim() ? comoUsarExisting : defaultComoUsarGovernanza(),
      facts,
      overlayOpts,
    );
  }
  for (const [path, content] of Object.entries(fileMap)) {
    if (content.trim()) {
      fileMap[path] = fixGovernanceRelativeDocPaths(content, featureDir);
    }
  }
}



function mergeSuggestedArtifacts(
  fileMap: Record<string, string>,
  complexity: ComplexityLevel,
  suggestions: AgentGovernanceSuggestions | null | undefined,
  governanceInput: SuggestAgentGovernanceInput,
  overlayOptions?: AgentGovernanceOverlayOptions,
): string[] {
  if (!suggestions) return [];

  const added: string[] = [];
  const ctx = buildArtifactTemplateContext(suggestions, complexity, governanceInput);
  const facts = ctx.projectFacts ?? extractProjectGovernanceFacts(governanceInput);
  const forceFreshOverlay = overlayOptions?.forceFreshOverlay === true;
  const overlayOpts = overlayOptions;

  for (const spec of suggestions.suggestedRules) {
    const path = normalizePath(spec.path);
    const rule = getRuleById(spec.id);
    if (!rule) continue;
    const catalogContent = overlayProjectFacts(
      renderRuleFromCatalog(rule, ctx),
      facts,
      overlayOpts,
      path,
    );
    const existing = fileMap[path]?.trim();
    if (existing && !shouldReplaceGovernanceArtifact(existing, facts, forceFreshOverlay)) continue;
    fileMap[path] = catalogContent;
    added.push(path);
  }

  for (const spec of suggestions.suggestedSkills) {
    const path = normalizePath(spec.path);
    const skill = getSkillById(spec.id);
    if (!skill) continue;
    const catalogContent = overlayProjectFacts(
      renderSkillFromCatalog(skill, ctx, spec.folder),
      facts,
      overlayOpts,
      path,
    );
    const existing = fileMap[path]?.trim();
    if (existing && !shouldReplaceGovernanceArtifact(existing, facts, forceFreshOverlay)) continue;
    fileMap[path] = catalogContent;
    added.push(path);
  }

  return added;
}

function appendSuggestionsToComoUsar(
  fileMap: Record<string, string>,
  suggestions: AgentGovernanceSuggestions | null | undefined,
): void {
  const path = `${GOVERNANCE_DOCS_PREFIX}COMO-USAR-GOBERNANZA-IA.md`;
  const table = formatSuggestionsRationaleTable(suggestions);
  if (!table.trim()) return;
  const current = fileMap[path] ?? defaultComoUsarGovernanza(suggestions);
  if (current.includes("Por qué se incluyeron estos skills/rules")) return;
  fileMap[path] = current.trimEnd() + "\n\n" + table;
}

function toManifestSuggestions(
  suggestions: AgentGovernanceSuggestions | null | undefined,
): AgentGovernanceSuggestionsManifest | undefined {
  if (!suggestions) return undefined;
  const entries = [
    ...suggestions.suggestedRules.map((r) => ({
      id: r.id,
      path: r.path,
      kind: "rule" as const,
      purpose: r.purpose,
      strength: r.strength,
    })),
    ...suggestions.suggestedSkills.map((s) => ({
      id: s.id,
      path: s.path,
      kind: "skill" as const,
      purpose: s.purpose,
      strength: s.strength,
    })),
  ];
  return {
    archetypes: suggestions.archetypes,
    rationale: suggestions.rationale,
    entries,
  };
}

/** Reconstruye sugerencias del detector desde `MANIFEST.suggestions` (scaffolds ya persistidos). */
export function suggestionsFromManifest(
  manifest: AgentGovernanceSuggestionsManifest | undefined,
): AgentGovernanceSuggestions | null {
  if (!manifest?.entries?.length) return null;

  const suggestedRules: AgentGovernanceSuggestions["suggestedRules"] = [];
  const suggestedSkills: AgentGovernanceSuggestions["suggestedSkills"] = [];

  for (const entry of manifest.entries) {
    if (entry.kind === "rule") {
      suggestedRules.push({
        id: entry.id,
        path: entry.path,
        purpose: entry.purpose ?? "",
        strength: entry.strength ?? "weak",
      });
      continue;
    }
    const folder =
      entry.path.match(/docs\/agent-governance\/skills\/([^/]+)\//)?.[1] ??
      entry.path.match(/\.cursor\/skills\/([^/]+)\//)?.[1] ??
      entry.id;
    suggestedSkills.push({
      id: entry.id,
      path: entry.path,
      folder,
      purpose: entry.purpose ?? "",
      strength: entry.strength ?? "weak",
    });
  }

  return {
    archetypes: manifest.archetypes ?? [],
    rationale: manifest.rationale ?? [],
    suggestedRules,
    suggestedSkills,
  };
}

/**
 * Completa `scaffold.files` con artefactos sugeridos y rutas obligatorias omitidas.
 * Útil al exportar scaffolds generados antes de materializar sugerencias débiles.
 */
export function reconcileAgentGovernanceScaffold(
  scaffold: AgentGovernanceScaffold,
  complexity: ComplexityLevel,
  options?: {
    suggestions?: AgentGovernanceSuggestions | null;
    governanceInput?: SuggestAgentGovernanceInput;
    /** @deprecated use governanceInput */
    mddMarkdown?: string;
    target?: GovernanceTarget;
    forceFreshOverlay?: boolean;
    /** Resuelve `{featureDir}` y `specs/NNN-slug` en tablas de path map al exportar. */
    featureDir?: string;
  },
): AgentGovernanceScaffold {
  const suggestions =
    options?.suggestions ??
    suggestionsFromManifest(scaffold.manifest.suggestions) ??
    null;
  const governanceInput: SuggestAgentGovernanceInput =
    options?.governanceInput ??
    ({
      mddMarkdown: options?.mddMarkdown ?? "",
      complexity,
    } satisfies SuggestAgentGovernanceInput);
  const featureDir = options?.featureDir?.trim();
  const overlayOptions: AgentGovernanceOverlayOptions = {
    forceFreshOverlay: options?.forceFreshOverlay === true,
  };
  const filesBefore = scaffold.files.length;

  const fileMap: Record<string, string> = {};
  for (const file of scaffold.files) {
    setFileMapEntry(fileMap, file.path, file.content);
  }
  deduplicateMcpJsonExample(fileMap);

  const facts = extractProjectGovernanceFacts(governanceInput);
  const merged = mergeSuggestedArtifacts(
    fileMap,
    complexity,
    suggestions,
    governanceInput,
    overlayOptions,
  );
  if (merged.length > 0) {
    logger.debug(
      `[agent-gov] reconcileAgentGovernanceScaffold addedPaths=${merged.join(", ")} forceFreshOverlay=${overlayOptions.forceFreshOverlay}`,
    );
  } else {
    logger.debug(
      `[agent-gov] reconcileAgentGovernanceScaffold no catalog paths added forceFreshOverlay=${overlayOptions.forceFreshOverlay} filesBefore=${filesBefore}`,
    );
  }

  applyRequiredFileFallbacks(fileMap, complexity, suggestions, governanceInput, featureDir);
  enrichGovernanceArtifacts(fileMap, complexity, governanceInput, overlayOptions, featureDir);
  injectDynamicCursorArtifacts(fileMap, facts, complexity);
  appendSuggestionsToComoUsar(fileMap, suggestions);
  applyCanonicalGovernanceDefaults(fileMap, complexity, suggestions, governanceInput, featureDir);
  ensureAgentsCanonicalSections(fileMap, featureDir);
  for (const [path, content] of Object.entries(fileMap)) {
    if (content.trim()) {
      fileMap[path] = fixGovernanceRelativeDocPaths(content, featureDir);
    }
  }

  const files = recordToFileEntries(fileMap);
  const paths = files.map((f) => f.path);
  logger.debug(
    `[agent-gov] reconcileAgentGovernanceScaffold filesBefore=${filesBefore} filesAfter=${files.length}`,
  );

  const reconciled: AgentGovernanceScaffold = {
    manifest: {
      ...scaffold.manifest,
      templateVersion: scaffold.manifest.templateVersion || AGENT_GOVERNANCE_TEMPLATE_VERSION,
      files: paths,
      suggestions: scaffold.manifest.suggestions ?? toManifestSuggestions(suggestions),
      installMap: buildGovernanceInstallMap(paths, "cursor"),
    },
    files,
  };

  return reconciled;
}

/**
 * Parsea la respuesta LLM y normaliza el scaffold agent-governance/.
 * Aplica plantillas de respaldo para rutas obligatorias omitidas por el LLM.
 */
export interface ParseAgentGovernanceOptions {
  suggestions?: AgentGovernanceSuggestions | null;
  governanceInput?: SuggestAgentGovernanceInput;
  /** @deprecated use governanceInput */
  mddMarkdown?: string;
  target?: string;
  forceFreshOverlay?: boolean;
  featureDir?: string;
}

export function parseAgentGovernanceResponse(
  raw: string,
  complexity: ComplexityLevel,
  options?: ParseAgentGovernanceOptions,
): AgentGovernanceScaffold {
  const trimmed = stripJsonFences(raw);
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed) as unknown;
  } catch {
    parsed = {};
  }

  const suggestions = options?.suggestions ?? null;
  const governanceInput: SuggestAgentGovernanceInput =
    options?.governanceInput ??
    ({
      mddMarkdown: options?.mddMarkdown ?? "",
      complexity,
    } satisfies SuggestAgentGovernanceInput);
  const target = (options?.target as GovernanceTarget) ?? "cursor";
  const featureDir = options?.featureDir?.trim();
  const overlayOptions: AgentGovernanceOverlayOptions = {
    forceFreshOverlay: options?.forceFreshOverlay === true,
  };

  const fileMap = capRulesAndSkills(parseLlmFilesPayload(parsed));
  const llmFileCount = Object.keys(fileMap).length;
  const facts = extractProjectGovernanceFacts(governanceInput);
  const merged = mergeSuggestedArtifacts(
    fileMap,
    complexity,
    suggestions,
    governanceInput,
    overlayOptions,
  );
  logger.debug(
    `[agent-gov] parseAgentGovernanceResponse llmFiles=${llmFileCount} forceFreshOverlay=${overlayOptions.forceFreshOverlay} mergedCatalog=${merged.join(", ") || "none"}`,
  );
  if (merged.length > 0) {
    logger.debug(
      `[agent-gov] parseAgentGovernanceResponse catalog paths added: ${merged.join(", ")}`,
    );
  }

  const missing = applyRequiredFileFallbacks(
    fileMap,
    complexity,
    suggestions,
    governanceInput,
    featureDir,
  );
  if (missing.length > 0) {
    logger.debug(
      `[agent-gov] parseAgentGovernanceResponse required fallbacks (${complexity}): ${missing.join(", ")}`,
    );
  }

  enrichGovernanceArtifacts(fileMap, complexity, governanceInput, overlayOptions, featureDir);
  injectDynamicCursorArtifacts(fileMap, facts, complexity);
  appendSuggestionsToComoUsar(fileMap, suggestions);

  const files = recordToFileEntries(fileMap);

  return reconcileAgentGovernanceScaffold(
    {
      manifest: {
        templateVersion: AGENT_GOVERNANCE_TEMPLATE_VERSION,
        files: files.map((f) => f.path),
        generatedAt: new Date().toISOString(),
        suggestions: toManifestSuggestions(suggestions),
      },
      files,
    },
    complexity,
    { suggestions, governanceInput, target, forceFreshOverlay: overlayOptions.forceFreshOverlay, featureDir },
  );
}

/** Enriquece scaffold canónico con bundle multi-target (solo export/ZIP). */
export function enrichExportWithMultiTargetBundle(
  scaffold: AgentGovernanceScaffold,
  options: {
    facts: ProjectGovernanceFacts;
    complexity: ComplexityLevel;
    featureDir?: string;
  },
): AgentGovernanceScaffold {
  const fileMap: Record<string, string> = {};
  for (const file of scaffold.files) {
    setFileMapEntry(fileMap, file.path, file.content);
  }

  const bundles = buildMultiTargetBundle(scaffold);
  for (const files of bundles.values()) {
    for (const f of files) setFileMapEntry(fileMap, f.path, f.content);
  }

  for (const prompt of buildAllPromptIniciales(options.facts, options.complexity, options.featureDir)) {
    setFileMapEntry(fileMap, prompt.path, prompt.content);
  }

  for (const [path, content] of Object.entries(buildGovernanceInstallScripts())) {
    setFileMapEntry(fileMap, path, content);
  }

  applyCanonicalGovernanceDefaults(
    fileMap,
    options.complexity,
    null,
    {
      mddMarkdown: "",
      complexity: options.complexity,
      projectName: options.facts.projectTitle,
    },
    options.featureDir,
  );

  const files = recordToFileEntries(fileMap);
  const paths = files.map((f) => f.path);

  return {
    manifest: {
      ...scaffold.manifest,
      templateVersion: scaffold.manifest.templateVersion || AGENT_GOVERNANCE_TEMPLATE_VERSION,
      files: paths,
      installMap: buildGovernanceInstallMap(paths, "cursor"),
      installMaps: buildMultiTargetInstallMaps(paths),
      prompts: expectedPromptInicialPaths().filter((p) => paths.includes(p)),
    },
    files,
  };
}

/** Serializa el scaffold para persistencia en `Project.agentGovernanceContent`. */
export function serializeAgentGovernanceScaffold(scaffold: AgentGovernanceScaffold): string {
  return JSON.stringify(scaffold, null, 2);
}
