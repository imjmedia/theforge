import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ConflictException } from "@nestjs/common";
import { StageStatus } from "@theforge/database";
import { UiScreensService } from "./ui-screens.service.js";

describe("UiScreensService — DESIGN_FIRST", () => {
  it("syncUiScreens responde 409 ERR_DESIGN_FIRST_SCREENS_OWNED", async () => {
    const prisma = {
      project: {
        findUnique: async () => ({
          id: "df-1",
          projectType: "DESIGN_FIRST",
          complexity: "HIGH",
          dbgaContent: null,
          phase0SummaryContent: null,
          specContent: null,
          apiContractsContent: null,
          userStoriesContent: null,
          blueprintContent: null,
          name: "DF",
          stages: [{ ordinal: 1, workflowStatus: StageStatus.ACTIVE, mddContent: "" }],
        }),
      },
      stage: { findFirst: async () => null },
    };
    const service = new UiScreensService(prisma as never, {} as never, {} as never);

    await assert.rejects(
      () => service.syncUiScreens("df-1"),
      (err: unknown) => {
        assert.ok(err instanceof ConflictException);
        const body = err.getResponse() as { code?: string };
        assert.equal(body.code, "ERR_DESIGN_FIRST_SCREENS_OWNED");
        return true;
      },
    );
  });
});
