import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { summarizePluginDataPresence, toApiProject } from "./project-api.util.js";

describe("summarizePluginDataPresence", () => {
  it("returns null for empty or non-object input", () => {
    assert.equal(summarizePluginDataPresence(null), null);
    assert.equal(summarizePluginDataPresence(undefined), null);
    assert.equal(summarizePluginDataPresence({}), null);
  });

  it("maps plugin ids to true without payload", () => {
    assert.deepEqual(
      summarizePluginDataPresence({
        "com.kreodevs.evd": { slides: [{ id: "1", title: "T" }] },
        "com.example.other": "ok",
      }),
      { "com.kreodevs.evd": true, "com.example.other": true },
    );
  });

  it("skips null and empty object entries", () => {
    assert.deepEqual(
      summarizePluginDataPresence({
        empty: {},
        missing: null,
        present: { x: 1 },
      }),
      { present: true },
    );
  });
});

describe("toApiProject: convergeWebhookSecret solo para el dueño", () => {
  const project = {
    id: "p-1",
    userId: "owner",
    groupId: "g-1",
    name: "P",
    convergeWebhookUrl: "https://ci.example.test/hook",
    convergeWebhookSecret: "s3cr3t-de-prueba",
    stages: [],
  };

  it("sin opciones (lector SHARED) redacta el secreto (null) pero conserva el resto de campos", () => {
    const api = toApiProject(project) as Record<string, unknown>;
    assert.equal(api.convergeWebhookSecret, null);
    assert.ok(!JSON.stringify(api).includes("s3cr3t-de-prueba"));
    assert.equal(api.convergeWebhookUrl, "https://ci.example.test/hook");
    assert.equal(api.name, "P");
  });

  it("isOwner=false redacta el secreto", () => {
    assert.equal((toApiProject(project, { isOwner: false }) as Record<string, unknown>).convergeWebhookSecret, null);
  });

  it("isOwner=true lo incluye", () => {
    const api = toApiProject(project, { isOwner: true }) as Record<string, unknown>;
    assert.equal(api.convergeWebhookSecret, "s3cr3t-de-prueba");
  });
});

describe("toApiProject: mddLeaseFence no sale en la API (ADR 0004)", () => {
  it("omite mddLeaseFence de cada etapa y el DTO serializa sin lanzar", () => {
    const stage = {
      id: "s-1",
      ordinal: 1,
      mddContent: null,
      mddLeaseFence: BigInt(1730000000000),
      estimation: null,
    } as unknown as Parameters<typeof toApiProject>[0]["stages"][number];
    const project = { id: "p-1", userId: "owner", groupId: "g-1", name: "P", stages: [stage] };

    const api = toApiProject(project) as unknown as { stages: Array<Record<string, unknown>> };
    const [apiStage] = api.stages;
    assert.ok(apiStage);
    assert.equal("mddLeaseFence" in apiStage, false);
    assert.equal(apiStage.id, "s-1");
    assert.doesNotThrow(() => JSON.stringify(api));
  });
});
