/**
 * @fileoverview Hidrata mddStructured al final del pipeline LangGraph (sin FalkorDB).
 */

import { Logger } from "@nestjs/common";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type { PrismaService } from "../../../prisma/prisma.service.js";
import { MDDStateType } from "../state/index.js";
import { hydrateStructuredFromDraft } from "../utils/mdd-sanitize.js";
import { extractAndLogAdrs } from "../utils/mdd-adr-logger.js";

const logger = new Logger("MDD:StructuredHydrator");

export function createMddStructuredHydratorNode(llm: BaseChatModel, prisma: PrismaService | null) {
  return async (state: MDDStateType): Promise<Partial<MDDStateType>> => {
    const structured = hydrateStructuredFromDraft(
      state.mddStructured || {},
      state.mddDraft || "",
    );
    logger.debug(`hydrated structured keys=${Object.keys(structured).length}`);

    const projectId = state.projectId?.trim();
    if (prisma && projectId && state.mddDraft && state.mddDraft.length > 500) {
      void extractAndLogAdrs(llm, prisma, projectId, state.mddDraft).catch((err) => {
        logger.error(`Error extrayendo ADRs: ${err instanceof Error ? err.message : String(err)}`);
      });
    }

    return { mddStructured: structured };
  };
}
