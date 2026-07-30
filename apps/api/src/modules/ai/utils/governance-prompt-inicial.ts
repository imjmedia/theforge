import {
  GOVERNANCE_DOCS_PREFIX,
  GOVERNANCE_TARGET_LABELS,
  GOVERNANCE_TARGETS_ORDER,
  promptInicialFilename,
  ROOT_THEFORGE_DOC_CONSUMPTION_GUIDE,
  GOVERNANCE_THEFORGE_DOC_CONSUMPTION_GUIDE,
  type ComplexityLevel,
  type GovernanceTarget,
} from "@theforge/shared-types";
import {
  AGENT_PROMPT_PATH,
  THEFORGE_LINK_PATH,
} from "./agent-governance.util.js";
import type { ProjectGovernanceFacts } from "./suggest-agent-governance-artifacts.js";

export interface PromptInicialFile {
  path: string;
  content: string;
}

function formatStackSection(facts: ProjectGovernanceFacts): string {
  const lines: string[] = [];
  if (facts.backendStack) lines.push(`- **Backend:** ${facts.backendStack}`);
  if (facts.frontendStack) lines.push(`- **Frontend:** ${facts.frontendStack}`);
  if (facts.mobileStack) lines.push(`- **Mobile:** ${facts.mobileStack}`);
  if (facts.infraStack) lines.push(`- **Infra / deploy:** ${facts.infraStack}`);
  return lines.length > 0 ? lines.join("\n") : "- Deriva el stack del MDD §2 y del Blueprint.";
}

function buildSddConflictSection(facts: ProjectGovernanceFacts): string {
  if (facts.sddConflicts.length === 0) return "";
  const lines = [
    "## Resolución de conflictos SDD\n\n",
    "El detector encontró posibles contradicciones entre entregables. **Prioriza el MDD** y documenta la decisión en `docs/sdd/PROGRESO.md`.\n\n",
  ];
  for (const c of facts.sddConflicts) lines.push(`- ${c}\n`);
  lines.push("\n");
  return lines.join("");
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

function buildGatesSection(facts: ProjectGovernanceFacts, complexity: ComplexityLevel): string {
  const scripts =
    facts.npmScripts.length > 0
      ? facts.npmScripts.slice(0, 4).map((s) => `- \`${s}\``).join("\n")
      : "- Lint, typecheck y tests del paquete tocado (ver MDD §2 y scripts del repo).";
  const workflow =
    complexity !== "LOW"
      ? "- Respeta subflujos en `docs/agent-governance/references/workflows.md`.\n"
      : "";
  return (
    `${scripts}\n` +
    "- Contratos API alineados a `contracts/api-contracts.md` (spec-kit) o `docs/sdd/api-contracts.md` cuando la tarea toque endpoints.\n" +
    workflow
  ).trimEnd();
}

function buildHandoffReadingOrderSection(featureDir?: string): string {
  const featureRef = featureDir?.trim() || "specs/NNN-slug";
  return (
    "Lee **en este orden** antes de escribir código (layout **spec-kit primario**; espejo en `docs/sdd/`):\n\n" +
    "1. **`IMPLEMENT.md`** — bootstrap spec-kit, instalación y mapa de rutas\n" +
    "2. **`AGENTS.md`** — entrada cross-tool e instalación de gobernanza\n" +
    "3. **`.specify/memory/constitution.md`** — Constitución (MDD); espejo: `docs/sdd/mdd.md`\n" +
    `4. **\`${featureRef}/research.md\`** — Paso 0 / investigación (**si existe**)\n` +
    `5. **\`${featureRef}/spec.md\`** — requisitos y criterios de aceptación\n` +
    `6. **\`${featureRef}/architecture.md\`**, **\`use-cases.md\`**, **\`user-stories.md\`** — cuando existan\n` +
    `7. **\`${featureRef}/plan.md\`** — Blueprint / plan técnico\n` +
    `8. **\`${featureRef}/design-system.md\`** y **\`pantallas.md\`** — **antes de implementar UI**\n` +
    `9. **\`${featureRef}/contracts/api-contracts.md\`** y **\`logic-flows.md\`** — contratos y flujos (**vinculantes** si existen)\n` +
    `10. **\`${AGENT_PROMPT_PATH}\`** — contexto del proyecto (stack, módulos, conflictos SDD)\n` +
    `11. **\`${featureRef}/tasks.md\`** — checklist de ejecución (espejo: \`docs/sdd/tasks.md\`)\n` +
    `12. **\`${featureRef}/infra.md\`**, **\`data-model.md\`**, **\`docs/sdd/decisions/*.md\`**, **\`quickstart.md\`** — cuando existan\n` +
    `13. **\`${ROOT_THEFORGE_DOC_CONSUMPTION_GUIDE}\`** — reglas completas de consumo (misma guía en \`${GOVERNANCE_THEFORGE_DOC_CONSUMPTION_GUIDE}\`)\n\n` +
    "**Ante conflicto entre artefactos, gana el MDD.** No te limites a MDD/Spec/Plan/Tasks: usa todo lo presente en el ZIP según la tarea.\n"
  );
}

/** Pasos 2–5 compartidos (stack, SDD, gates) — sin instrucciones IDE-specific. */
export function buildPromptInicialCore(
  facts: ProjectGovernanceFacts,
  complexity: ComplexityLevel,
  featureDir?: string,
): string {
  const featureRef = featureDir?.trim() || "specs/NNN-slug";
  const tasksPath = `${featureRef}/tasks.md`;
  const tasksPreview = buildTasksPreview(facts);

  return (
    "## Paso 2 — Orden de lectura (obligatorio)\n\n" +
    buildHandoffReadingOrderSection(featureDir) +
    "\n" +
    "## Paso 3 — Primera tarea abierta\n\n" +
    "Implementa la **primera tarea pendiente** del checklist:\n\n" +
    tasksPreview +
    "\n\n" +
    `Cruza con **\`${featureRef}/plan.md\`**, **\`spec.md\`**, contratos API, flujos lógicos, **\`design-system.md\`** (tokens y estilos obligatorios en UI), **\`pantallas.md\`** (si hay UI) y **\`architecture.md\`** según lo que exija la tarea. ` +
    `Al cerrar un checkpoint, ejecuta smoke tests de **\`${featureRef}/quickstart.md\`**.\n\n` +
    "## Paso 4 — Gates antes de cerrar\n\n" +
    buildGatesSection(facts, complexity) +
    "\n\n" +
    "## Paso 5 — Actualizar progreso\n\n" +
    "Marca la tarea completada en **`docs/sdd/PROGRESO.md`** y en **`" +
    tasksPath +
    "`** (canónico spec-kit).\n\n" +
    "## Stack detectado (TheForge)\n\n" +
    formatStackSection(facts) +
    "\n\n" +
    buildSddConflictSection(facts)
  );
}

type TargetOverlay = {
  prereqs: string;
  step1: string;
  step15: string;
  sessions: string;
};

function targetOverlays(): Record<GovernanceTarget, TargetOverlay> {
  return {
    cursor: {
      prereqs:
        "- Descomprime el ZIP en la **raíz del repositorio destino** (mismo nivel que `AGENTS.md` e `IMPLEMENT.md`).\n" +
        "- Abre el repo en **Cursor**.\n",
      step1:
        "**Tu primera acción** es instalar gobernanza ejecutando el script en **terminal** desde la raíz del repo.\n\n" +
        "```bash\n" +
        "chmod +x scripts/install-governance-cursor.sh\n" +
        "./scripts/install-governance-cursor.sh\n" +
        "```\n\n" +
        "**Verifica** que exista `.cursor/rules/` (y `.cursor/skills/` si aplica) antes del Paso 2.\n",
      step15:
        "Si existe **`.theforge-project.json`** en la raíz:\n\n" +
        "1. Copia `docs/agent-governance/mcp.json.example` → `.cursor/mcp.json` (si no lo hizo el script).\n" +
        "2. Sustituye `{{API_URL}}` y `{{MCP_M2M_SECRET}}` con tu Secret MCP de The Forge.\n" +
        `3. Lee \`${THEFORGE_LINK_PATH}\` para \`projectId\` y \`stageId\`.\n` +
        "4. Si la documentación SDD contradice el código correcto, usa MCP **`report_documentation_gap`** (ver skill `theforge-doc-sync`).\n",
      sessions:
        "Tras la sesión 0, usa el comando **`/implementar-tarea`** (Cursor) o repite pasos 3–5 leyendo " +
        `\`${AGENT_PROMPT_PATH}\` y la siguiente tarea abierta en tasks.md.\n`,
    },
    antigravity: {
      prereqs:
        "- Descomprime el ZIP en la **raíz del repositorio destino**.\n" +
        "- Abre el repo en **Google Antigravity** (Gemini).\n",
      step1:
        "**Tu primera acción** es instalar skills de gobernanza con el script dedicado:\n\n" +
        "```bash\n" +
        "chmod +x scripts/install-governance-antigravity.sh\n" +
        "./scripts/install-governance-antigravity.sh\n" +
        "```\n\n" +
        "**Verifica** que exista `.agents/skills/` con las skills del proyecto antes del Paso 2.\n",
      step15:
        "Si existe **`.theforge-project.json`**:\n\n" +
        "1. Copia el ejemplo MCP a `.gemini/config/mcp_config.json` (ver `install-targets/antigravity/mcp.json.example`).\n" +
        "2. Sustituye placeholders con tu Secret MCP de The Forge.\n" +
        `3. Lee \`${THEFORGE_LINK_PATH}\` para IDs del proyecto.\n`,
      sessions:
        "Tras la sesión 0, invoca la skill de implementación del proyecto o repite pasos 3–5 leyendo " +
        `\`${AGENT_PROMPT_PATH}\` y la siguiente tarea abierta.\n`,
    },
    "claude-code": {
      prereqs:
        "- Descomprime el ZIP en la **raíz del repositorio destino**.\n" +
        "- Abre el repo en **Claude Code**.\n",
      step1:
        "**Tu primera acción** es instalar reglas y skills en `.claude/`:\n\n" +
        "```bash\n" +
        "chmod +x scripts/install-governance-claude-code.sh\n" +
        "./scripts/install-governance-claude-code.sh\n" +
        "```\n\n" +
        "**Verifica** que exista `.claude/rules/` antes del Paso 2.\n",
      step15:
        "Si existe **`.theforge-project.json`**:\n\n" +
        "1. Copia `install-targets/claude-code/mcp.json.example` → `.mcp.json` en la raíz.\n" +
        "2. Configura Secret MCP de The Forge.\n" +
        `3. Lee \`${THEFORGE_LINK_PATH}\`.\n`,
      sessions:
        "Tras la sesión 0, usa **`/implementar-tarea`** en `.claude/commands/` o repite pasos 3–5 con " +
        `\`${AGENT_PROMPT_PATH}\`.\n`,
    },
    "github-copilot": {
      prereqs:
        "- Descomprime el ZIP en la **raíz del repositorio destino**.\n" +
        "- Abre el repo en **VS Code con GitHub Copilot**.\n",
      step1:
        "**Tu primera acción** es copiar instrucciones de gobernanza:\n\n" +
        "```bash\n" +
        "chmod +x scripts/install-governance-github-copilot.sh\n" +
        "./scripts/install-governance-github-copilot.sh\n" +
        "```\n\n" +
        "**Verifica** que exista `.github/instructions/` con archivos `*.instructions.md`.\n",
      step15:
        "Copilot no usa MCP The Forge nativamente. Consulta `" + THEFORGE_LINK_PATH + "` para reportar gaps manualmente en Workshop.\n",
      sessions:
        "Tras la sesión 0, pega el contenido de `" + AGENT_PROMPT_PATH + "` en el chat y continúa con la siguiente tarea abierta.\n",
    },
    windsurf: {
      prereqs:
        "- Descomprime el ZIP en la **raíz del repositorio destino**.\n" +
        "- Abre el repo en **Windsurf / Devin**.\n",
      step1:
        "**Tu primera acción** es instalar reglas Devin:\n\n" +
        "```bash\n" +
        "chmod +x scripts/install-governance-windsurf.sh\n" +
        "./scripts/install-governance-windsurf.sh\n" +
        "```\n\n" +
        "**Verifica** que exista `.devin/rules/` con `trigger: always_on` donde aplique.\n",
      step15:
        "Consulta `docs/agent-governance/INSTALACION.md` § Windsurf para import nativo de rules si aplica.\n",
      sessions:
        "Tras la sesión 0, ejecuta el workflow de implementación Devin o repite pasos 3–5 con `" +
        AGENT_PROMPT_PATH +
        "`.\n",
    },
    openhands: {
      prereqs:
        "- Descomprime el ZIP en la **raíz del repositorio destino**.\n" +
        "- Abre el repo en **OpenHands**.\n",
      step1:
        "**Tu primera acción** es instalar gobernanza OpenHands:\n\n" +
        "```bash\n" +
        "chmod +x scripts/install-governance-openhands.sh\n" +
        "./scripts/install-governance-openhands.sh\n" +
        "```\n\n" +
        "**Verifica** que exista `.openhands/rules/` y `.openhands/skills/`.\n",
      step15:
        "Si existe **`.theforge-project.json`**:\n\n" +
        "1. Copia MCP example → `.openhands/mcp.json`.\n" +
        `2. Lee \`${THEFORGE_LINK_PATH}\`.\n`,
      sessions:
        "Tras la sesión 0, inicia una nueva conversación OpenHands leyendo `" +
        AGENT_PROMPT_PATH +
        "` y la siguiente tarea.\n",
    },
    codex: {
      prereqs:
        "- Descomprime el ZIP en la **raíz del repositorio destino**.\n" +
        "- Abre el repo en **OpenAI Codex** (o agente con acceso al repo).\n",
      step1:
        "La gobernanza ya está en el bundle (`AGENTS.md`, `docs/agent-governance/`). **No ejecutes scripts IDE-specific** — lee `AGENTS.md` y continúa al Paso 2.\n",
      step15: "",
      sessions:
        "Tras la sesión 0, re-lee **`AGENTS.md`** y `" +
        AGENT_PROMPT_PATH +
        "` al iniciar cada sesión; implementa la siguiente tarea abierta.\n",
    },
    hermes: {
      prereqs:
        "- Descomprime el ZIP en la **raíz del repositorio destino**.\n" +
        "- Abre el repo en **Hermes** (runner OpenHands).\n",
      step1:
        "**Tu primera acción** es instalar skills Hermes:\n\n" +
        "```bash\n" +
        "chmod +x scripts/install-governance-openhands.sh\n" +
        "./scripts/install-governance-openhands.sh\n" +
        "```\n\n" +
        "**Verifica** que exista `.hermes/skills/` o `.openhands/skills/` según tu runner.\n",
      step15: "",
      sessions:
        "Tras la sesión 0, continúa con `" + AGENT_PROMPT_PATH + "` y tasks.md.\n",
    },
  };
}

/** PROMPT-INICIAL paste-ready para un IDE (sin cross-talk). */
export function buildPromptInicialForTarget(
  target: GovernanceTarget,
  facts: ProjectGovernanceFacts,
  complexity: ComplexityLevel,
  featureDir?: string,
): string {
  const overlay = targetOverlays()[target];
  const projectLabel = facts.projectTitle?.trim() || "este proyecto";
  const label = GOVERNANCE_TARGET_LABELS[target];

  let md =
    `# Prompt inicial — ${label}\n\n` +
    `**Misión:** Implementar **${projectLabel}** desde el entregable TheForge, tarea a tarea, respetando spec-kit y gobernanza IA.\n\n` +
    "## Prerrequisitos (humano)\n\n" +
    overlay.prereqs +
    "\n" +
    "## Paso 1 — Instalar gobernanza IA (acción del agente)\n\n" +
    overlay.step1 +
    "\n";

  if (overlay.step15.trim()) {
    md += "## Paso 1.5 — Vincular The Forge MCP (si aplica)\n\n" + overlay.step15 + "\n";
  }

  md += buildPromptInicialCore(facts, complexity, featureDir);
  md += "\n## Sesiones siguientes\n\n" + overlay.sessions;

  return md;
}

/** Índice raíz que apunta a cada PROMPT-INICIAL.{target}.md */
export function buildPromptInicialIndexMd(): string {
  const rows = GOVERNANCE_TARGETS_ORDER.map(
    (t) => `| ${GOVERNANCE_TARGET_LABELS[t]} | \`${promptInicialFilename(t)}\` |`,
  );
  return (
    "# Prompt inicial — elige tu IDE\n\n" +
    "Este handoff incluye un prompt **paste-ready** por herramienta. Abre **solo** el archivo de tu IDE:\n\n" +
    "| IDE | Archivo |\n" +
    "|-----|--------|\n" +
    rows.join("\n") +
    "\n\n" +
    "Copia el contenido completo del archivo elegido en la primera sesión del agente.\n"
  );
}

/** Genera índice + 7 variantes PROMPT-INICIAL.{target}.md */
export function buildAllPromptIniciales(
  facts: ProjectGovernanceFacts,
  complexity: ComplexityLevel,
  featureDir?: string,
): PromptInicialFile[] {
  const files: PromptInicialFile[] = [
    { path: "PROMPT-INICIAL.md", content: buildPromptInicialIndexMd() },
    {
      path: `${GOVERNANCE_DOCS_PREFIX}PROMPT-INICIAL.md`,
      content: buildPromptInicialIndexMd(),
    },
  ];

  for (const target of GOVERNANCE_TARGETS_ORDER) {
    files.push({
      path: promptInicialFilename(target),
      content: buildPromptInicialForTarget(target, facts, complexity, featureDir),
    });
  }

  return files;
}
