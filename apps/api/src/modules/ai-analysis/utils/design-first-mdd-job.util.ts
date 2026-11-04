import type { PrismaService } from "../../../prisma/prisma.service.js";
import { loadDesignFirstStageContext } from "../../design-first/design-first-gate.util.js";
import {
  sealDesignFirstMddSection3,
  sealDesignFirstMddSection4,
} from "./design-first-mdd-sections.util.js";
import { resolvePagHashForStage } from "./design-first-pinned.util.js";
import type { MDDState } from "../state/index.js";

/** Estado LangGraph inicial para pipeline MDD Design-First con §3/§4 pinned. */
export async function resolveDesignFirstPinnedMddState(
  prisma: PrismaService,
  projectId: string,
  stageId?: string | null,
): Promise<Partial<MDDState> | null> {
  const ctx = await loadDesignFirstStageContext(prisma, projectId, stageId);
  if (!ctx?.pag || !ctx.gates.phase3.ok) return null;

  const s3 = sealDesignFirstMddSection3(ctx.pag);
  const s4 = sealDesignFirstMddSection4(ctx.pag);
  const pagHash = resolvePagHashForStage(ctx.pag, ctx.architectureGraphSourceHash);

  return {
    designFirstPinned: {
      s3,
      s4,
      pagHash,
      pinnedSections: [3, 4],
    },
  };
}
