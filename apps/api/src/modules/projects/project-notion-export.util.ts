import { createHash } from "node:crypto";
import type { Project, Stage } from "@theforge/database";
import { StageStatus } from "@theforge/database";
import {
  buildNotionIndexHtml,
  buildProjectMetadataMarkdown,
  notionExportId,
  notionPageBasename,
  notionSafeSegment,
  notionStageFolderName,
  NOTION_PORTABILITY_FORMAT,
  NOTION_PORTABILITY_VERSION,
  NOTION_PROJECT_DOC_ENTRIES,
  NOTION_STAGE_DOC_ENTRIES,
  parseIntegrationHandoff,
  isGreenfield,
  isLegacy,
  serializeCsv,
  type NotionExportOptions,
  type NotionIntegrationLinkFile,
  type NotionPortabilityIdMap,
  type NotionPortabilityManifest,
} from "@theforge/shared-types";
import { exportPantallasMarkdownOnly, splitPantallasAndUiProject } from "@theforge/shared-types";

type StageWithEst = Stage & { estimation?: { totalHours: number; totalMxn: number; teamStructure: unknown } | null };

export type ProjectNotionExportSource = Project & {
  stages: StageWithEst[];
  integrationTracesAsNew: Array<{
    id: string;
    newLegId: string;
    legacyStoryId: string | null;
    legacyStageId: string | null;
    screenOrEndpoint: string | null;
    status: string;
  }>;
  integrationTracesAsLegacy: Array<{
    id: string;
    newLegId: string;
    legacyStoryId: string | null;
    legacyStageId: string | null;
    screenOrEndpoint: string | null;
    status: string;
  }>;
};

function jsonAsset(value: unknown): string | null {
  if (value == null) return null;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return null;
  }
}

function stageFieldValue(stage: StageWithEst, field: string): string | null {
  const value = (stage as Record<string, unknown>)[field];
  return typeof value === "string" ? value : null;
}

function projectFieldValue(project: Project, field: string): string | null {
  const value = (project as Record<string, unknown>)[field];
  return typeof value === "string" ? value : null;
}

export interface NotionExportFileEntry {
  path: string;
  content: string | Buffer;
}

export function buildNotionExportEntries(
  project: ProjectNotionExportSource,
  options: NotionExportOptions = { includeIntegration: true, includeSessions: false },
): NotionExportFileEntry[] {
  const exportedAt = new Date().toISOString();
  const projectExportId = notionExportId(project.id);
  const root = notionSafeSegment(project.name);
  const entries: NotionExportFileEntry[] = [];
  const indexLinks: Array<{ href: string; label: string }> = [];

  const push = (relativePath: string, content: string | Buffer) => {
    entries.push({ path: `${root}/${relativePath}`, content });
  };

  const projectMetaMd = buildProjectMetadataMarkdown({
    name: project.name,
    projectType: project.projectType,
    complexity: project.complexity,
    visibility: project.visibility,
    hasUxTeam: project.hasUxTeam,
    theforgeProjectId: project.theforgeProjectId,
    phase0Status: project.phase0Status,
    exportedAt,
  });
  const projectPage = notionPageBasename(project.name, projectExportId);
  push(projectPage, projectMetaMd);
  indexLinks.push({ href: projectPage, label: project.name });

  for (const doc of NOTION_PROJECT_DOC_ENTRIES) {
    const content = projectFieldValue(project, doc.field)?.trim();
    if (!content) continue;
    const filename = notionPageBasename(doc.filenamePrefix, projectExportId);
    push(filename, content);
    indexLinks.push({ href: filename, label: doc.label });
  }

  const stages = [...project.stages].sort((a, b) => a.ordinal - b.ordinal);
  const stageExportIds = new Map(stages.map((stage) => [stage.id, notionExportId(stage.id)]));

  const stageRows: string[][] = [];
  for (const stage of stages) {
    const stageExportId = stageExportIds.get(stage.id)!;
    const folder = notionStageFolderName(stage.ordinal, stage.name, stageExportId);
    indexLinks.push({ href: `${folder}/`, label: folder });

    stageRows.push([
      stageExportId,
      String(stage.ordinal),
      stage.key ?? "",
      stage.name ?? "",
      stage.workflowStatus,
      stage.status,
      String(stage.precisionScore),
      stage.isLegacy ? "true" : "false",
      stage.linkedNewProjectId ? notionExportId(stage.linkedNewProjectId) : "",
      stage.handoffImportedAt?.toISOString() ?? "",
    ]);

    // Pantallas vive en Project (no Stage); se exporta una sola vez en la etapa primaria.
    const isPrimaryStageForUiScreens =
      stage.workflowStatus === StageStatus.ACTIVE ||
      (!stages.some((s) => s.workflowStatus === StageStatus.ACTIVE) && stage.ordinal === stages[0]?.ordinal);

    for (const doc of NOTION_STAGE_DOC_ENTRIES) {
      let content =
        doc.field === "uiScreensContent"
          ? isPrimaryStageForUiScreens
            ? projectFieldValue(project, "uiScreensContent")?.trim() ?? ""
            : ""
          : stageFieldValue(stage, doc.field)?.trim() ?? "";
      if (!content) continue;

      if (doc.field === "uiScreensContent") {
        const { uiProjectJson } = splitPantallasAndUiProject(content);
        content = exportPantallasMarkdownOnly(content);
        if (uiProjectJson?.trim()) {
          push(`${folder}/_assets/ui-project.json`, uiProjectJson.trim());
        }
      }

      if (doc.field === "agentGovernanceContent") {
        push(`${folder}/${notionPageBasename(doc.filenamePrefix, stageExportId)}`, content);
        continue;
      }

      push(`${folder}/${notionPageBasename(doc.filenamePrefix, stageExportId)}`, content);
    }

    const assetPairs: Array<[string, unknown]> = [
      ["domain-inventory.json", stage.domainInventory],
      ["tasks-json.json", stage.tasksJson],
      ["legacy-change-state.json", stage.legacyChangeState],
      ["handoff-snapshot.json", stage.handoffSnapshot],
      ["deliverable-snapshot.json", stage.deliverableSnapshot],
      ["short-term-context.json", stage.shortTermContext],
      ["mdd-upstream-baseline.json", stage.mddUpstreamBaseline],
      ["design-spec.json", stage.designSpec],
      ["design-spec-revision.json", stage.designSpecRevision],
      ["architecture-graph.json", stage.architectureGraph],
      ["architecture-graph-source-hash.json", stage.architectureGraphSourceHash],
    ];
    for (const [filename, value] of assetPairs) {
      const serialized = jsonAsset(value);
      if (serialized) push(`${folder}/_assets/${filename}`, serialized);
    }

    if (stage.estimation) {
      push(
        `${folder}/_assets/estimation.json`,
        JSON.stringify(
          {
            totalHours: stage.estimation.totalHours,
            totalMxn: stage.estimation.totalMxn,
            teamStructure: stage.estimation.teamStructure,
          },
          null,
          2,
        ),
      );
    }
  }

  push(
    "Etapas.csv",
    serializeCsv(
      [
        "exportId",
        "ordinal",
        "key",
        "name",
        "workflowStatus",
        "status",
        "precisionScore",
        "isLegacy",
        "linkedNewProjectExportId",
        "handoffImportedAt",
      ],
      stageRows,
    ),
  );
  indexLinks.push({ href: "Etapas.csv", label: "Etapas (CSV)" });

  if (options.includeIntegration) {
    const handoff = parseIntegrationHandoff(project.integrationHandoff);
    const handoffRows = handoff.items.map((item) => [
      item.id,
      item.title,
      item.description,
      item.status,
      item.actor ?? "",
      (item.acceptanceCriteria ?? []).join("|"),
      item.legacyStoryId ?? "",
      item.legacyStageId ? (stageExportIds.get(item.legacyStageId) ?? "") : "",
    ]);
    push(
      "Integración/Handoff items.csv",
      serializeCsv(
        [
          "id",
          "title",
          "description",
          "status",
          "actor",
          "acceptanceCriteria",
          "legacyStoryId",
          "legacyStageExportId",
        ],
        handoffRows,
      ),
    );
    indexLinks.push({ href: "Integración/Handoff items.csv", label: "Handoff items" });

    const traces = [
      ...project.integrationTracesAsNew,
      ...project.integrationTracesAsLegacy.filter(
        (legacyTrace) => !project.integrationTracesAsNew.some((n) => n.id === legacyTrace.id),
      ),
    ];
    const uniqueTraces = [...new Map(traces.map((trace) => [trace.id, trace])).values()];
    const traceRows = uniqueTraces.map((trace) => [
      trace.newLegId,
      trace.legacyStoryId ?? "",
      trace.legacyStageId ? (stageExportIds.get(trace.legacyStageId) ?? "") : "",
      trace.screenOrEndpoint ?? "",
      trace.status,
    ]);
    push(
      "Integración/Trazas integración.csv",
      serializeCsv(
        ["newLegId", "legacyStoryId", "legacyStageExportId", "screenOrEndpoint", "status"],
        traceRows,
      ),
    );
    indexLinks.push({ href: "Integración/Trazas integración.csv", label: "Trazas integración" });
  }

  const idMap: NotionPortabilityIdMap = {
    projectExportId,
    originalProjectId: project.id,
    linkedLegacyProjectExportId: project.linkedLegacyProjectId
      ? notionExportId(project.linkedLegacyProjectId)
      : null,
    linkedNewProjectExportId: project.linkedNewProjectId ? notionExportId(project.linkedNewProjectId) : null,
    stages: stages.map((stage) => ({
      exportId: stageExportIds.get(stage.id)!,
      originalStageId: stage.id,
      ordinal: stage.ordinal,
    })),
  };

  const manifest: NotionPortabilityManifest = {
    format: NOTION_PORTABILITY_FORMAT,
    version: NOTION_PORTABILITY_VERSION,
    exportedAt,
    projectName: project.name,
    projectExportId,
    projectType: project.projectType,
    options,
  };

  push("_theforge/manifest.json", JSON.stringify(manifest, null, 2));
  push("_theforge/id-map.json", JSON.stringify(idMap, null, 2));

  if (isGreenfield(project.projectType) && project.linkedLegacyProjectId) {
    const link: NotionIntegrationLinkFile = {
      version: NOTION_PORTABILITY_VERSION,
      newProjectExportId: projectExportId,
      legacyProjectExportId: notionExportId(project.linkedLegacyProjectId),
    };
    push("_theforge/integration-link.json", JSON.stringify(link, null, 2));
  } else if (isLegacy(project.projectType) && project.linkedNewProjectId) {
    const link: NotionIntegrationLinkFile = {
      version: NOTION_PORTABILITY_VERSION,
      newProjectExportId: notionExportId(project.linkedNewProjectId),
      legacyProjectExportId: projectExportId,
    };
    push("_theforge/integration-link.json", JSON.stringify(link, null, 2));
  }

  push("index.html", buildNotionIndexHtml(project.name, indexLinks));

  return entries;
}

export function notionExportZipFilename(projectName: string): string {
  const safe = notionSafeSegment(projectName, 60).replace(/\s+/g, "-");
  return `${safe}-notion.zip`;
}

export function sha256Hex(content: string | Buffer): string {
  return createHash("sha256").update(content).digest("hex");
}
