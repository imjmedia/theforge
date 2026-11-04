import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { ComplexityLevel, Prisma, StageStatus, Status } from "@theforge/database";
import type { Project } from "@theforge/database";
import {
  projectMergeBodySchema,
  ProjectTypeEnum,
  type MergeConflict,
  type MergeLineageEntry,
  type MergeSourceOptions,
  type ProjectMergeBody,
  type ProjectMergePreview,
  type ProjectMergeResult,
  type ProjectType,
  isMergeBlockedByDesignFirst,
  MERGE_DESIGN_FIRST_CONFLICT_MESSAGE,
} from "@theforge/shared-types";
import { getRequestUserId } from "../../common/request-user.store.js";
import { PrismaService } from "../../prisma/prisma.service.js";
import { AIFactory } from "../ai/ai.factory.js";
import { createDbgaLLM } from "../ai-analysis/llm/create-dbga-llm.js";
import { parsePhase0LlmJson } from "../ai-analysis/phase0/phase0-llm-json.util.js";
import { normalizePhase0Document } from "../ai-analysis/phase0/phase0-normalize.util.js";
import {
  hasBorradorContent,
  loadProjectBorrador,
} from "../ai-analysis/phase0/phase0-load-borrador.util.js";
import { phase0ToMarkdown } from "../ai-analysis/phase0/phase0-to-markdown.js";
import type { Phase0Document } from "../ai-analysis/phase0/phase0.types.js";
import type { Phase0StreamEvent } from "../ai-analysis/phase0/phase0.types.js";
import { PHASE0_MERGE_PROMPT } from "../ai-analysis/prompts/load-prompts.js";
import { Phase0InterviewService } from "../ai-analysis/phase0/phase0-interview.service.js";
import { ProjectGroupsService } from "../project-groups/project-groups.service.js";
import {
  detectMergeConflicts,
  mergeLlmConflicts,
  type MergeSourceSnapshot,
} from "./project-merge-conflicts.util.js";
import { toApiProject } from "./project-api.util.js";

function defaultSourceOptions(input?: MergeSourceOptions): Required<MergeSourceOptions> {
  return {
    includeDbga: input?.includeDbga ?? true,
    includePhase0Json: input?.includePhase0Json ?? true,
    includeBenchmark: input?.includeBenchmark ?? false,
  };
}

function isBenchmarkMarkdown(raw: string | null | undefined): boolean {
  const t = raw?.trim() ?? "";
  if (t.length < 200) return false;
  try {
    const parsed = JSON.parse(t) as Record<string, unknown>;
    return !(parsed?.proposito && typeof parsed.proposito === "object");
  } catch {
    return true;
  }
}

@Injectable()
export class ProjectMergeService {
  private readonly logger = new Logger(ProjectMergeService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly aiFactory: AIFactory,
    private readonly phase0Interview: Phase0InterviewService,
    private readonly projectGroups: ProjectGroupsService,
  ) {}

  async merge(body: unknown): Promise<ProjectMergeResult> {
    const parsed = projectMergeBodySchema.parse(body);
    const userId = getRequestUserId();
    const opts = defaultSourceOptions(parsed.sourceOptions);
    const sources = await this.loadSources(parsed.sourceProjectIds, userId, opts);

    await this.assertMergeNotDesignFirst(parsed, sources, userId);

    if (parsed.targetMode === "existing" && parsed.targetProjectId) {
      await this.assertOwner(parsed.targetProjectId, userId);
    }

    const preview = await this.buildPreview(parsed.name ?? sources[0]?.name ?? "Proyecto fusionado", sources, opts);

    if (parsed.preview) {
      return { preview };
    }

    const target = await this.persistMerge(parsed, userId, preview, sources);
    const sourcesDisposition = await this.applySourcesDisposition(
      parsed.deleteSources,
      sources,
      target.id,
      parsed.createSuite,
      userId,
      parsed.targetMode === "existing" ? parsed.targetProjectId : undefined,
    );

    let audit: ProjectMergeResult["audit"] = null;
    if (parsed.autoAudit) {
      try {
        const auditEvent = await this.phase0Interview.audit(target.id);
        audit = this.serializeAuditEvent(auditEvent);
      } catch (err) {
        this.logger.warn(`[merge] auto audit failed for ${target.id}: ${err}`);
      }
    }

    const suite =
      parsed.createSuite && parsed.deleteSources !== "delete"
        ? {
            parentId: target.id,
            childIds: sources
              .map((s) => s.projectId)
              .filter((id) => id !== (parsed.targetMode === "existing" ? parsed.targetProjectId : undefined)),
          }
        : undefined;

    const project = await this.prisma.project.findFirst({
      where: { id: target.id },
      include: { stages: { orderBy: { ordinal: "asc" }, include: { estimation: true } } },
    });

    return {
      project: project ? toApiProject(project) : undefined,
      preview,
      sourcesDisposition,
      suite,
      audit,
    };
  }

  private async assertMergeNotDesignFirst(
    parsed: ProjectMergeBody,
    sources: MergeSourceSnapshot[],
    userId: string,
  ): Promise<void> {
    const types: ProjectType[] = sources.map((s) => s.projectType);
    if (parsed.targetMode === "existing" && parsed.targetProjectId) {
      const targetInSources = sources.some((s) => s.projectId === parsed.targetProjectId);
      if (!targetInSources) {
        const target = await this.prisma.project.findFirst({
          where: { id: parsed.targetProjectId, userId, archivedAt: null },
          select: { projectType: true },
        });
        if (!target) {
          throw new NotFoundException("Proyecto destino no encontrado");
        }
        types.push(target.projectType as ProjectType);
      }
    }
    if (isMergeBlockedByDesignFirst(types)) {
      throw new ConflictException(MERGE_DESIGN_FIRST_CONFLICT_MESSAGE);
    }
  }

  private async loadSources(
    ids: string[],
    userId: string,
    opts: Required<MergeSourceOptions>,
  ): Promise<MergeSourceSnapshot[]> {
    const uniqueIds = [...new Set(ids)];
    const rows = await this.prisma.project.findMany({
      where: { id: { in: uniqueIds }, archivedAt: null },
      select: {
        id: true,
        name: true,
        userId: true,
        projectType: true,
        dbgaContent: true,
        phase0SummaryContent: true,
        visibility: true,
      },
    });

    if (rows.length !== uniqueIds.length) {
      throw new NotFoundException("Uno o más proyectos no existen o están archivados");
    }

    for (const row of rows) {
      if (row.userId !== userId) {
        throw new ForbiddenException("Solo puedes fusionar proyectos que te pertenecen");
      }
    }

    return rows.map((row) => {
      const borrador = loadProjectBorrador(
        opts.includeDbga ? row.dbgaContent : null,
        opts.includePhase0Json ? row.phase0SummaryContent : null,
      );
      return {
        projectId: row.id,
        name: row.name,
        projectType: row.projectType as ProjectType,
        borrador,
        dbgaMarkdown: opts.includeDbga ? (row.dbgaContent?.trim() ?? "") : "",
        benchmarkMarkdown:
          opts.includeBenchmark && isBenchmarkMarkdown(row.phase0SummaryContent)
            ? (row.phase0SummaryContent?.trim() ?? "")
            : "",
      };
    });
  }

  private async buildPreview(
    name: string,
    sources: MergeSourceSnapshot[],
    opts: Required<MergeSourceOptions>,
  ): Promise<ProjectMergePreview> {
    const deterministic = detectMergeConflicts(sources);
    const llmResult = await this.mergeWithLlm(sources, opts);
    const borrador = normalizePhase0Document(llmResult.borrador);
    if (!hasBorradorContent(borrador)) {
      throw new BadRequestException(
        "Las fuentes no tienen suficiente contenido en Paso 0 para fusionar",
      );
    }

    const conflicts = mergeLlmConflicts(deterministic, llmResult.conflicts);
    let markdown = phase0ToMarkdown(borrador);
    markdown += this.buildLineageMarkdown(sources);
    if (llmResult.benchmarkMerged?.trim()) {
      markdown += `\n\n## Benchmark fusionado\n\n${llmResult.benchmarkMerged.trim()}`;
    }

    return {
      name,
      borrador: borrador as unknown as Record<string, unknown>,
      markdown,
      benchmarkMerged: llmResult.benchmarkMerged ?? null,
      conflicts,
      sources: sources.map((s) => ({
        id: s.projectId,
        name: s.name,
        projectType: s.projectType,
      })),
    };
  }

  private async mergeWithLlm(
    sources: MergeSourceSnapshot[],
    opts: Required<MergeSourceOptions>,
  ): Promise<{
    borrador: Phase0Document;
    conflicts?: MergeConflict[];
    benchmarkMerged?: string;
  }> {
    const userId = getRequestUserId();
    const llm = await createDbgaLLM(this.aiFactory, userId, { temperature: 0.2 });
    const payload = {
      fuentes: sources.map((s) => ({
        proyecto: s.name,
        projectType: s.projectType,
        borrador: s.borrador,
        dbgaMarkdown: s.dbgaMarkdown?.slice(0, 12_000) ?? "",
        benchmarkMarkdown: s.benchmarkMarkdown?.slice(0, 12_000) ?? "",
      })),
      opciones: opts,
    };

    try {
      const response = await llm.invoke([
        { role: "system", content: PHASE0_MERGE_PROMPT },
        { role: "user", content: JSON.stringify(payload, null, 2) },
      ]);
      const content =
        typeof response.content === "string" ? response.content : JSON.stringify(response.content);
      const parsed = parsePhase0LlmJson(content);
      const conflicts = Array.isArray(parsed.conflicts)
        ? (parsed.conflicts as MergeConflict[])
        : undefined;
      return {
        borrador: normalizePhase0Document(parsed.borrador ?? {}),
        conflicts,
        benchmarkMerged:
          typeof parsed.benchmarkMerged === "string" ? parsed.benchmarkMerged : undefined,
      };
    } catch (err) {
      this.logger.warn(`[merge] LLM failed, using deterministic merge: ${err}`);
      return { borrador: this.heuristicMerge(sources) };
    }
  }

  private heuristicMerge(sources: MergeSourceSnapshot[]): Phase0Document {
    const base = normalizePhase0Document(sources[0]?.borrador ?? {});
    for (const source of sources.slice(1)) {
      const doc = normalizePhase0Document(source.borrador);
      if (doc.proposito.problema.trim()) {
        base.proposito.problema = [base.proposito.problema, doc.proposito.problema]
          .filter(Boolean)
          .join(" + ");
      }
      base.proposito.usuarios = [...new Set([...base.proposito.usuarios, ...doc.proposito.usuarios])];
      base.proposito.outOfScope = [...new Set([...base.proposito.outOfScope, ...doc.proposito.outOfScope])];
      base.entidades.push(...doc.entidades);
      base.reglasNegocio.push(...doc.reglasNegocio);
      base.flujos.push(...doc.flujos);
      base.roles.push(...doc.roles);
      base.integraciones.push(...doc.integraciones);
      base.edgeCases.push(...doc.edgeCases);
    }
    base.preguntasPendientes.push(
      "Revisar duplicados y conflictos tras fusión heurística (LLM no disponible).",
    );
    return normalizePhase0Document(base);
  }

  private buildLineageMarkdown(sources: MergeSourceSnapshot[]): string {
    const lines = sources.map((s) => `- **${s.name}** (\`${s.projectId}\`)`);
    return `\n\n## 9. Origen de la fusión\n\n${lines.join("\n")}\n`;
  }

  private async persistMerge(
    parsed: ProjectMergeBody,
    userId: string,
    preview: ProjectMergePreview,
    sources: MergeSourceSnapshot[],
  ): Promise<Project> {
    const lineage: MergeLineageEntry[] = sources.map((s) => ({
      projectId: s.projectId,
      name: s.name,
      mergedAt: new Date().toISOString(),
    }));

    const phase0Json = JSON.stringify(normalizePhase0Document(preview.borrador), null, 2);
    const reset = parsed.resetDownstream;

    if (parsed.targetMode === "new") {
      const defaultGroupId = await this.projectGroups.getDefaultGroupId();
      const created = await this.prisma.project.create({
        data: {
          userId,
          groupId: defaultGroupId,
          name: parsed.name!.trim(),
          projectType: ProjectTypeEnum.enum.NEW,
          visibility: "PRIVATE",
          complexity: ComplexityLevel.HIGH,
          dbgaContent: preview.markdown,
          phase0SummaryContent: phase0Json,
          phase0Status: "done",
          phase0Gaps: null,
          phase0Questions: 0,
          mergedFrom: lineage as unknown as Prisma.InputJsonValue,
          ...(reset ? this.clearedDeliverableFieldsForCreate() : {}),
          stages: {
            create: {
              ordinal: 1,
              key: "main",
              name: "Etapa principal",
              workflowStatus: StageStatus.ACTIVE,
              isLegacy: false,
              ...(reset ? { mddContent: null, status: Status.ROJO, precisionScore: 0 } : {}),
            },
          },
        },
      });
      return created;
    }

    const targetId = parsed.targetProjectId!;
    await this.assertOwner(targetId, userId);

    const existingLineage = await this.readExistingLineage(targetId);
    const mergedLineage = [...existingLineage, ...lineage];

    await this.prisma.project.update({
      where: { id: targetId },
      data: {
        dbgaContent: preview.markdown,
        phase0SummaryContent: phase0Json,
        phase0Status: "done",
        phase0Gaps: null,
        phase0Questions: 0,
        mergedFrom: mergedLineage as unknown as Prisma.InputJsonValue,
        ...(reset ? this.resetProjectFields() : {}),
      },
    });

    if (reset) {
      await this.prisma.stage.updateMany({
        where: { projectId: targetId },
        data: { mddContent: null, status: Status.ROJO, precisionScore: 0, brdContent: null },
      });
    }

    const updated = await this.prisma.project.findFirst({ where: { id: targetId } });
    if (!updated) throw new NotFoundException("Proyecto destino no encontrado");
    return updated;
  }

  private clearedDeliverableFieldsForCreate(): Pick<
    Prisma.ProjectCreateInput,
    | "specContent"
    | "architectureContent"
    | "useCasesContent"
    | "userStoriesContent"
    | "blueprintContent"
    | "tasksContent"
    | "apiContractsContent"
    | "logicFlowsContent"
    | "infraContent"
    | "agentGovernanceContent"
    | "uxUiGuideContent"
    | "aemContent"
    | "complexityPending"
  > {
    return {
      specContent: null,
      architectureContent: null,
      useCasesContent: null,
      userStoriesContent: null,
      blueprintContent: null,
      tasksContent: null,
      apiContractsContent: null,
      logicFlowsContent: null,
      infraContent: null,
      agentGovernanceContent: null,
      uxUiGuideContent: null,
      aemContent: null,
      complexityPending: Prisma.JsonNull,
    };
  }

  private resetProjectFields(): Prisma.ProjectUpdateInput {
    return {
      specContent: null,
      architectureContent: null,
      useCasesContent: null,
      userStoriesContent: null,
      blueprintContent: null,
      tasksContent: null,
      apiContractsContent: null,
      logicFlowsContent: null,
      infraContent: null,
      agentGovernanceContent: null,
      uxUiGuideContent: null,
      aemContent: null,
      complexityPending: Prisma.JsonNull,
    };
  }

  private async readExistingLineage(projectId: string): Promise<MergeLineageEntry[]> {
    const row = await this.prisma.project.findFirst({
      where: { id: projectId },
      select: { mergedFrom: true },
    });
    if (!row?.mergedFrom || !Array.isArray(row.mergedFrom)) return [];
    return row.mergedFrom as MergeLineageEntry[];
  }

  private async applySourcesDisposition(
    disposition: ProjectMergeBody["deleteSources"],
    sources: MergeSourceSnapshot[],
    parentId: string,
    createSuite: boolean,
    userId: string,
    skipProjectId?: string,
  ): Promise<ProjectMergeResult["sourcesDisposition"]> {
    const result: NonNullable<ProjectMergeResult["sourcesDisposition"]> = [];

    for (const source of sources) {
      if (skipProjectId && source.projectId === skipProjectId) {
        result.push({ id: source.projectId, name: source.name, action: "keep" });
        continue;
      }
      if (disposition === "keep") {
        if (createSuite) {
          await this.prisma.project.update({
            where: { id: source.projectId, userId },
            data: { parentProjectId: parentId },
          });
        }
        result.push({ id: source.projectId, name: source.name, action: "keep" });
        continue;
      }

      if (disposition === "archive") {
        await this.prisma.project.update({
          where: { id: source.projectId, userId },
          data: {
            archivedAt: new Date(),
            ...(createSuite ? { parentProjectId: parentId } : {}),
          },
        });
        result.push({ id: source.projectId, name: source.name, action: "archive" });
        continue;
      }

      await this.prisma.architecturalPreference.deleteMany({ where: { projectId: source.projectId } });
      await this.prisma.project.delete({ where: { id: source.projectId, userId } });
      result.push({ id: source.projectId, name: source.name, action: "delete" });
    }

    return result;
  }

  private async assertOwner(projectId: string, userId: string): Promise<void> {
    const row = await this.prisma.project.findFirst({
      where: { id: projectId, userId },
      select: { id: true },
    });
    if (!row) throw new ForbiddenException("No tienes permiso sobre el proyecto destino");
  }

  private serializeAuditEvent(event: Phase0StreamEvent): ProjectMergeResult["audit"] {
    if (event.type === "audit_started") {
      return {
        type: event.type,
        threadId: event.threadId,
        question: event.question,
        n: event.n,
        total: event.total,
      };
    }
    if (event.type === "audit_complete") {
      return { type: event.type, message: event.message };
    }
    if (event.type === "error") {
      return { type: event.type, message: event.message };
    }
    return { type: event.type };
  }
}
