import { BadRequestException, forwardRef, Inject, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../../../prisma/prisma.service.js";
import { canAccessProject } from "../../../common/access/project-access.policy.js";
import { getRequestUserId, getRequestUserRole } from "../../../common/request-user.store.js";
import { AIFactory } from "../../ai/ai.factory.js";
import { TheForgeService } from "../../theforge/theforge.service.js";
import { runIntegrationAgent } from "../../ai-analysis/nodes/integration-agent.node.js";
import { pickPrimaryStage } from "../stage-helpers.js";
import { ProjectIntegrationService } from "./project-integration.service.js";

/**
 * IntegrationAgent orchestrator: turns the registered NEW-LEG handoff items of a stage into a
 * dynamic `handoff-spec.md` (Brownfield technical breakdown).
 *
 * Governance: it only structures/deepens items already in the Matriz de Trazabilidad; it never
 * creates handoff items. The redactor lives in `ai-analysis/nodes/integration-agent.node.ts`.
 */
@Injectable()
export class IntegrationAgentService {
  private readonly logger = new Logger(IntegrationAgentService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly aiFactory: AIFactory,
    private readonly theforge: TheForgeService,
    @Inject(forwardRef(() => ProjectIntegrationService))
    private readonly integration: ProjectIntegrationService,
  ) {}

  /**
   * Regenerates the handoff-spec for a project stage. When `stageId` is omitted, the primary
   * (ACTIVE / lowest ordinal) stage is used. Returns the persisted markdown.
   */
  async syncHandoffSpec(
    projectId: string,
    stageId?: string | null,
  ): Promise<{ stageId: string; itemsCount: number; itemsWithoutEvidence: string[] }> {
    const userId = getRequestUserId();
    const actor = { userId, role: getRequestUserRole() };
    const project = await this.prisma.project.findFirst({
      where: { id: projectId },
      include: {
        stages: { orderBy: { ordinal: "asc" } },
        linkedLegacyProject: { select: { id: true, name: true, theforgeProjectId: true } },
      },
    });
    if (!project || !canAccessProject(actor, project, "read")) {
      throw new NotFoundException("Project not found");
    }

    const stage = stageId
      ? project.stages.find((s) => s.id === stageId)
      : pickPrimaryStage(project.stages);
    if (!stage) throw new BadRequestException("El proyecto no tiene una etapa para sincronizar");

    // Items: closed scope from the Matriz de Trazabilidad (snapshot for legacy stage 2+, project handoff for NEW).
    const { handoffItems, newProjectMeta } = await this.integration.resolvePromptContext(projectId, stage.id);

    const isLegacy = project.projectType === "LEGACY";
    const legacyProjectName = isLegacy ? project.name : project.linkedLegacyProject?.name ?? "Sistema LEGACY";
    const newProjectName = isLegacy ? newProjectMeta?.name ?? null : project.name;
    // Evidence must come from the LEGACY codebase graph.
    const theforgeProjectId = isLegacy
      ? stage.theforgeProjectId ?? project.theforgeProjectId
      : project.linkedLegacyProject?.theforgeProjectId ?? null;

    const mdd = stage.mddContent ?? "";
    const mddSection3 = extractMddSection(mdd, 3);
    const mddSection4 = extractMddSection(mdd, 4);

    // Endpoints the NEW team proposes live in the NEW project's docs, not the legacy graph.
    const newApiContext = await this.gatherNewApiContext(isLegacy, project, stage);

    const llm = await this.aiFactory.createForUser(userId);
    const result = await runIntegrationAgent({
      llm,
      theforge: this.theforge,
      theforgeProjectId,
      items: handoffItems,
      legacyProjectName,
      newProjectName,
      mddSection3,
      mddSection4,
      newApiContext,
    });

    this.logger.log(
      `[IntegrationAgent] handoff-spec sincronizado (project=${projectId.slice(0, 8)} stage=${stage.id.slice(0, 8)} items=${handoffItems.length} sinEvidencia=${result.itemsWithoutEvidence.length})`,
    );

    return {
      stageId: stage.id,
      itemsCount: handoffItems.length,
      itemsWithoutEvidence: result.itemsWithoutEvidence,
    };
  }

  /**
   * Gathers the NEW project's API contracts (deliverable) + MDD §4 so the redactor can cite the
   * exact endpoint each handoff item proposes to consume, instead of writing a generic phrase.
   * - LEGACY sync: reads the linked NEW project (stage → project deliverable fallback).
   * - NEW sync: reads the project being synced itself.
   * Returns undefined when no NEW API document is available.
   */
  private async gatherNewApiContext(
    isLegacy: boolean,
    project: { linkedNewProjectId: string | null; apiContractsContent: string | null },
    stage: { linkedNewProjectId: string | null; apiContractsContent: string | null; mddContent: string | null },
  ): Promise<string | undefined> {
    let apiContracts = "";
    let newMdd = "";

    if (isLegacy) {
      const newProjectId = stage.linkedNewProjectId ?? project.linkedNewProjectId;
      if (!newProjectId) return undefined;
      const np = await this.prisma.project.findUnique({
        where: { id: newProjectId },
        select: {
          apiContractsContent: true,
          stages: {
            orderBy: { ordinal: "asc" },
            select: { ordinal: true, workflowStatus: true, apiContractsContent: true, mddContent: true },
          },
        },
      });
      if (!np) return undefined;
      const npStage = pickPrimaryStage(np.stages);
      apiContracts = (npStage?.apiContractsContent ?? np.apiContractsContent ?? "").trim();
      newMdd = npStage?.mddContent ?? "";
    } else {
      apiContracts = (stage.apiContractsContent ?? project.apiContractsContent ?? "").trim();
      newMdd = stage.mddContent ?? "";
    }

    const newMddSection4 = extractMddSection(newMdd, 4);
    const blocks: string[] = [];
    if (apiContracts) blocks.push(`### Contratos de API (proyecto NEW)\n${apiContracts.slice(0, MAX_NEW_API_CONTRACTS_CHARS)}`);
    if (newMddSection4?.trim()) {
      blocks.push(`### MDD §4 — API (proyecto NEW)\n${newMddSection4.trim().slice(0, MAX_NEW_API_MDD_CHARS)}`);
    }
    return blocks.length ? blocks.join("\n\n") : undefined;
  }
}

const MAX_NEW_API_CONTRACTS_CHARS = 9000;
const MAX_NEW_API_MDD_CHARS = 4000;

/**
 * Extracts a numbered MDD section (e.g. "## 3. Modelo de Datos") up to the next numbered heading.
 * Returns undefined when not found so the redactor can rely on the full traceability matrix instead.
 */
export function extractMddSection(mdd: string, sectionNumber: number): string | undefined {
  if (!mdd?.trim()) return undefined;
  const lines = mdd.split(/\r?\n/);
  const headingRe = /^#{1,4}\s*(\d+)[.)]/;
  let start = -1;
  for (let i = 0; i < lines.length; i += 1) {
    const m = lines[i].match(headingRe);
    if (m && Number(m[1]) === sectionNumber) {
      start = i;
      break;
    }
  }
  if (start === -1) return undefined;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i += 1) {
    const m = lines[i].match(headingRe);
    if (m && Number(m[1]) !== sectionNumber) {
      end = i;
      break;
    }
  }
  const block = lines.slice(start, end).join("\n").trim();
  return block.length ? block : undefined;
}
