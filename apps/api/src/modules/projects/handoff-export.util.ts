import { createHash } from "node:crypto";
import type { Project, Stage } from "@theforge/database";
import {
  appendProjectDeliverablesToScaffold,
  enrichExportWithMultiTargetBundle,
  getRequiredAgentGovernancePaths,
  parseAgentGovernanceResponse,
  reconcileAgentGovernanceScaffold,
  serializeAgentGovernanceScaffold,
  type ProjectDeliverableExportInput,
} from "../ai/utils/agent-governance.util.js";
import {
  suggestAgentGovernanceArtifacts,
  extractProjectGovernanceFacts,
  type SuggestAgentGovernanceInput,
} from "../ai/utils/suggest-agent-governance-artifacts.js";
import {
  buildAriadneHandoffGovernanceCorpus,
  getLegacyChangeState,
  isAriadneSourcedStageOrigin,
  type IntegrationHandoffItem,
} from "@theforge/shared-types";
import { resolveStageDeliverables } from "./stage-deliverables.util.js";
import {
  ensurePostMvpUiSurfaceBanner,
  sanitizeMddForExport,
} from "../ai-analysis/utils/mdd-sanitize.js";
import { injectProposedComponentDiagramIntoSection2 } from "../ai-analysis/utils/mdd-component-diagram.util.js";
import { qualifyBlueprintPostMvpUiMentions } from "../engine/blueprint-enrich-ui-system.js";
import { alignSddDeliverablesAtPersist, finalizeInfraMarkdownForExport } from "../documentation-gap/sdd-align-at-persist.util.js";
import { listArchitectureDecisionFiles } from "../documentation-gap/architecture-decision.util.js";
import { validateMddForDelivery } from "../ai-analysis/utils/mdd-delivery-gate.util.js";
import { checkAgentGovernanceVsMdd } from "./agent-governance-conformance.util.js";
import { collectSddPrecisionGaps } from "../engine/sdd-precision-checks.util.js";
import { enrichGovernanceScaffoldForHandoff } from "./governance-handoff-bootstrap.util.js";
import {
  AGENT_GOVERNANCE_TEMPLATE_VERSION,
  buildBranchPolicyExportFile,
  buildSpecKitBundleFiles,
  buildTheforgeDocConsumptionGuide,
  formatDocumentMarkdown,
  GOVERNANCE_DOCS_PREFIX,
  ROOT_THEFORGE_DOC_CONSUMPTION_GUIDE,
  parseAgentGovernanceScaffold,
  resolveDocumentPathMap,
  specKitFeatureDir,
  splitPantallasAndUiProject,
  type AgentGovernanceScaffold,
  type ComplexityLevel,
  type DocumentPathEntry,
  type SddAgentGovernanceAnalyzeSlice,
  type SpecKitBundleFile,
  type TheforgeProjectJson,
} from "@theforge/shared-types";
import { pickPrimaryStage } from "./stage-helpers.js";
import { resolveProjectTasksSsot } from "./tasks-ssot-resolve.util.js";

type ProjectWithStages = Project & { stages: Stage[] };

const SDD_MIRROR_PATHS = [
  "docs/sdd/mdd.md",
  "docs/sdd/spec.md",
  "docs/sdd/blueprint.md",
  "docs/sdd/architecture.md",
  "docs/sdd/use-cases.md",
  "docs/sdd/user-stories.md",
  "docs/sdd/api-contracts.md",
  "docs/sdd/logic-flows.md",
  "docs/sdd/ux-ui-guide.md",
  "docs/sdd/pantallas.md",
  "docs/sdd/tasks.md",
  "docs/sdd/infra.md",
] as const;

export interface UnifiedHandoff {
  featureDir: string;
  projectName: string;
  specKitFiles: SpecKitBundleFile[];
  agentGovernance: AgentGovernanceScaffold | null;
  layout: "spec-kit-primary";
  pathMap: DocumentPathEntry[];
  governancePresent: boolean;
  /** Set when reconcile changed serialized governance (caller may persist). */
  serializedGovernance?: string;
  governancePersisted?: boolean;
}

export interface HandoffFileWithHash {
  path: string;
  content: string;
  size: number;
  sha256: string;
}

/** MDD or fallback for LOW/MEDIUM without full MDD. */
export function projectConstitutionMarkdown(project: ProjectWithStages): string {
  const stage = pickPrimaryStage(project.stages);
  const mdd = (stage?.mddContent ?? "").trim();
  if (mdd.length > 0) return mdd;
  const cx = project.complexity ?? "HIGH";
  if (cx === "LOW" || cx === "MEDIUM") {
    const parts = [
      (project.dbgaContent ?? "").trim(),
      (project.phase0SummaryContent ?? "").trim(),
      (project.specContent ?? "").trim(),
    ].filter((p) => p.length > 0);
    return parts.join("\n\n---\n\n");
  }
  return "";
}

/** Strips optional ui-project.json annex from stored uiScreensContent for handoff. */
export function exportPantallasMarkdown(raw: string | null | undefined): string | null | undefined {
  const trimmed = raw?.trim();
  if (!trimmed) return raw;
  const { pantallas } = splitPantallasAndUiProject(trimmed);
  return pantallas.trim() || trimmed;
}

/** Deliverables for SDD mirrors / handoff ZIP (respects stage snapshot in analyze mode). */
export function buildProjectDeliverableExportInput(
  project: ProjectWithStages,
  stage: Stage | null | undefined,
): ProjectDeliverableExportInput {
  const deliverables = stage
    ? resolveStageDeliverables(project, stage, "analyze").deliverables
    : project;
  const mdd = projectConstitutionMarkdown(project);
  return {
    mddMarkdown: mdd,
    blueprintMarkdown: deliverables.blueprintContent ?? project.blueprintContent,
    specMarkdown: deliverables.specContent ?? project.specContent,
    architectureMarkdown: deliverables.architectureContent ?? project.architectureContent,
    tasksMarkdown: deliverables.tasksContent ?? project.tasksContent,
    useCasesMarkdown: deliverables.useCasesContent ?? project.useCasesContent,
    userStoriesMarkdown: deliverables.userStoriesContent ?? project.userStoriesContent,
    apiContractsMarkdown: deliverables.apiContractsContent ?? project.apiContractsContent,
    logicFlowsMarkdown: deliverables.logicFlowsContent ?? project.logicFlowsContent,
    uxUiGuideMarkdown: deliverables.uxUiGuideContent ?? project.uxUiGuideContent,
    uiScreensMarkdown: exportPantallasMarkdown(
      deliverables.uiScreensContent ?? project.uiScreensContent,
    ),
    infraMarkdown: deliverables.infraContent ?? project.infraContent,
  };
}

const SDD_MIRROR_PATHS_FOR_SPEC_KIT: Array<{
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

/**
 * Adds docs/sdd mirrors, openspec/BRANCH-POLICY and extra files to spec-kit bundle for ZIP export.
 * Ensures handoff is complete even when agent governance was not pre-generated.
 */
export function enrichSpecKitFilesForHandoff(
  specKitFiles: SpecKitBundleFile[],
  deliverables: ProjectDeliverableExportInput,
  extraFiles: SpecKitBundleFile[] = [],
): SpecKitBundleFile[] {
  const map = new Map<string, string>();
  for (const file of specKitFiles) map.set(file.path, file.content);
  for (const file of extraFiles) map.set(file.path, file.content);

  for (const { key, path } of SDD_MIRROR_PATHS_FOR_SPEC_KIT) {
    const content = deliverables[key]?.trim();
    if (content) map.set(path, content);
  }

  const branchPolicy = buildBranchPolicyExportFile();
  map.set(branchPolicy.path, branchPolicy.content);

  if (!map.has("docs/sdd/PROGRESO.md") && deliverables.tasksMarkdown?.trim()) {
    map.set(
      "docs/sdd/PROGRESO.md",
      `# Progreso de implementación\n\nChecklist derivado de **Tasks**. Marca \`[x]\` al completar.\n\n${deliverables.tasksMarkdown.trim()}\n`,
    );
  }

  return [...map.entries()]
    .map(([path, content]) => ({ path, content }))
    .sort((a, b) => a.path.localeCompare(b.path));
}

/**
 * Full governance scaffold for export when `agentGovernanceContent` is empty (deterministic fallbacks).
 */
export function synthesizeExportGovernanceScaffold(
  project: ProjectWithStages,
): AgentGovernanceScaffold {
  const complexity = (project.complexity ?? "HIGH") as ComplexityLevel;
  const stage = pickPrimaryStage(project.stages);
  const mdd = projectConstitutionMarkdown(project);
  const governanceInput = buildAgentGovernanceInput(project, mdd, complexity, stage);
  const suggestions = suggestAgentGovernanceArtifacts(governanceInput);
  const featureDir = specKitFeatureDir(stage?.ordinal ?? 1, project.name);
  const scaffold = parseAgentGovernanceResponse('{"files":{}}', complexity, {
    suggestions,
    governanceInput,
    featureDir,
  });
  return enrichExportWithMultiTargetBundle(
    enrichGovernanceScaffoldForHandoff(
      appendProjectDeliverablesToScaffold(scaffold, buildProjectDeliverableExportInput(project, stage)),
      featureDir,
    ),
    {
      facts: extractProjectGovernanceFacts(governanceInput),
      complexity,
      featureDir,
    },
  );
}

export function buildAgentGovernanceInput(
  project: Project,
  mddMarkdown: string,
  complexity: ComplexityLevel,
  stage?: Stage | null,
  deliverableOverrides?: {
    tasksContent?: string | null;
    userStoriesContent?: string | null;
    blueprintContent?: string | null;
    infraContent?: string | null;
  },
): SuggestAgentGovernanceInput {
  const legacyState = getLegacyChangeState(stage ?? null);
  const snap = stage?.handoffSnapshot as { items?: IntegrationHandoffItem[] } | null | undefined;
  const handoffItems = snap?.items ?? [];
  const ariadneCorpus =
    isAriadneSourcedStageOrigin(legacyState.stageOrigin) && handoffItems.length > 0
      ? buildAriadneHandoffGovernanceCorpus(
          handoffItems,
          typeof legacyState.description === "string" ? legacyState.description : null,
        )
      : "";

  const tasksFromStage =
    deliverableOverrides?.tasksContent ?? stage?.tasksContent ?? project.tasksContent;
  const tasksMarkdown = tasksFromStage?.trim()
    ? tasksFromStage
    : ariadneCorpus.includes("# Tasks") || ariadneCorpus.includes("## Tareas Cursor")
      ? ariadneCorpus
      : tasksFromStage;

  const mdd = mddMarkdown.trim();
  const mddForGovernance =
    mdd.length > 200
      ? mdd
      : ariadneCorpus.trim()
        ? `# Cambio brownfield (Ariadne → The Forge)\n\n${ariadneCorpus}`
        : mdd;

  const sddPendingGaps =
    mddForGovernance.length > 200
      ? collectSddPrecisionGaps({
          mdd: mddForGovernance,
          architecture: project.architectureContent,
          blueprint: deliverableOverrides?.blueprintContent ?? project.blueprintContent,
          tasks: tasksMarkdown,
          logicFlows: project.logicFlowsContent,
          userStories: deliverableOverrides?.userStoriesContent ?? project.userStoriesContent,
          useCases: project.useCasesContent,
          apiContracts: project.apiContractsContent,
          pantallas: project.uiScreensContent,
          phase0Summary: project.phase0SummaryContent,
        })
      : [];
  return {
    mddMarkdown: mddForGovernance,
    blueprintMarkdown: deliverableOverrides?.blueprintContent ?? project.blueprintContent,
    tasksMarkdown,
    architectureMarkdown: project.architectureContent,
    specMarkdown: project.specContent,
    apiContractsMarkdown: project.apiContractsContent,
    logicFlowsMarkdown: project.logicFlowsContent,
    uxUiGuideMarkdown: project.uxUiGuideContent,
    uiScreensMarkdown: project.uiScreensContent,
    infraMarkdown: deliverableOverrides?.infraContent ?? project.infraContent,
    useCasesMarkdown: project.useCasesContent,
    userStoriesMarkdown: deliverableOverrides?.userStoriesContent ?? project.userStoriesContent,
    projectName: project.name,
    projectId: project.id,
    stageId: stage?.id ?? null,
    stageOrdinal: stage?.ordinal ?? null,
    projectType: project.projectType,
    complexity,
    sddPendingGaps,
  };
}

function alignedDeliverablesForProject(project: ProjectWithStages) {
  const stage = pickPrimaryStage(project.stages);
  const mddRaw = stage?.mddContent ?? projectConstitutionMarkdown(project);
  return alignSddDeliverablesAtPersist({
    mddContent: mddRaw ?? "",
    tasksContent: project.tasksContent,
    userStoriesContent: project.userStoriesContent,
    blueprintContent: project.blueprintContent,
    infraContent: project.infraContent,
  });
}

function extractGovernanceCorpusForExport(agentGovernanceContent: string | null | undefined): string {
  const raw = agentGovernanceContent?.trim();
  if (!raw) return "";
  const scaffold = parseAgentGovernanceScaffold(raw);
  const agents = scaffold?.files.find((f) => f.path === "AGENTS.md" || f.path.endsWith("/AGENTS.md"));
  return agents?.content?.trim() ?? "";
}

function buildInfraExportOpts(
  aligned: ReturnType<typeof alignSddDeliverablesAtPersist>,
  governanceCorpus: string,
): { extraCorpus: string; packageManagerCorpus: string } | undefined {
  const corpus = [governanceCorpus, aligned.tasksContent, aligned.userStoriesContent]
    .filter(Boolean)
    .join("\n")
    .trim();
  return corpus ? { extraCorpus: corpus, packageManagerCorpus: corpus } : undefined;
}

const ROOT_CONSUMPTION_GUIDE = ROOT_THEFORGE_DOC_CONSUMPTION_GUIDE;

function ensureRootConsumptionGuideInSpecKit(
  specKitFiles: SpecKitBundleFile[],
  agentGovernance: AgentGovernanceScaffold | null,
  featureDir: string,
): SpecKitBundleFile[] {
  if (specKitFiles.some((f) => f.path === ROOT_CONSUMPTION_GUIDE)) {
    return specKitFiles;
  }
  const fromGovernance = agentGovernance?.files.find(
    (f) => f.path === ROOT_CONSUMPTION_GUIDE || f.path.endsWith("THEFORGE-DOC-CONSUMPTION-GUIDE.md"),
  )?.content?.trim();
  const content = fromGovernance || buildTheforgeDocConsumptionGuide(featureDir);
  return [...specKitFiles, { path: ROOT_CONSUMPTION_GUIDE, content }];
}

/** Reconcile governance scaffold + inject docs/sdd deliverables (shared by export paths). */
export function reconcileExportScaffold(
  project: ProjectWithStages,
  options?: { throwIfMissing?: boolean; forceFreshOverlay?: boolean },
): AgentGovernanceScaffold | null {
  const raw = project.agentGovernanceContent?.trim() ?? "";
  if (!raw) {
    if (options?.throwIfMissing) {
      throw new Error("No hay gobernanza de agentes generada para este proyecto.");
    }
    return null;
  }

  const scaffold = parseAgentGovernanceScaffold(raw);
  if (!scaffold) {
    if (options?.throwIfMissing) {
      throw new Error("El scaffold de gobernanza no contiene archivos válidos.");
    }
    return null;
  }

  const complexity = (project.complexity ?? "HIGH") as ComplexityLevel;
  const stage = pickPrimaryStage(project.stages);
  const aligned = alignedDeliverablesForProject(project);
  const mdd = aligned.mddContent || projectConstitutionMarkdown(project);
  const governanceInput = buildAgentGovernanceInput(project, mdd, complexity, stage, {
    tasksContent: aligned.tasksContent,
    userStoriesContent: aligned.userStoriesContent,
    blueprintContent: aligned.blueprintContent,
    infraContent: aligned.infraContent,
  });
  const suggestions = suggestAgentGovernanceArtifacts(governanceInput);
  const featureDir = specKitFeatureDir(stage?.ordinal ?? 1, project.name);

  const reconciled = reconcileAgentGovernanceScaffold(scaffold, complexity, {
    suggestions,
    governanceInput,
    forceFreshOverlay: options?.forceFreshOverlay === true,
    featureDir,
  });

  const withDeliverables = enrichGovernanceScaffoldForHandoff(
    appendProjectDeliverablesToScaffold(
      reconciled,
      buildProjectDeliverableExportInput(project, pickPrimaryStage(project.stages)),
    ),
    featureDir,
  );

  const facts = extractProjectGovernanceFacts(governanceInput);
  return enrichExportWithMultiTargetBundle(withDeliverables, {
    facts,
    complexity,
    featureDir,
  });
}

export function buildSpecKitFilesForProject(
  project: ProjectWithStages,
  consumptionGuideContent: string | null,
  stage?: Stage | null,
): SpecKitBundleFile[] {
  const primaryStage = stage ?? pickPrimaryStage(project.stages);
  const deliverables = primaryStage
    ? resolveStageDeliverables(project, primaryStage, "analyze").deliverables
    : project;
  const aligned = alignedDeliverablesForProject(project);
  const rawMdd =
    (primaryStage?.mddContent ?? "").trim() ||
    aligned.mddContent ||
    projectConstitutionMarkdown(project);
  const mdd = rawMdd?.trim()
    ? injectProposedComponentDiagramIntoSection2(sanitizeMddForExport(rawMdd))
    : rawMdd;
  const jwtCorpus = [aligned.tasksContent, aligned.userStoriesContent].filter(Boolean).join("\n");
  const governanceCorpus = extractGovernanceCorpusForExport(project.agentGovernanceContent);
  const infraExportOpts =
    buildInfraExportOpts(aligned, governanceCorpus) ??
    (jwtCorpus.trim() ? { extraCorpus: jwtCorpus, packageManagerCorpus: jwtCorpus } : undefined);
  const uxUiRaw = deliverables.uxUiGuideContent ?? project.uxUiGuideContent;
  const uxUiTrimmed = uxUiRaw?.trim();
  const uxUiFormatted = uxUiTrimmed ? formatDocumentMarkdown(uxUiTrimmed) : null;
  const uxUi = uxUiFormatted
    ? ensurePostMvpUiSurfaceBanner(mdd ?? "", uxUiFormatted)
    : uxUiRaw;
  const infraSource = aligned.infraContent ?? deliverables.infraContent ?? project.infraContent;
  const infra = infraSource?.trim()
    ? finalizeInfraMarkdownForExport(mdd ?? "", infraSource, infraExportOpts)
    : infraSource;
  const blueprintSource = aligned.blueprintContent ?? deliverables.blueprintContent ?? project.blueprintContent;
  const blueprint = blueprintSource?.trim()
    ? qualifyBlueprintPostMvpUiMentions(mdd ?? "", blueprintSource)
    : blueprintSource;
  const tasksSsot = resolveProjectTasksSsot({
    tasksContent: aligned.tasksContent ?? deliverables.tasksContent ?? project.tasksContent,
    tasksJson: project.tasksJson,
    stageTasksJson: primaryStage?.tasksJson,
  });
  return buildSpecKitBundleFiles({
    projectName: project.name,
    featureOrdinal: primaryStage?.ordinal ?? 1,
    mddContent: mdd,
    specContent: deliverables.specContent ?? project.specContent,
    blueprintContent: blueprint,
    tasksContent: tasksSsot.markdown ?? aligned.tasksContent ?? deliverables.tasksContent ?? project.tasksContent,
    tasksJson: primaryStage?.tasksJson ?? project.tasksJson,
    apiContractsContent: deliverables.apiContractsContent ?? project.apiContractsContent,
    logicFlowsContent: deliverables.logicFlowsContent ?? project.logicFlowsContent,
    infraContent: infra,
    architectureContent: deliverables.architectureContent ?? project.architectureContent,
    useCasesContent: deliverables.useCasesContent ?? project.useCasesContent,
    userStoriesContent: aligned.userStoriesContent ?? deliverables.userStoriesContent ?? project.userStoriesContent,
    phase0SummaryContent: project.phase0SummaryContent,
    dbgaContent: project.dbgaContent,
    uxUiGuideContent: uxUi,
    uiScreensContent: deliverables.uiScreensContent ?? project.uiScreensContent,
    consumptionGuideContent,
  });
}

/** Single source of truth for repo-handoff and agent-governance-export. */
export function buildUnifiedHandoff(
  project: ProjectWithStages,
  consumptionGuideContent: string | null,
): UnifiedHandoff {
  const stage = pickPrimaryStage(project.stages);
  const featureDir = specKitFeatureDir(stage?.ordinal ?? 1, project.name);

  const raw = project.agentGovernanceContent?.trim() ?? "";
  let agentGovernance: AgentGovernanceScaffold | null = null;
  let serializedGovernance: string | undefined;
  let governancePersisted = false;

  if (raw) {
    agentGovernance = reconcileExportScaffold(project);
    if (agentGovernance) {
      serializedGovernance = serializeAgentGovernanceScaffold(agentGovernance);
      governancePersisted = serializedGovernance !== raw;
    }
  }

  const specKitFiles = ensureRootConsumptionGuideInSpecKit(
    buildSpecKitFilesForProject(
      project,
      consumptionGuideContent ?? buildTheforgeDocConsumptionGuide(featureDir),
      stage,
    ),
    agentGovernance,
    featureDir,
  );

  const adrFiles = listArchitectureDecisionFiles(project.agentGovernanceContent);
  const specKitPaths = new Set(specKitFiles.map((f) => f.path));
  for (const adr of adrFiles) {
    if (!specKitPaths.has(adr.path)) {
      specKitFiles.push({ path: adr.path, content: adr.content });
      specKitPaths.add(adr.path);
    }
  }

  specKitFiles.push(theforgeProjectJsonSpecKitFile(project));

  return {
    featureDir,
    projectName: project.name,
    specKitFiles,
    agentGovernance,
    layout: "spec-kit-primary",
    pathMap: resolveDocumentPathMap(featureDir),
    governancePresent: !!(agentGovernance?.files?.length),
    serializedGovernance,
    governancePersisted,
  };
}

export function scaffoldToRepoHandoffGovernance(scaffold: AgentGovernanceScaffold | null): {
  present: boolean;
  files: Array<{ path: string; content: string }>;
  manifest?: Record<string, unknown>;
} {
  if (!scaffold?.files?.length) {
    return { present: false, files: [] };
  }
  return {
    present: true,
    files: scaffold.files.map((f) => ({ path: f.path, content: f.content })),
    manifest: scaffold.manifest as Record<string, unknown>,
  };
}

export function analyzeAgentGovernanceSlice(
  project: ProjectWithStages,
): SddAgentGovernanceAnalyzeSlice {
  const complexity = (project.complexity ?? "HIGH") as ComplexityLevel;
  const raw = project.agentGovernanceContent?.trim() ?? "";
  const stage = pickPrimaryStage(project.stages);
  const mdd = projectConstitutionMarkdown(project);
  const governanceInput = buildAgentGovernanceInput(project, mdd, complexity, stage);
  const deliverables = buildProjectDeliverableExportInput(project, stage);

  if (!raw) {
    return {
      present: false,
      fileCount: 0,
      missingRequiredPaths: getRequiredAgentGovernancePaths(complexity),
      hasInstallGuide: false,
      pathAlignmentOk: false,
      missingMirrorPaths: [],
      mddConformanceOk: false,
      mddConformanceGaps: ["Gobernanza IA no generada"],
    };
  }

  const reconciled = reconcileExportScaffold(project);
  if (!reconciled) {
    return {
      present: false,
      fileCount: 0,
      missingRequiredPaths: getRequiredAgentGovernancePaths(complexity),
      hasInstallGuide: false,
      pathAlignmentOk: false,
      missingMirrorPaths: [],
      mddConformanceOk: false,
      mddConformanceGaps: ["Scaffold de gobernania inválido"],
    };
  }

  const paths = new Set(reconciled.files.map((f) => f.path));
  const required = getRequiredAgentGovernancePaths(complexity);
  const missingRequiredPaths = required.filter((p) => !paths.has(p));
  const installPath = `${GOVERNANCE_DOCS_PREFIX}INSTALACION.md`;
  const hasInstallGuide = paths.has(installPath);

  const expectedMirrors = SDD_MIRROR_PATHS.filter((mirrorPath) => {
    const key = SDD_MIRROR_PATHS_FOR_SPEC_KIT.find((e) => e.path === mirrorPath)?.key;
    if (!key) return false;
    return !!deliverables[key]?.trim();
  });
  const missingMirrorPaths = expectedMirrors.filter((p) => !paths.has(p));
  const pathAlignmentOk = missingMirrorPaths.length === 0;

  const mddConformance = checkAgentGovernanceVsMdd(reconciled, governanceInput);

  return {
    present: true,
    fileCount: reconciled.files.length,
    missingRequiredPaths,
    hasInstallGuide,
    pathAlignmentOk,
    missingMirrorPaths,
    mddConformanceOk: mddConformance.ok,
    mddConformanceGaps: mddConformance.gaps,
  };
}

export function hashHandoffContent(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

/** JSON raíz del handoff para vincular repo destino con The Forge MCP. */
export function buildTheforgeProjectJson(
  project: ProjectWithStages,
  options?: { handoffVersion?: string },
): TheforgeProjectJson {
  const stage = pickPrimaryStage(project.stages);
  const featureDir = specKitFeatureDir(stage?.ordinal ?? 1, project.name);
  const pathMap = resolveDocumentPathMap(featureDir);
  const artifactPaths: Record<string, string> = {};
  for (const entry of pathMap) {
    artifactPaths[entry.label] = entry.mirror;
  }
  const mddRaw = (stage?.mddContent ?? "").trim();
  const deliveryGate = mddRaw.length > 80 ? validateMddForDelivery(mddRaw) : undefined;
  return {
    projectId: project.id,
    stageId: stage?.id ?? "",
    projectName: project.name,
    stageOrdinal: stage?.ordinal ?? 1,
    handoffVersion: options?.handoffVersion ?? AGENT_GOVERNANCE_TEMPLATE_VERSION,
    exportedAt: new Date().toISOString(),
    artifactPaths,
    mcp: { tool: "report_documentation_gap" },
    ...(deliveryGate
      ? {
          deliveryGate: {
            ok: deliveryGate.ok,
            score: deliveryGate.score,
            blockers: deliveryGate.blockers,
            warnings: deliveryGate.warnings,
          },
        }
      : {}),
  };
}

export function theforgeProjectJsonSpecKitFile(
  project: ProjectWithStages,
  options?: { handoffVersion?: string },
): SpecKitBundleFile {
  const json = buildTheforgeProjectJson(project, options);
  return {
    path: ".theforge-project.json",
    content: `${JSON.stringify(json, null, 2)}\n`,
  };
}

export function toHandoffFilesWithHash(
  files: Array<{ path: string; content: string }>,
): HandoffFileWithHash[] {
  return files.map((f) => ({
    path: f.path,
    content: f.content,
    size: f.content.length,
    sha256: hashHandoffContent(f.content),
  }));
}
