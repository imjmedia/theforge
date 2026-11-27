import test from "node:test";
import assert from "node:assert/strict";
import { collectExternalIntegrationGapsFromRegistry } from "./external-integration-registry";
import { classifyGap } from "./readiness-audit.util";

const scope =
  "El sistema debe ofrecer un feed con actualización en tiempo real de cotizaciones para los operadores. ".repeat(3) +
  "Más contexto del API y la infra que no debe contaminar.";

test("mensaje [Integración] incluye extracto y criterio por artefacto faltante", () => {
  const gaps = collectExternalIntegrationGapsFromRegistry({
    scopeCorpus: scope,
    apiMarkdown: "nada",
    architectureMarkdown: "nada",
    infraMarkdown: "nada",
  });
  assert.equal(gaps.length, 1);
  const g = gaps[0];
  assert.match(g, /^\[Integración websocket_gateway\]/);
  assert.match(g, /falta en: API contracts, Architecture, Infra\./);
  assert.match(g, /tiempo real/);
  assert.match(g, /API contracts debe mencionar \/\(wss\?/);
  assert.match(g, /Infra debe mencionar .*sticky\\s\+session/);
  assert.deepEqual(classifyGap(g).targetDeliverables, ["api_contracts", "architecture", "infra"]);
});

test("solo lista criterio de lo que falta y no añade destinos por el extracto", () => {
  const corpus = "Necesitamos tiempo real en el API gateway de infra. ".repeat(6);
  const gaps = collectExternalIntegrationGapsFromRegistry({
    scopeCorpus: corpus,
    apiMarkdown: "usa websocket en /ws",
    architectureMarkdown: "websocket",
    infraMarkdown: "nada",
  });
  assert.equal(gaps.length, 1);
  assert.deepEqual(classifyGap(gaps[0]).targetDeliverables, ["infra"]);
  assert.doesNotMatch(gaps[0], /API contracts debe/);
});

test("el extracto con plurales y compuestos (arquitecturas, microarquitectura, infraestructuras) no añade destinos falsos", () => {
  const corpus =
    "Necesitamos tiempo real entre arquitecturas, microarquitectura y infraestructuras compartidas. ".repeat(4);
  const gaps = collectExternalIntegrationGapsFromRegistry({
    scopeCorpus: corpus,
    apiMarkdown: "usa websocket en /ws",
    architectureMarkdown: "websocket",
    infraMarkdown: "nada",
  });
  assert.equal(gaps.length, 1);
  assert.deepEqual(classifyGap(gaps[0]).targetDeliverables, ["infra"]);
  assert.doesNotMatch(gaps[0], /arquitecturas|microarquitectura|infraestructuras/i);
});
