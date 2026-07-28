import { Injectable, Logger } from "@nestjs/common";
import { resolveMddCoherenceState, type SddGraphSyncStatus } from "@theforge/shared-types";
import { parseMddGraphExpectations } from "./mdd-graph-expectations.util.js";
import { evaluateMddCoherenceFromMarkdown } from "./mdd-coherence.util.js";

@Injectable()
export class MddCoherenceService {
  private readonly logger = new Logger(MddCoherenceService.name);

  /** Evalúa coherencia §3/§4 desde markdown (reemplaza sync Falkor + Cypher). */
  async syncMddAndEvaluate(
    projectId: string,
    stageId: string,
    mddMarkdown: string,
  ): Promise<SddGraphSyncStatus> {
    return this.evaluateFromMdd(projectId, stageId, mddMarkdown);
  }

  /** Evalúa coherencia §3/§4 en vivo desde el markdown actual (sin comparar huella persistida). */
  async evaluateFromMdd(
    _projectId: string,
    _stageId: string,
    mddMarkdown: string,
  ): Promise<SddGraphSyncStatus> {
    const expectations = parseMddGraphExpectations(mddMarkdown);
    const health = evaluateMddCoherenceFromMarkdown(mddMarkdown);

    const status = resolveMddCoherenceState({
      expectedEntities: expectations.expectedEntities,
      expectedEndpoints: expectations.expectedEndpoints,
      entityCount: health.entityCount,
      endpointCount: health.endpointCount,
      isCoherent: health.isCoherent,
      orphanEntityCount: health.orphanEntityCount,
      orphanEndpointCount: health.orphanEndpointCount,
    });

    if (status.state === "stale") {
      this.logger.debug(
        `[MddCoherence] state=${status.state} entities=${health.entityCount}/${expectations.expectedEntities} endpoints=${health.endpointCount}/${expectations.expectedEndpoints} orphans=${health.orphanEntityCount}+${health.orphanEndpointCount}`,
      );
    }

    return {
      ...status,
      lastSyncedAt: status.state === "synced" ? Date.now() : null,
    };
  }
}
