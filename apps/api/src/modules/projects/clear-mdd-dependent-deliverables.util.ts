import { Prisma } from "@theforge/database";
import {
  buildClearMddDependentDeliverablesPayload,
  buildClearStageMddDependentDeliverablesPayload,
  type ProjectType,
} from "@theforge/shared-types";

export function buildProjectClearMddDependentDeliverablesUpdate(
  projectType?: ProjectType,
): Prisma.ProjectUpdateInput {
  return {
    ...buildClearMddDependentDeliverablesPayload(projectType),
    tasksJson: Prisma.JsonNull,
  };
}

export function buildStageClearMddDependentDeliverablesUpdate(
  shortTermContext: unknown,
  projectType?: ProjectType,
): Prisma.StageUpdateInput {
  const prevCtx =
    shortTermContext &&
    typeof shortTermContext === "object" &&
    !Array.isArray(shortTermContext)
      ? (shortTermContext as Record<string, unknown>)
      : {};

  return {
    ...buildClearStageMddDependentDeliverablesPayload(projectType),
    tasksJson: Prisma.JsonNull,
    changeSpecContent: null,
    deliverableSnapshot: Prisma.JsonNull,
    shortTermContext: {
      ...prevCtx,
      pendingCascadeDelta: null,
    } as Prisma.InputJsonValue,
  };
}
