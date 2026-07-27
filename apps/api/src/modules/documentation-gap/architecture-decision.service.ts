import { Injectable, Logger } from "@nestjs/common";
import type { AffectedArtifact, DocumentationGapEvidence } from "@theforge/shared-types";
import { PrismaService } from "../../prisma/prisma.service.js";
import {
  appendArchitectureDecisionToScaffold,
  buildArchitectureDecisionFromGap,
  buildArchitectureDecisionFromSddConflict,
  isAutoReconcileInternalGap,
  listArchitectureDecisionFiles,
  splitAutoReconcileConflictDescription,
  type ArchitectureDecisionSource,
} from "./architecture-decision.util.js";

@Injectable()
export class ArchitectureDecisionService {
  private readonly logger = new Logger(ArchitectureDecisionService.name);

  constructor(
    private readonly prisma: PrismaService,
  ) {}

  async recordFromSddConflict(
    projectId: string,
    conflict: string,
    source: ArchitectureDecisionSource,
  ): Promise<void> {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { agentGovernanceContent: true },
    });
    if (!project) return;

    const existingFiles = listArchitectureDecisionFiles(project.agentGovernanceContent);
    const record = buildArchitectureDecisionFromSddConflict(conflict, source, { existingFiles });
    await this.persistRecord(projectId, project.agentGovernanceContent, record);
  }

  async recordFromResolvedGap(
    projectId: string,
    gap: {
      description: string;
      affectedArtifacts: unknown;
      evidence: unknown;
    },
    source: ArchitectureDecisionSource,
  ): Promise<void> {
    const evidence = gap.evidence as DocumentationGapEvidence;
    const affectedArtifacts = gap.affectedArtifacts as AffectedArtifact[];

    if (isAutoReconcileInternalGap(evidence)) {
      const conflicts = splitAutoReconcileConflictDescription(gap.description);
      for (const conflict of conflicts) {
        await this.recordFromSddConflict(projectId, conflict, source);
      }
      return;
    }

    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { agentGovernanceContent: true },
    });
    if (!project) return;

    const existingFiles = listArchitectureDecisionFiles(project.agentGovernanceContent);
    const record = buildArchitectureDecisionFromGap(
      {
        description: gap.description,
        affectedArtifacts,
        evidence,
      },
      source,
      { existingFiles },
    );
    await this.persistRecord(projectId, project.agentGovernanceContent, record);
  }

  private async persistRecord(
    projectId: string,
    agentGovernanceContent: string | null,
    record: ReturnType<typeof buildArchitectureDecisionFromSddConflict>,
  ): Promise<void> {
    const { serialized, appended } = appendArchitectureDecisionToScaffold(
      agentGovernanceContent,
      record,
    );
    if (!appended) return;

    await this.prisma.project.update({
      where: { id: projectId },
      data: { agentGovernanceContent: serialized },
    });

    this.logger.log(`ADR registrado: ${record.path} (${record.source})`);
  }
}
