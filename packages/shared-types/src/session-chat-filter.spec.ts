import { describe, it } from "node:test";
import assert from "node:assert";
import {
  filterChatByStage,
  filterChatForWorkshopView,
  resolveWorkshopChatScope,
  shouldDefaultWorkshopChatScopeByStage,
  type ChatMessage,
} from "./session.js";

const msg = (role: "user" | "assistant", tab: string, stageId?: string): ChatMessage => ({
  role,
  content: `${role}-${tab}${stageId ? `-${stageId}` : ""}`,
  tab,
  ...(stageId ? { stageId } : {}),
});

describe("shouldDefaultWorkshopChatScopeByStage", () => {
  it("true en LEGACY multi-etapa", () => {
    assert.equal(shouldDefaultWorkshopChatScopeByStage("LEGACY", 2), true);
  });

  it("false en NEW multi-etapa o LEGACY mono-etapa", () => {
    assert.equal(shouldDefaultWorkshopChatScopeByStage("NEW", 3), false);
    assert.equal(shouldDefaultWorkshopChatScopeByStage("LEGACY", 1), false);
  });
});

describe("resolveWorkshopChatScope", () => {
  it("respeta explicit stage/global", () => {
    assert.equal(resolveWorkshopChatScope("NEW", 5, "stage"), "stage");
    assert.equal(resolveWorkshopChatScope("LEGACY", 2, "global"), "global");
  });

  it("default stage en brownfield multi-etapa", () => {
    assert.equal(resolveWorkshopChatScope("LEGACY", 2), "stage");
    assert.equal(resolveWorkshopChatScope("NEW", 2), "global");
  });
});

describe("filterChatByStage", () => {
  const log: ChatMessage[] = [
    msg("user", "mdd", "stage-a"),
    msg("assistant", "mdd", "stage-a"),
    msg("user", "mdd", "stage-b"),
    msg("user", "mdd"),
  ];

  it("solo mensajes de la etapa pedida", () => {
    const out = filterChatByStage(log, "stage-a");
    assert.equal(out.length, 2);
    assert.ok(out.every((m) => m.stageId === "stage-a"));
  });
});

describe("filterChatForWorkshopView", () => {
  const log: ChatMessage[] = [
    msg("user", "mdd", "s1"),
    msg("user", "benchmark", "s1"),
    msg("user", "mdd", "s2"),
  ];

  it("global: solo filtra tab", () => {
    assert.equal(filterChatForWorkshopView(log, "mdd", { scope: "global" }).length, 2);
  });

  it("stage: tab + etapa", () => {
    const out = filterChatForWorkshopView(log, "mdd", { stageId: "s1", scope: "stage" });
    assert.equal(out.length, 1);
    assert.equal(out[0]?.stageId, "s1");
  });
});
