import { Injectable, Logger } from "@nestjs/common";
import {
  mddGraphFingerprint,
  resolveMddCoherenceState,
  type SddGraphSyncStatus,
} from "@theforge/shared-types";
import type { DomainInventory } from "@theforge/shared-types";
import { parseMddGraphExpectations } from "./mdd-graph-expectations.util.js";
import { evaluateMddCoherenceFromMarkdown } from "./mdd-coherence.util.js";
import type { StoredSddGraphContext } from "./sdd-graph-context.util.js";
import {
  coherenceMemoKey,
  getMemoizedCoherenceStatus,
  setMemoizedCoherenceStatus,
} from "../../ai-analysis/utils/mdd-off-graph-memo.util.js";

const STALE_LOG_THROTTLE_MS = 60_000;

@Injectable()
export class MddCoherenceService {
  private readonly logger = new Logger(MddCoherenceService.name);
  private readonly staleLogAtByFingerprint = new Map<string, number>();

  /** Evalúa coherencia §3/§4 desde markdown (reemplaza sync Falkor + Cypher). */
  async syncMddAndEvaluate(
    projectId: string,
    stageId: string,
    mddMarkdown: string,
  ): Promise<SddGraphSyncStatus> {
    return this.evaluateFromMdd(projectId, stageId, mddMarkdown);
  }

  async evaluateFromMdd(
    _projectId: string,
    _stageId: string,
    mddMarkdown: string,
    context?: StoredSddGraphContext | null,
    options?: { inventory?: DomainInventory | null },
  ): Promise<SddGraphSyncStatus> {
    const memoKey = coherenceMemoKey(mddMarkdown, context?.mddFingerprint);
    const memoHit = getMemoizedCoherenceStatus(memoKey);
    if (memoHit) return memoHit;

    const expectations = parseMddGraphExpectations(mddMarkdown);
    const health = evaluateMddCoherenceFromMarkdown(mddMarkdown, {
      inventory: options?.inventory,
    });
    const fingerprint = mddGraphFingerprint(mddMarkdown);

    const status = resolveMddCoherenceState({
      expectedEntities: expectations.expectedEntities,
      expectedEndpoints: expectations.expectedEndpoints,
      entityCount: health.entityCount,
      endpointCount: health.endpointCount,
      isCoherent: health.isCoherent,
      orphanEntityCount: health.orphanEntityCount,
      orphanEndpointCount: health.orphanEndpointCount,
      mddChangedSinceSync: false,
    });

    if (status.state === "stale") {
      const now = Date.now();
      const last = this.staleLogAtByFingerprint.get(fingerprint) ?? 0;
      if (now - last >= STALE_LOG_THROTTLE_MS) {
        this.staleLogAtByFingerprint.set(fingerprint, now);
        this.logger.debug(
          `[MddCoherence] state=${status.state} entities=${health.entityCount}/${expectations.expectedEntities} endpoints=${health.endpointCount}/${expectations.expectedEndpoints} orphans=${health.orphanEntityCount}+${health.orphanEndpointCount}`,
        );
      }
    }

    const result = {
      ...status,
      lastSyncedAt: status.state === "synced" ? Date.now() : context?.lastSyncedAt ?? null,
    };
    setMemoizedCoherenceStatus(memoKey, result);
    return result;
  }
}
