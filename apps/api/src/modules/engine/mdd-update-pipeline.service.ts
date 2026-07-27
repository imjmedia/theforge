import { Injectable, Logger } from "@nestjs/common";
import { ComplexityLevel, Status } from "@theforge/database";
import type { SddGraphSyncStatus } from "@theforge/shared-types";
import { MddCoherenceService } from "./mdd-coherence/mdd-coherence.service.js";
import { SemaphoreService, type SemaphoreEvaluationInput } from "./semaphore.service.js";
import { prepareMddForOutput } from "../ai-analysis/utils/mdd-prepare-output.js";
import { validateMddForDelivery } from "../ai-analysis/utils/mdd-delivery-gate.util.js";
import { normalizeMddContent } from "./mdd-markdown-parser.js";
import { preRenderMddSanity } from "./mdd-pre-render.js";

export type MddUpdatePipelineResult =
  | { ok: true; sanitizedMdd: string; status: Status; precisionScore: number; sddGraph?: SddGraphSyncStatus }
  | { ok: false; code: string; message: string };

/**
 * Responsabilidad única: validar MDD (sanity), sanitizar Mermaid y evaluar semáforo.
 * Usado por ProjectsService cuando se actualiza mddContent.
 */
@Injectable()
export class MddUpdatePipelineService {
  private readonly logger = new Logger(MddUpdatePipelineService.name);

  constructor(
    private readonly semaphore: SemaphoreService,
    private readonly mddCoherence: MddCoherenceService,
  ) {}

  /**
   * Valida el borrador, sanitiza bloques Mermaid y evalúa semáforo.
   * Con `graphScope`, evalúa coherencia §3/§4 desde markdown antes del semáforo (`sddDomainGraphOk` en HIGH).
   */
  async process(
    rawMddContent: string,
    semaphoreBase: Omit<SemaphoreEvaluationInput, "mddJsonString" | "sddDomainGraphOk">,
    graphScope?: { projectId: string; stageId: string },
  ): Promise<MddUpdatePipelineResult> {
    const gateRef: { current?: ReturnType<typeof validateMddForDelivery> } = {};
    const prepared = await prepareMddForOutput(rawMddContent, {
      deliveryGateRef: gateRef,
      formatForPersist: true,
    });
    const gate = gateRef.current ?? validateMddForDelivery(prepared);
    if (!gate.ok) {
      return {
        ok: false,
        code: "ERR_MDD_DELIVERY_GATE",
        message: gate.blockers.join("; "),
      };
    }
    const sanity = preRenderMddSanity(prepared);
    if (!sanity.ok) {
      return {
        ok: false,
        code: sanity.code ?? "ERR_VALIDATION",
        message: sanity.message ?? "Error de validación del MDD",
      };
    }
    const sanitizedMdd = prepared;
    const normalized = normalizeMddContent(sanitizedMdd);
    const contentForSemaphore = JSON.stringify(normalized);

    let sddDomainGraphOk: boolean | undefined;
    let sddGraph: SddGraphSyncStatus | undefined;
    const pid = graphScope?.projectId?.trim();
    const sid = graphScope?.stageId?.trim();
    if (pid && sid && semaphoreBase.complexity === ComplexityLevel.HIGH) {
      try {
        sddGraph = await this.mddCoherence.syncMddAndEvaluate(pid, sid, sanitizedMdd);
        sddDomainGraphOk = sddGraph.isCoherent && sddGraph.state === "synced";
        if (!sddDomainGraphOk) {
          this.logger.debug(
            `[MddPipeline] Coherencia §3/§4 sin alivio semáforo: state=${sddGraph.state} entities=${sddGraph.entityCount}/${sddGraph.expectedEntities} endpoints=${sddGraph.endpointCount}/${sddGraph.expectedEndpoints}`,
          );
        }
      } catch (e) {
        this.logger.warn(
          `[MddPipeline] Evaluación coherencia MDD no aplicada al semáforo: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    }

    const { status, precisionScore } = this.semaphore.evaluate({
      ...semaphoreBase,
      mddJsonString: contentForSemaphore,
      sddDomainGraphOk,
    });
    return {
      ok: true,
      sanitizedMdd,
      status,
      precisionScore,
      sddGraph,
    };
  }
}
