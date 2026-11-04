import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ProjectTypeEnum } from "@theforge/shared-types";
import {
  isLegacyModificationStage,
  isTabVisibleForComplexity,
  type WorkshopDocTab,
} from "./complexityTabs.js";

describe("complexityTabs / projectType helpers", () => {
  it("isLegacyModificationStage solo LEGACY etapa ≥ 2", () => {
    assert.equal(isLegacyModificationStage(ProjectTypeEnum.enum.NEW, 2), false);
    assert.equal(isLegacyModificationStage(ProjectTypeEnum.enum.LEGACY, 1), false);
    assert.equal(isLegacyModificationStage(ProjectTypeEnum.enum.LEGACY, 2), true);
  });

  it("MEDIUM + NEW oculta mdd; MEDIUM + LEGACY lo muestra", () => {
    const mdd: WorkshopDocTab = "mdd";
    assert.equal(
      isTabVisibleForComplexity(mdd, "MEDIUM", { projectType: ProjectTypeEnum.enum.NEW }),
      false,
    );
    assert.equal(
      isTabVisibleForComplexity(mdd, "MEDIUM", {
        projectType: ProjectTypeEnum.enum.LEGACY,
        legacyStageOrdinal: 1,
      }),
      true,
    );
  });
});
