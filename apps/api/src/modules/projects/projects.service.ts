import { Inject, Injectable, NotFoundException, forwardRef } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service.js";
import { getRequestUserId, getRequestUserRole } from "../../common/request-user.store.js";
import { isAdminOrAbove } from "../../common/roles.js";
import type { IOrchestratorProjectsPort } from "./projects-service.port.js";
import {
  type DeliverableKind,
  type CreateProjectDto,
  type UpdateProjectDto,
  type TasksPipelineProgress,
} from "@theforge/shared-types";

import { loadAccessibleProjectWithStages } from "./project-access.util.js";
import { ProjectMddPersistService } from "./project-mdd-persist.service.js";
import { DeliverablesCascadeService } from "./deliverables-cascade.service.js";
import { ProjectStageService } from "./project-stage.service.js";
import { ProjectUxGuideService } from "./project-ux-guide.service.js";
import { ProjectDeliverableGeneratorsService } from "./project-deliverable-generators.service.js";
import { ProjectDeliverableGateService } from "./project-deliverable-gate.service.js";
import { ProjectConformanceService } from "./project-conformance.service.js";
import { ProjectBrdService } from "./project-brd.service.js";
import { ProjectUpdateService } from "./project-update.service.js";
import { ProjectComplexityService } from "./project-complexity.service.js";
import { ProjectPhase0Service } from "./project-phase0.service.js";
import { ProjectSddReconcileService } from "./project-sdd-reconcile.service.js";
import { ProjectLifecycleService } from "./project-lifecycle.service.js";
import { toApiProject } from "./project-api.util.js";
import { toApiProjectListItem } from "./project-list-item.util.js";

@Injectable()
export class ProjectsService implements IOrchestratorProjectsPort {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mddPersist: ProjectMddPersistService,
    @Inject(forwardRef(() => DeliverablesCascadeService))
    private readonly deliverablesCascade: DeliverablesCascadeService,
    private readonly projectStage: ProjectStageService,
    @Inject(forwardRef(() => ProjectUxGuideService))
    private readonly uxGuide: ProjectUxGuideService,
    @Inject(forwardRef(() => ProjectDeliverableGeneratorsService))
    private readonly deliverableGenerators: ProjectDeliverableGeneratorsService,
    private readonly deliverableGate: ProjectDeliverableGateService,
    private readonly projectConformance: ProjectConformanceService,
    private readonly projectBrd: ProjectBrdService,
    @Inject(forwardRef(() => ProjectUpdateService))
    private readonly projectUpdate: ProjectUpdateService,
    @Inject(forwardRef(() => ProjectComplexityService))
    private readonly projectComplexity: ProjectComplexityService,
    @Inject(forwardRef(() => ProjectPhase0Service))
    private readonly projectPhase0: ProjectPhase0Service,
    private readonly projectSddReconcile: ProjectSddReconcileService,
    private readonly projectLifecycle: ProjectLifecycleService,
  ) {}

  async listDocumentSnapshots(
    projectId: string,
    options?: { field?: string; limit?: number },
  ) {
    return this.projectUpdate.listDocumentSnapshots(projectId, options);
  }

  async restoreDocumentSnapshot(projectId: string, snapshotId: string) {
    return this.projectUpdate.restoreDocumentSnapshot(projectId, snapshotId);
  }

  async create(data: CreateProjectDto) {
    return this.projectLifecycle.create(data);
  }

  async cloneProject(sourceId: string, body: unknown) {
    return this.projectLifecycle.cloneProject(sourceId, body);
  }

  async findAll() {
    const userId = getRequestUserId();
    const rows = await this.prisma.project.findMany({
      where: {
        archivedAt: null,
        OR: [{ userId }, { visibility: "SHARED" }],
      },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        userId: true,
        name: true,
        visibility: true,
        complexity: true,
        complexityPending: true,
        projectType: true,
        theforgeProjectId: true,
        hasUxTeam: true,
        linkedLegacyProjectId: true,
        linkedNewProjectId: true,
        groupId: true,
        group: { select: { name: true } },
        createdAt: true,
        stages: {
          orderBy: { ordinal: "asc" },
          select: {
            id: true,
            ordinal: true,
            key: true,
            name: true,
            workflowStatus: true,
            status: true,
            precisionScore: true,
            isLegacy: true,
            estimation: true,
          },
        },
      },
    });
    const favoriteProjectIds = await this.getUserFavoriteIds(userId);
    return rows.map((p) =>
      toApiProjectListItem(p as Parameters<typeof toApiProjectListItem>[0], favoriteProjectIds.has(p.id)),
    );
  }

  async getUserFavoriteIds(userId?: string): Promise<Set<string>> {
    const uid = userId ?? getRequestUserId();
    const favs = await this.prisma.favoriteProject.findMany({
      where: { userId: uid },
      select: { projectId: true },
    });
    return new Set(favs.map((f) => f.projectId));
  }

  async toggleFavorite(projectId: string) {
    const userId = getRequestUserId();
    await loadAccessibleProjectWithStages(this.prisma, projectId);
    const existing = await this.prisma.favoriteProject.findUnique({
      where: { userId_projectId: { userId, projectId } },
    });
    if (existing) {
      await this.prisma.favoriteProject.delete({ where: { id: existing.id } });
      return { favorited: false };
    }
    await this.prisma.favoriteProject.create({
      data: { userId, projectId },
    });
    return { favorited: true };
  }

  async findOne(id: string) {
    const project = await loadAccessibleProjectWithStages(this.prisma, id);
    const withSessions = await this.prisma.project.findFirst({
      where: { id },
      include: { sessions: true },
    });
    const userId = getRequestUserId();
    const fav = await this.prisma.favoriteProject.findUnique({
      where: { userId_projectId: { userId, projectId: id } },
    });
    return {
      ...toApiProject({
        ...project,
        sessions: withSessions?.sessions ?? [],
      }),
      isFavorite: fav !== null,
    };
  }

  async update(id: string, data: UpdateProjectDto) {
    return this.projectUpdate.update(id, data);
  }

  async clearMddDependentDeliverables(
    projectId: string,
    options?: { stageId?: string },
  ) {
    return this.projectUpdate.clearMddDependentDeliverables(projectId, options);
  }

  async remove(id: string) {
    const project = await loadAccessibleProjectWithStages(this.prisma, id);
    const userId = getRequestUserId();
    const isOwner = project.userId === userId;
    if (!isOwner && !isAdminOrAbove(getRequestUserRole())) {
      throw new NotFoundException("Project not found");
    }
    await this.prisma.architecturalPreference.deleteMany({ where: { projectId: id } });
    try {
      await this.prisma.project.delete({ where: { id } });
    } catch {
      throw new NotFoundException("Project not found");
    }
    return { deleted: id };
  }

  async activateStageExclusive(projectId: string, stageId: string): Promise<void> {
    return this.projectStage.activateStageExclusive(projectId, stageId);
  }

  async createStage(projectId: string, body: unknown) {
    return this.projectStage.createStage(projectId, body);
  }

  async listStages(projectId: string) {
    return this.projectStage.listStages(projectId);
  }

  async getStageDeliverables(projectId: string, stageId: string) {
    return this.projectStage.getStageDeliverables(projectId, stageId);
  }

  async patchStage(projectId: string, stageId: string, body: unknown) {
    return this.projectStage.patchStage(projectId, stageId, body);
  }

  async getStageDetail(projectId: string, stageId: string) {
    return this.projectStage.getStageDetail(projectId, stageId);
  }

  async transitionStage(projectId: string, stageId: string, body: unknown) {
    return this.projectStage.transitionStage(projectId, stageId, body);
  }

  async generateBenchmark(projectId: string, userIdea: string, urls?: string[]) {
    return this.projectComplexity.generateBenchmark(projectId, userIdea, urls);
  }

  async reassessComplexity(projectId: string, options?: { note?: string }) {
    return this.projectComplexity.reassessComplexity(projectId, options);
  }

  async confirmComplexityProposal(projectId: string) {
    return this.projectComplexity.confirmComplexityProposal(projectId);
  }

  tryConfirmComplexityFromChatMessage(projectId: string, message: string): Promise<{
    confirmed: boolean;
    rejected: boolean;
  }> {
    return this.projectComplexity.tryConfirmComplexityFromChatMessage(projectId, message);
  }

  async generateUxUiGuide(projectId: string, signal?: AbortSignal) {
    return this.uxGuide.generateUxUiGuide(projectId, signal);
  }

  async composeUxGuideFromDesignRef(projectId: string) {
    return this.uxGuide.composeUxGuideFromDesignRef(projectId);
  }

  async repairUxUiGuideYaml(projectId: string): Promise<string> {
    return this.uxGuide.repairUxUiGuideYaml(projectId);
  }

  async refreshStageSemaphoreFromProject(projectId: string): Promise<void> {
    return this.deliverableGate.refreshStageSemaphoreFromProject(projectId);
  }

  async assertDeliverablesAllowed(
    projectId: string,
    options?: { acknowledgeGaps?: boolean },
  ): Promise<void> {
    return this.deliverableGate.assertDeliverablesAllowed(projectId, options);
  }

  async assertMddDeliveryGateForDeliverables(projectId: string): Promise<void> {
    return this.deliverableGate.assertMddDeliveryGateForDeliverables(projectId);
  }

  async auditDocuments(projectId: string, options?: { useLlm?: boolean }) {
    return this.projectConformance.auditDocuments(projectId, options);
  }

  async getConformance(projectId: string, options?: { useLlm?: boolean }) {
    return this.projectConformance.getConformance(projectId, options);
  }

  async verifyDeliverable(
    projectId: string,
    deliverable: "blueprint" | "api" | "infra" | "logicFlows",
  ): Promise<string> {
    return this.projectConformance.verifyDeliverable(projectId, deliverable);
  }

  async suggestBrdFromDbga(
    projectId: string,
    opts?: { stageId?: string | null },
  ): Promise<{ brdContent: string; stageId: string }> {
    return this.projectBrd.suggestBrdFromDbga(projectId, opts);
  }

  async generateDocument(
    kind: DeliverableKind,
    projectId: string,
    options?: { gapsFeedback?: string | null; acknowledgeGaps?: boolean; signal?: AbortSignal },
  ): Promise<void> {
    return this.deliverableGenerators.generateDocument(kind, projectId, options);
  }

  async generateAem(projectId: string, body: unknown) {
    return this.deliverableGenerators.generateAem(projectId, body);
  }

  async generateSpec(projectId: string, signal?: AbortSignal) {
    return this.deliverableGenerators.generateSpec(projectId, signal);
  }

  async clearAgentGovernanceContent(projectId: string) {
    return this.deliverableGenerators.clearAgentGovernanceContent(projectId);
  }

  async generateAgentGovernance(
    projectId: string,
    target?: string,
    options?: { forceRegenerate?: boolean; skipSddAutoReconcile?: boolean },
    signal?: AbortSignal,
  ) {
    return this.deliverableGenerators.generateAgentGovernance(projectId, target, options, signal);
  }

  async generateAgentGovernancePreview(
    projectId: string,
    target?: string,
    options?: { forceRegenerate?: boolean },
  ): Promise<{ content: string }> {
    return this.deliverableGenerators.generateAgentGovernancePreview(projectId, target, options);
  }

  async getAgentGovernanceForExport(projectId: string) {
    return this.deliverableGenerators.getAgentGovernanceForExport(projectId);
  }

  async generateTasks(
    projectId: string,
    gapsFeedback?: string | null,
    options?: {
      acknowledgeGaps?: boolean;
      onProgress?: (progress: TasksPipelineProgress) => void;
      signal?: AbortSignal;
    },
  ) {
    return this.deliverableGenerators.generateTasks(projectId, gapsFeedback, options);
  }

  async generateArchitecturePreview(projectId: string): Promise<{ content: string }> {
    return this.deliverableGenerators.generateArchitecturePreview(projectId);
  }

  async generateArchitecture(projectId: string, gapsFeedback?: string | null, signal?: AbortSignal) {
    return this.deliverableGenerators.generateArchitecture(projectId, gapsFeedback, signal);
  }

  async generateUseCasesPreview(projectId: string): Promise<{ content: string }> {
    return this.deliverableGenerators.generateUseCasesPreview(projectId);
  }

  async generateUseCases(projectId: string, signal?: AbortSignal) {
    return this.deliverableGenerators.generateUseCases(projectId, signal);
  }

  async generateUserStoriesPreview(projectId: string): Promise<{ content: string }> {
    return this.deliverableGenerators.generateUserStoriesPreview(projectId);
  }

  async generateUserStories(projectId: string, signal?: AbortSignal) {
    return this.deliverableGenerators.generateUserStories(projectId, signal);
  }

  async generateBlueprintPreview(projectId: string, gapsFeedback?: string | null): Promise<{ content: string }> {
    return this.deliverableGenerators.generateBlueprintPreview(projectId, gapsFeedback);
  }

  async generateBlueprint(projectId: string, gapsFeedback?: string | null, signal?: AbortSignal) {
    return this.deliverableGenerators.generateBlueprint(projectId, gapsFeedback, signal);
  }

  async generateApiContractsPreview(projectId: string, gapsFeedback?: string | null): Promise<{ content: string }> {
    return this.deliverableGenerators.generateApiContractsPreview(projectId, gapsFeedback);
  }

  async generateInfraPreview(projectId: string, gapsFeedback?: string | null): Promise<{ content: string }> {
    return this.deliverableGenerators.generateInfraPreview(projectId, gapsFeedback);
  }

  async generateApiContracts(projectId: string, gapsFeedback?: string | null, signal?: AbortSignal) {
    return this.deliverableGenerators.generateApiContracts(projectId, gapsFeedback, signal);
  }

  async generateLogicFlows(projectId: string, gapsFeedback?: string | null, signal?: AbortSignal) {
    return this.deliverableGenerators.generateLogicFlows(projectId, gapsFeedback, signal);
  }

  async patchMddFromGapFeedback(
    projectId: string,
    stageId: string,
    gapsFeedback: string,
  ): Promise<void> {
    return this.deliverableGenerators.patchMddFromGapFeedback(projectId, stageId, gapsFeedback);
  }

  async generateInfra(projectId: string, gapsFeedback?: string | null, signal?: AbortSignal) {
    return this.deliverableGenerators.generateInfra(projectId, gapsFeedback, signal);
  }

  async generateDeliverablesCascade(
    projectId: string,
    onProgress?: (p: {
      step: string;
      completedSteps: string[];
      index: number;
      total: number;
    }) => void,
    options?: { acknowledgeGaps?: boolean; signal?: AbortSignal },
  ) {
    return this.deliverablesCascade.generateDeliverablesCascade(projectId, onProgress, options);
  }

  async generateDeliverablesDelta(
    projectId: string,
    onProgress?: (p: {
      step: string;
      completedSteps: string[];
      index: number;
      total: number;
    }) => void,
    options?: { acknowledgeGaps?: boolean; signal?: AbortSignal },
  ) {
    return this.deliverablesCascade.generateDeliverablesDelta(projectId, onProgress, options);
  }

  async repairReadinessGaps(projectId: string, options?: { signal?: AbortSignal }) {
    return this.deliverablesCascade.repairReadinessGaps(projectId, options);
  }

  async runPostRegenSddConflictSurfacing(projectId: string): Promise<void> {
    return this.projectSddReconcile.runPostRegenSddConflictSurfacing(projectId);
  }

  async runPostRegenSddAutoReconcile(projectId: string): Promise<void> {
    return this.projectSddReconcile.runPostRegenSddAutoReconcile(projectId);
  }

  async phase0DeepResearch(
    projectId: string,
    options: { userIdea?: string; urls?: string[]; includeBenchmark?: boolean },
  ) {
    return this.projectPhase0.phase0DeepResearch(projectId, options);
  }

  async persistMddFromBackgroundJob(
    projectId: string,
    rawMarkdown: string,
    options?: { stageId?: string; finalize?: boolean; lockedPatternIds?: readonly string[] },
  ): Promise<void> {
    return this.mddPersist.persistMddFromBackgroundJob(projectId, rawMarkdown, options);
  }
}
