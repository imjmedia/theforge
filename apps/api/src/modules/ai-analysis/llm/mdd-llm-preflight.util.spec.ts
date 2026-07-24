import { describe, expect, it } from "vitest";
import { probeMddLlmModel } from "./mdd-llm-preflight.util.js";

class FakePreflightLlm {
  constructor(private readonly responses: unknown[]) {}
  idx = 0;
  async invoke(): Promise<unknown> {
    const r = this.responses[Math.min(this.idx, this.responses.length - 1)];
    this.idx += 1;
    return r;
  }
}

describe("probeMddLlmModel", () => {
  it("pasa con JSON mínimo en content", async () => {
    const llm = new FakePreflightLlm([{ content: '{"ok":true,"probe":"mdd"}' }]);
    const r = await probeMddLlmModel(llm as never, "test-model");
    expect(r.ok).toBe(true);
    expect(r.mode).toBe("content");
  });

  it("pasa con tool_calls aunque content vacío", async () => {
    const llm = new FakePreflightLlm([
      { content: "", tool_calls: [{ name: "echo", args: {} }] },
    ]);
    const r = await probeMddLlmModel(llm as never, "test-model");
    expect(r.ok).toBe(true);
    expect(r.mode).toBe("tool_calls");
  });

  it("falla con respuesta vacía", async () => {
    const llm = new FakePreflightLlm([{ content: "" }]);
    const r = await probeMddLlmModel(llm as never, "bad-model");
    expect(r.ok).toBe(false);
    expect(r.mode).toBe("none");
  });
});
