import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import {
  Prisma,
  StageStatus,
  type Status,
} from "@theforge/database";
import JSZip from "jszip";
import {
  notionExportOptionsSchema,
  notionImportBodySchema,
  notionImportPairBodySchema,
  type NotionImportBody,
} from "@theforge/shared-types";
import { canAccessProject } from "../../common/access/project-access.policy.js";
import { getRequestUserId, getRequestUserRole } from "../../common/request-user.store.js";
import { PrismaService } from "../../prisma/prisma.service.js";
import { ProjectGroupsService } from "../project-groups/project-groups.service.js";
import {
  buildNotionExportEntries,
  notionExportZipFilename,
  type ProjectNotionExportSource,
} from "./project-notion-export.util.js";
import {
  emptyHandoffIfNeeded,
  mapHandoffItemsWithStageIds,
  parseNotionImportZip,
  resolveImportedProjectName,
  resolveImportedUiScreensContent,
  type ParsedNotionImportBundle,
} from "./project-notion-import.util.js";
import { toApiProject } from "./project-api.util.js";

function jsonValue(value: unknown): Prisma.InputJsonValue | typeof Prisma.JsonNull | undefined {
  if (value === null || value === undefined) return undefined;
  return value as Prisma.InputJsonValue;
}

@Injectable()
export class ProjectNotionPortabilityService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly projectGroups: ProjectGroupsService,
  ) {}

  private async assertProjectAccess(projectId: string): Promise<ProjectNotionExportSource> {
    const actor = { userId: getRequestUserId(), role: getRequestUserRole() };
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      include: {
        stages: { orderBy: { ordinal: "asc" }, include: { estimation: true } },
        integrationTracesAsNew: true,
        integrationTracesAsLegacy: true,
      },
    });
    if (!project) throw new NotFoundException("Proyecto no encontrado");
    if (!canAccessProject(actor, project, "read")) {
      throw new ForbiddenException("Sin acceso al proyecto");
    }
    return project;
  }

  async exportZip(projectId: string, query: Record<string, unknown>): Promise<{ buffer: Buffer; filename: string }> {
    const options = notionExportOptionsSchema.parse({
      includeIntegration: query.includeIntegration !== "false",
      includeSessions: query.includeSessions === "true",
    });
    const project = await this.assertProjectAccess(projectId);
    const entries = buildNotionExportEntries(project, options);
    const zip = new JSZip();
    for (const entry of entries) {
      zip.file(entry.path, entry.content);
    }
    const buffer = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
    return { buffer, filename: notionExportZipFilename(project.name) };
  }

  async importZip(
    file: Express.Multer.File | undefined,
    body: unknown,
  ): Promise<{ project: ReturnType<typeof toApiProject>; warnings: string[] }> {
    if (!file?.buffer?.length) throw new BadRequestException("Archivo ZIP requerido");
    const parsedBody = notionImportBodySchema.parse(body ?? {});
    const zip = await JSZip.loadAsync(file.buffer);
    const bundle = await parseNotionImportZip(zip);
    const created = await this.persistImportBundle(bundle, parsedBody);
    return created;
  }

  async importPairZip(
    files: { newProject?: Express.Multer.File[]; legacyProject?: Express.Multer.File[]; bundle?: Express.Multer.File[] },
    body: unknown,
  ): Promise<{
    newProject: ReturnType<typeof toApiProject>;
    legacyProject: ReturnType<typeof toApiProject>;
    warnings: string[];
  }> {
    const parsedBody = notionImportPairBodySchema.parse(body ?? {});

    let newBuffer: Buffer | null = null;
    let legacyBuffer: Buffer | null = null;

    if (files.bundle?.[0]?.buffer) {
      const bundleZip = await JSZip.loadAsync(files.bundle[0].buffer);
      const bundlePaths = Object.keys(bundleZip.files).filter((p) => !bundleZip.files[p]?.dir);
      const newPath = bundlePaths.find((p) => p.includes("/new/") || p.startsWith("new/"));
      const legacyPath = bundlePaths.find((p) => p.includes("/legacy/") || p.startsWith("legacy/"));
      if (newPath?.endsWith(".zip")) {
        newBuffer = await bundleZip.file(newPath)!.async("nodebuffer");
      }
      if (legacyPath?.endsWith(".zip")) {
        legacyBuffer = await bundleZip.file(legacyPath)!.async("nodebuffer");
      }
      if (!newBuffer || !legacyBuffer) {
        const nested = bundlePaths.filter((p) => p.endsWith("_theforge/manifest.json"));
        if (nested.length >= 2) {
          // two full exports inside one zip at different roots
          const roots = [...new Set(nested.map((p) => p.replace(/_theforge\/manifest\.json$/, "")))];
          if (roots.length >= 2) {
            const subZip = new JSZip();
            for (const path of bundlePaths) {
              if (path.startsWith(roots[0]!)) subZip.file(path.slice(roots[0]!.length), await bundleZip.file(path)!.async("uint8array"));
            }
            newBuffer = await subZip.generateAsync({ type: "nodebuffer" });
          }
        }
      }
    }

    if (!newBuffer && files.newProject?.[0]?.buffer) newBuffer = files.newProject[0].buffer;
    if (!legacyBuffer && files.legacyProject?.[0]?.buffer) legacyBuffer = files.legacyProject[0].buffer;

    if (!newBuffer?.length || !legacyBuffer?.length) {
      throw new BadRequestException("Sube newProject + legacyProject, o un bundle.zip con ambos exports");
    }

    const newZip = await JSZip.loadAsync(newBuffer);
    const legacyZip = await JSZip.loadAsync(legacyBuffer);
    const newBundle = await parseNotionImportZip(newZip);
    const legacyBundle = await parseNotionImportZip(legacyZip);

    if (newBundle.manifest.projectType !== "NEW") {
      throw new BadRequestException("El ZIP newProject debe ser projectType NEW");
    }
    if (legacyBundle.manifest.projectType !== "LEGACY") {
      throw new BadRequestException("El ZIP legacyProject debe ser projectType LEGACY");
    }

    const baseBody: NotionImportBody = {
      groupId: parsedBody.groupId,
      visibility: parsedBody.visibility,
    };

    const newCreated = await this.persistImportBundle(newBundle, {
      ...baseBody,
      name: parsedBody.newProjectName ?? newBundle.manifest.projectName,
    });
    const legacyCreated = await this.persistImportBundle(legacyBundle, {
      ...baseBody,
      name: parsedBody.legacyProjectName ?? legacyBundle.manifest.projectName,
    });

    await this.wireIntegrationPair(
      String(newCreated.project.id),
      String(legacyCreated.project.id),
      newBundle,
      legacyBundle,
    );

    return {
      newProject: newCreated.project,
      legacyProject: legacyCreated.project,
      warnings: [...newCreated.warnings, ...legacyCreated.warnings],
    };
  }

  private async wireIntegrationPair(
    newProjectId: string,
    legacyProjectId: string,
    newBundle: ParsedNotionImportBundle,
    legacyBundle: ParsedNotionImportBundle,
  ): Promise<void> {
    await this.prisma.project.update({
      where: { id: newProjectId },
      data: { linkedLegacyProjectId: legacyProjectId },
    });
    await this.prisma.project.update({
      where: { id: legacyProjectId },
      data: { linkedNewProjectId: newProjectId },
    });

    const stageExportToId = new Map<string, string>();
    const legacyStages = await this.prisma.stage.findMany({
      where: { projectId: legacyProjectId },
      select: { id: true, ordinal: true },
    });
    for (const stage of legacyBundle.stages) {
      const match = legacyStages.find((row) => row.ordinal === stage.ordinal);
      if (match) stageExportToId.set(stage.exportId, match.id);
    }

    for (const trace of newBundle.traces) {
      const status = trace.status as "DRAFT" | "SENT" | "ACCEPTED" | "IMPLEMENTED" | "REJECTED";
      await this.prisma.integrationTrace.upsert({
        where: {
          newProjectId_legacyProjectId_newLegId: {
            newProjectId,
            legacyProjectId,
            newLegId: trace.newLegId,
          },
        },
        create: {
          newProjectId,
          legacyProjectId,
          newLegId: trace.newLegId,
          legacyStoryId: trace.legacyStoryId,
          legacyStageId: trace.legacyStageExportId ? stageExportToId.get(trace.legacyStageExportId) ?? null : null,
          screenOrEndpoint: trace.screenOrEndpoint,
          status,
        },
        update: {
          legacyStoryId: trace.legacyStoryId,
          legacyStageId: trace.legacyStageExportId ? stageExportToId.get(trace.legacyStageExportId) ?? null : null,
          screenOrEndpoint: trace.screenOrEndpoint,
          status,
        },
      });
    }
  }

  private async persistImportBundle(
    bundle: ParsedNotionImportBundle,
    body: NotionImportBody,
  ): Promise<{ project: ReturnType<typeof toApiProject>; warnings: string[] }> {
    const userId = getRequestUserId();
    const defaultGroupId = await this.projectGroups.getDefaultGroupId();
    let groupId = defaultGroupId;
    if (body.groupId) {
      const targetGroup = await this.prisma.projectGroup.findUnique({
        where: { id: body.groupId },
        select: { id: true },
      });
      if (!targetGroup) throw new NotFoundException("Grupo no encontrado");
      groupId = body.groupId;
    }

    const warnings = [...bundle.warnings];
    const name = resolveImportedProjectName(bundle.manifest, body);
    const stagesInput =
      bundle.stages.length > 0
        ? bundle.stages
        : [
            {
              exportId: bundle.manifest.projectExportId,
              ordinal: 1,
              key: "main",
              name: "Etapa principal",
              workflowStatus: "ACTIVE",
              status: "ROJO",
              precisionScore: 0,
              isLegacy: bundle.manifest.projectType === "LEGACY",
              linkedNewProjectExportId: null,
              handoffImportedAt: null,
              docs: {},
              assets: {},
            },
          ];

    const stageExportToId = new Map<string, string>();
    // Project-only column (not on Stage); ZIP may still ship Pantallas under stage folders.
    const uiScreensContent = resolveImportedUiScreensContent(stagesInput);

    const created = await this.prisma.$transaction(async (tx) => {
      const project = await tx.project.create({
        data: {
          userId,
          groupId,
          name,
          visibility: body.visibility ?? "PRIVATE",
          projectType: bundle.manifest.projectType,
          complexity: "HIGH",
          hasUxTeam: false,
          dbgaContent: bundle.projectDocs.dbgaContent ?? null,
          phase0SummaryContent: bundle.projectDocs.phase0SummaryContent ?? null,
          uiScreensContent,
          integrationHandoff: jsonValue(emptyHandoffIfNeeded([])),
          stages: {
            create: stagesInput.map((stage, index) => {
              const workflowStatus =
                (stage.workflowStatus as StageStatus) ||
                (index === stagesInput.length - 1 ? StageStatus.ACTIVE : StageStatus.DRAFT);
              const estimationAsset = stage.assets["estimation.json"];
              const estimationCreate =
                estimationAsset &&
                typeof estimationAsset === "object" &&
                estimationAsset !== null &&
                "totalHours" in estimationAsset &&
                "totalMxn" in estimationAsset
                  ? {
                      create: {
                        totalHours: Number((estimationAsset as { totalHours: unknown }).totalHours) || 0,
                        totalMxn: Number((estimationAsset as { totalMxn: unknown }).totalMxn) || 0,
                        teamStructure: jsonValue(
                          (estimationAsset as { teamStructure?: unknown }).teamStructure,
                        ) as Prisma.InputJsonValue,
                      },
                    }
                  : undefined;
              return {
                ordinal: stage.ordinal || index + 1,
                key: stage.key ?? (stage.ordinal === 1 ? "main" : null),
                name: stage.name,
                workflowStatus,
                status: (stage.status as Status) ?? "ROJO",
                precisionScore: stage.precisionScore ?? 0,
                isLegacy: stage.isLegacy,
                handoffImportedAt: stage.handoffImportedAt ? new Date(stage.handoffImportedAt) : null,
                handoffSnapshot: jsonValue(stage.assets["handoff-snapshot.json"]),
                domainInventory: jsonValue(stage.assets["domain-inventory.json"]),
                tasksJson: jsonValue(stage.assets["tasks-json.json"]),
                legacyChangeState: jsonValue(stage.assets["legacy-change-state.json"]),
                deliverableSnapshot: jsonValue(stage.assets["deliverable-snapshot.json"]),
                shortTermContext: jsonValue(stage.assets["short-term-context.json"]),
                mddUpstreamBaseline: jsonValue(stage.assets["mdd-upstream-baseline.json"]),
                mddContent: stage.docs.mddContent ?? null,
                brdContent: stage.docs.brdContent ?? null,
                specContent: stage.docs.specContent ?? null,
                architectureContent: stage.docs.architectureContent ?? null,
                useCasesContent: stage.docs.useCasesContent ?? null,
                userStoriesContent: stage.docs.userStoriesContent ?? null,
                blueprintContent: stage.docs.blueprintContent ?? null,
                tasksContent: stage.docs.tasksContent ?? null,
                apiContractsContent: stage.docs.apiContractsContent ?? null,
                logicFlowsContent: stage.docs.logicFlowsContent ?? null,
                infraContent: stage.docs.infraContent ?? null,
                agentGovernanceContent: stage.docs.agentGovernanceContent ?? null,
                uxUiGuideContent: stage.docs.uxUiGuideContent ?? null,
                phase0SummaryContent: stage.docs.phase0SummaryContent ?? null,
                aemContent: stage.docs.aemContent ?? null,
                changeSpecContent: stage.docs.changeSpecContent ?? null,
                estimation: estimationCreate,
              };
            }),
          },
        },
        include: {
          stages: { orderBy: { ordinal: "asc" }, include: { estimation: true } },
          group: { select: { name: true } },
        },
      });

      for (const stage of project.stages) {
        const exportStage = stagesInput.find((candidate) => candidate.ordinal === stage.ordinal);
        if (exportStage) stageExportToId.set(exportStage.exportId, stage.id);
      }

      const handoffItems = mapHandoffItemsWithStageIds(bundle.handoffItems, stageExportToId);
      if (handoffItems.length > 0) {
        await tx.project.update({
          where: { id: project.id },
          data: {
            integrationHandoff: jsonValue({ items: handoffItems }),
            integrationHandoffUpdatedAt: new Date(),
          },
        });
      }

      if (bundle.traces.length > 0 && !body.relinkPartnerExportId) {
        warnings.push(
          "Trazas de integración importadas sin vínculo NEW↔LEGACY; usa import/notion/pair para restaurar la matriz",
        );
      }

      return project;
    });

    if (body.relinkPartnerExportId) {
      warnings.push(
        "relinkPartnerExportId pendiente de proyecto pareja en la misma instancia; usa POST /projects/import/notion/pair",
      );
    }

    const refreshed = await this.prisma.project.findUnique({
      where: { id: created.id },
      include: {
        stages: { orderBy: { ordinal: "asc" }, include: { estimation: true } },
        group: { select: { name: true } },
      },
    });
    if (!refreshed) throw new NotFoundException("Proyecto importado no encontrado");

    return { project: toApiProject(refreshed), warnings };
  }
}
