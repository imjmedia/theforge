import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ProjectTypeEnum } from "@theforge/shared-types";
import { resolveWorkshopChatScopeForProject } from "./chat-scope.js";

describe("resolveWorkshopChatScopeForProject", () => {
  it("NEW greenfield con una etapa → global por defecto", () => {
    assert.equal(
      resolveWorkshopChatScopeForProject(ProjectTypeEnum.enum.NEW, 1, "proj-1"),
      "global",
    );
  });

  it("LEGACY multi-etapa → stage por defecto", () => {
    assert.equal(
      resolveWorkshopChatScopeForProject(ProjectTypeEnum.enum.LEGACY, 2, "proj-2"),
      "stage",
    );
  });
});
