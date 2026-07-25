import test from "node:test";
import assert from "node:assert/strict";
import {
  getLlmProvidersSnapshot,
  isChatFallbackOn429Enabled,
  llmMaxTokens,
  resolveLlmMaxTokensForPurpose,
  resolveLlmMaxTokensForWorkshopTab,
  resolveEmbeddingDimension,
  resolveLangChainChatTemperature,
} from "./llm-config.js";

test("resolveLangChainChatTemperature — 0.5", () => {
  assert.equal(resolveLangChainChatTemperature(), 0.5);
});

test("getLlmProvidersSnapshot — BYOK vacío", () => {
  assert.deepEqual(getLlmProvidersSnapshot(), []);
});

test("resolveEmbeddingDimension — default 1536", () => {
  const prev = process.env.OPENAI_EMBEDDING_DIM;
  delete process.env.OPENAI_EMBEDDING_DIM;
  delete process.env.EMBEDDING_DIM;
  try {
    assert.equal(resolveEmbeddingDimension(), 1536);
  } finally {
    if (prev !== undefined) process.env.OPENAI_EMBEDDING_DIM = prev;
  }
});

test("llmMaxTokens — default 128K (salida; no confundir con ventana de contexto)", () => {
  const prev = process.env.LLM_MAX_TOKENS;
  delete process.env.LLM_MAX_TOKENS;
  try {
    assert.equal(llmMaxTokens(), 131_072);
  } finally {
    if (prev !== undefined) process.env.LLM_MAX_TOKENS = prev;
  }
});

test("llmMaxTokens — respeta env", () => {
  const prev = process.env.LLM_MAX_TOKENS;
  process.env.LLM_MAX_TOKENS = "16384";
  try {
    assert.equal(llmMaxTokens(), 16_384);
  } finally {
    if (prev !== undefined) process.env.LLM_MAX_TOKENS = prev;
    else delete process.env.LLM_MAX_TOKENS;
  }
});

test("resolveLlmMaxTokensForPurpose — perfiles por tarea", () => {
  const prev = process.env.LLM_MAX_TOKENS;
  delete process.env.LLM_MAX_TOKENS;
  try {
    assert.equal(resolveLlmMaxTokensForPurpose("chat"), 16_384);
    assert.equal(resolveLlmMaxTokensForPurpose("document"), 65_536);
    assert.equal(resolveLlmMaxTokensForPurpose("uxGuide"), 16_384);
    assert.equal(resolveLlmMaxTokensForPurpose("langgraph"), 65_536);
    assert.equal(resolveLlmMaxTokensForPurpose("auditor"), 131_072);
    assert.equal(resolveLlmMaxTokensForPurpose("tasksPlanner"), 131_072);
    assert.equal(resolveLlmMaxTokensForPurpose("tasksDoc"), 131_072);
    assert.equal(resolveLlmMaxTokensForPurpose("governancePatterns"), 2_048);
  } finally {
    if (prev !== undefined) process.env.LLM_MAX_TOKENS = prev;
  }
});

test("resolveLlmMaxTokensForPurpose — techo global desde env", () => {
  const prev = process.env.LLM_MAX_TOKENS;
  process.env.LLM_MAX_TOKENS = "4096";
  try {
    assert.equal(resolveLlmMaxTokensForPurpose("document"), 4_096);
  } finally {
    if (prev !== undefined) process.env.LLM_MAX_TOKENS = prev;
    else delete process.env.LLM_MAX_TOKENS;
  }
});

test("resolveLlmMaxTokensForWorkshopTab — pestañas de documento", () => {
  assert.equal(resolveLlmMaxTokensForWorkshopTab("mdd"), 65_536);
  assert.equal(resolveLlmMaxTokensForWorkshopTab("ux-ui-guide"), 16_384);
  assert.equal(resolveLlmMaxTokensForWorkshopTab("tasks"), 131_072);
  assert.equal(resolveLlmMaxTokensForWorkshopTab(undefined), 16_384);
  assert.equal(resolveLlmMaxTokensForWorkshopTab("mdd", { welcomeBrief: true }), 2_048);
});

test("isChatFallbackOn429Enabled — sin fallbacks", () => {
  assert.equal(isChatFallbackOn429Enabled(false), false);
});

test("resolveEmbeddingDimension — runtime BYOK/instancia", () => {
  assert.equal(resolveEmbeddingDimension(3072), 3072);
});

test("isChatFallbackOn429Enabled — con fallbacks en proveedor activo", () => {
  assert.equal(isChatFallbackOn429Enabled(true), true);
});
