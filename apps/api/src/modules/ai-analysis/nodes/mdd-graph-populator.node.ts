/**
 * @fileoverview Nodo populador de grafo — carga estado persistido en el grafo LangGraph.
 */

/**
 * Nodo GraphPopulator: hidrata `mddStructured` y extrae ADRs.
 * La sync a FalkorDB ocurre en `MddUpdatePipelineService` / `SddGraphSyncService`
 * al persistir el MDD (jobs background finalize, PATCH), antes del semáforo.
 */
import { Logger } from "@nestjs/common";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { GraphMemoryService } from "../graph-memory/graph-memory.service.js";
import { MDDStateType } from "../state/index.js";
import { hydrateStructuredFromDraft } from "../utils/mdd-sanitize.js";
import { extractAndLogAdrs } from "../utils/mdd-adr-logger.js";

const logger = new Logger("MDD:GraphPopulator");

export function createMddGraphPopulatorNode(llm: BaseChatModel, graphMemory: GraphMemoryService) {
    return async (state: MDDStateType): Promise<Partial<MDDStateType>> => {
        const projectId = state.projectId || "legacy_project";

        const structured = hydrateStructuredFromDraft(
            state.mddStructured || {},
            state.mddDraft || ""
        );

        if (state.mddDraft && state.mddDraft.length > 500) {
            void extractAndLogAdrs(llm, graphMemory, projectId, state.mddDraft).catch((err) => {
                logger.error(`Error extrayendo ADRs: ${err instanceof Error ? err.message : String(err)}`);
            });
        }

        return {
            mddStructured: structured,
        };
    };
}
