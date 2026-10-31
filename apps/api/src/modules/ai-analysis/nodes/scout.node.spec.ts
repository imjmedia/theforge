import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { normalizeCompetitorUrl, parseScoutCompetitors } from "./scout.node.js";

describe("normalizeCompetitorUrl", () => {
  it("añade https:// a dominios sin protocolo", () => {
    assert.equal(normalizeCompetitorUrl("acme.com"), "https://acme.com");
    assert.equal(normalizeCompetitorUrl("acme.com/pricing"), "https://acme.com/pricing");
    assert.equal(normalizeCompetitorUrl("www.acme.io"), "https://www.acme.io");
  });
  it("respeta URLs con protocolo y valores no string", () => {
    assert.equal(normalizeCompetitorUrl("http://acme.com"), "http://acme.com");
    assert.equal(normalizeCompetitorUrl("HTTPS://acme.com"), "HTTPS://acme.com");
    assert.equal(normalizeCompetitorUrl(42), 42);
    assert.equal(normalizeCompetitorUrl("no es url"), "no es url");
  });
});

describe("parseScoutCompetitors", () => {
  it("conserva los competidores válidos y descarta solo los inválidos", () => {
    const text = JSON.stringify({
      competitors: [
        { name: "A", url: "https://a.com" },
        { name: "B", url: "no-es-url" },
        { name: "C", url: "c.com/plans", uvp: "x" },
        { url: "https://sin-nombre.com" },
      ],
    });
    const out = parseScoutCompetitors(text);
    assert.equal(out.parsed, true);
    assert.deepEqual(
      out.competitors.map((c) => [c.name, c.url]),
      [
        ["A", "https://a.com"],
        ["C", "https://c.com/plans"],
      ],
    );
    assert.equal(out.dropped, 2);
    assert.match(out.firstIssue, /url/);
  });

  it("no limita por schema: recorta a 5 con slice en vez de rechazar la lista", () => {
    const competitors = Array.from({ length: 7 }, (_, i) => ({ name: `C${i}`, url: `https://c${i}.com` }));
    const out = parseScoutCompetitors(JSON.stringify({ competitors }));
    assert.equal(out.competitors.length, 5);
    assert.equal(out.dropped, 0);
  });

  it("acepta JSON en bloque markdown y con prosa alrededor", () => {
    const text = 'Aquí tienes:\n```json\n{"competitors":[{"name":"A","url":"https://a.com"}]}\n```\nSaludos.';
    const out = parseScoutCompetitors(text);
    assert.equal(out.competitors.length, 1);
  });

  it("nunca lanza: prosa sin JSON, vacío o competitors ausente", () => {
    assert.deepEqual(parseScoutCompetitors("Hola, ¿en qué te ayudo?").competitors, []);
    assert.equal(parseScoutCompetitors("Hola").parsed, false);
    assert.deepEqual(parseScoutCompetitors("").competitors, []);
    assert.deepEqual(parseScoutCompetitors('{"domainClassification":"saas"}').competitors, []);
    assert.equal(parseScoutCompetitors('{"domainClassification":"saas"}').parsed, true);
  });
});
