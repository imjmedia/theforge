/**
 * Contract tests — `buildWorkshopSystemPrompt` (sync vs stream).
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildWorkshopSystemPrompt } from "./workshop-system-prompt.builder.js";

describe("buildWorkshopSystemPrompt", () => {
  it("sync: pestaña architecture (congelada, SSOT) no pide delimitador FIN_ARCH", () => {
    const prompt = buildWorkshopSystemPrompt(
      { activeTab: "architecture", intent: "direct_edit" },
      { variant: "sync", history: [], userPrompt: "actualiza stack", phase0TechDocs: null },
    );
    assert.doesNotMatch(prompt, /---FIN_ARCH---/);
    assert.match(prompt, /documento congelado/);
    assert.match(prompt, /Contexto de documento activo/);
  });

  it("stream: pestaña architecture (congelada) no incluye instrucción OBLIGATORIO de Arquitectura", () => {
    const prompt = buildWorkshopSystemPrompt(
      { activeTab: "architecture", intent: "direct_edit" },
      { variant: "stream", history: [], userPrompt: "actualiza stack", phase0TechDocs: null },
    );
    assert.doesNotMatch(prompt, /OBLIGATORIO — Arquitectura/);
    assert.doesNotMatch(prompt, /---FIN_ARCH---/);
    assert.match(prompt, /documento congelado/);
  });

  it("welcomeBrief usa system corto y omite delimitadores FIN_*", () => {
    const prompt = buildWorkshopSystemPrompt(
      { welcomeBrief: true, activeTab: "mdd" },
      { variant: "sync", history: [], userPrompt: "hola", phase0TechDocs: null },
    );
    assert.match(prompt, /Workshop \*\*The Forge\*\*/);
    assert.doesNotMatch(prompt, /---FIN_MDD---/);
    assert.doesNotMatch(prompt, /DOCUMENT_CHANGELOG_CHAT_INSTRUCTION/);
  });
});
