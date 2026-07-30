import { Injectable, Logger } from "@nestjs/common";
import { ComplexityLevel, Status } from "@theforge/database";
import type { SddGraphSyncStatus } from "@theforge/shared-types";
import { MddCoherenceService } from "./mdd-coherence/mdd-coherence.service.js";
import { resolveDomainInventory } from "./domain-inventory-persist.util.js";
import { SemaphoreService, type SemaphoreEvaluationInput } from "./semaphore.service.js";
import { prepareMddForOutput } from "../ai-analysis/utils/mdd-prepare-output.js";
import { validateMddForDelivery } from "../ai-analysis/utils/mdd-delivery-gate.util.js";
import { extractSection5Body } from "../ai-analysis/utils/mdd-sanitize/section-merge.js";
import {
  prepareMddMarkdownForPersist,
  touchPrevalidatedMddBeforePersist,
} from "../ai-analysis/utils/mdd-sanitize/persist-pipeline.js";
import { logMddPersistFenceDiag } from "../ai-analysis/utils/mdd-persist-fence-diag.util.js";
import { normalizeMddContent } from "./mdd-markdown-parser.js";
import { preRenderMddSanity } from "./mdd-pre-render.js";

export type MddUpdatePipelineGraphScope = {
  projectId: string;
  stageId: string;
  brdMarkdown?: string | null;
  dbgaMarkdown?: string | null;
  domainInventory?: unknown;
};

export type MddUpdatePipelineProcessOptions = MddUpdatePipelineGraphScope & {
  /**
   * Markdown ya pasó `prepareMddForOutput` + PersistCheck en el grafo (job finalize).
   * Evita 2ª pasada destructiva con hydrate/dedupe; sólo formateo de persistencia + gate.
   */
  prevalidatedFromStream?: boolean;
  /** Borrador pre-prepare para restaurar §5 si el formateo la regresó. */
  baselineDraft?: string | null;
};

export type MddUpdatePipelineResult =
  | {
      ok: true;
      sanitizedMdd: string;
      status: Status;
      precisionScore: number;
      sddGraph?: SddGraphSyncStatus;
      /** true cuando `sanitizedMdd` ya incluyó `prepareMddMarkdownForPersist`. */
      persistFormatted?: boolean;
    }
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
    graphScope?: MddUpdatePipelineProcessOptions,
  ): Promise<MddUpdatePipelineResult> {
    const gateRef: { current?: ReturnType<typeof validateMddForDelivery> } = {};
    const s5Pre = extractSection5Body(rawMddContent)?.length ?? 0;
    const prevalidated = graphScope?.prevalidatedFromStream === true;
    console.log(
      `[MDD:PersistPipeline] prepare start len=${rawMddContent.length} §5=${s5Pre} prevalidated=${prevalidated}`,
    );
    logMddPersistFenceDiag("update-pipeline:pre", rawMddContent);
    let prepared: string;
    let persistFormatted = false;
    if (prevalidated) {
      const touched = touchPrevalidatedMddBeforePersist(
        rawMddContent,
        graphScope?.baselineDraft ?? rawMddContent,
      );
      prepared = prepareMddMarkdownForPersist(touched);
      persistFormatted = true;
      gateRef.current = validateMddForDelivery(prepared);
    } else {
      prepared = await prepareMddForOutput(rawMddContent, {
        deliveryGateRef: gateRef,
        formatForPersist: true,
        brdMarkdown: graphScope?.brdMarkdown,
        dbgaMarkdown: graphScope?.dbgaMarkdown,
      });
    }
    const s5Post = extractSection5Body(prepared)?.length ?? 0;
    console.log(
      `[MDD:PersistPipeline] prepare done len=${prepared.length} §5=${s5Pre}→${s5Post} prevalidated=${prevalidated}`,
    );
    logMddPersistFenceDiag("update-pipeline:post", prepared);
    const gate = gateRef.current ?? validateMddForDelivery(prepared);
    if (!gate.ok) {
      console.warn(
        `[MDD:PersistPipeline] gate FAIL score=${gate.score} blockers=${gate.blockers.length}: ${gate.blockers.slice(0, 2).join("; ")}`,
      );
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
        const inventory = resolveDomainInventory({
          persisted: graphScope?.domainInventory,
          brdMarkdown: graphScope?.brdMarkdown,
          dbgaMarkdown: graphScope?.dbgaMarkdown,
          mddMarkdown: sanitizedMdd,
        });
        sddGraph = await this.mddCoherence.evaluateFromMdd(pid, sid, sanitizedMdd, undefined, {
          inventory,
        });
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
      persistFormatted,
    };
  }
}
