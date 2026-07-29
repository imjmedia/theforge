import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  applyMddQualityAutoRepairs,
  collectMddQualityIssues,
  detectBareMermaidBlocks,
  detectOrphanSqlTables,
  detectPlaceholderNoise,
  extractMddInfraRequirements,
  checkInfraManifestConformance,
  enrichOrphanSqlTablesInDraft,
  fixBareMermaidFences,
  findApiSemanticAliasWarnings,
  isAutoRepairableCrossConsistencyIssue,
  isAutoRepairableDeliveryGateWarning,
  listOrphanSqlTableNames,
  removeThinSqlStubsWhenProseRich,
  stripContextPlaceholderDashes,
} from "./mdd-quality-audit.util.js";

const MDD_BASE = `# Master Design Document

## 1. Contexto y Alcance
Copiloto unificado.

## 2. Arquitectura y Stack
NestJS + Node 20.

## 3. Modelo de Datos
\`\`\`sql
CREATE TABLE tenants (id UUID PRIMARY KEY, name VARCHAR(255) NOT NULL);
CREATE TABLE whatsapp_devices (id UUID PRIMARY KEY, created_at TIMESTAMPTZ NOT NULL);
\`\`\`

## 4. Contratos de API
| GET | /api/v1/health | ok | No |
\`\`\`json
{"status":"ok"
\`\`\`

## 5. Lógica y Edge Cases
mermaid
flowchart TD
  A --> B

## 7. Infraestructura
Argon2id para passwords. DLQ Celery. CloudFront + S3 frontend.
\`\`\`json
{"stack":{"security":{"hashing_algorithm":"Argon2id"}}}
\`\`\`
`;

describe("mdd-quality-audit.util", () => {
  it("detectBareMermaidBlocks flags un-fenced diagrams", () => {
    const issues = detectBareMermaidBlocks(MDD_BASE);
    assert.ok(issues.length >= 1);
  });

  it("fixBareMermaidFences wraps bare flowchart", () => {
    const fixed = fixBareMermaidFences("## 5\nmermaid\nflowchart TD\n  A --> B\n");
    assert.match(fixed, /```mermaid/);
  });

  it("detectOrphanSqlTables finds whatsapp_devices", () => {
    const orphans = detectOrphanSqlTables(MDD_BASE);
    assert.ok(orphans.some((o) => o.includes("whatsapp_devices")));
  });

  it("collectMddQualityIssues aggregates blockers", () => {
    const issues = collectMddQualityIssues(MDD_BASE);
    assert.ok(issues.length >= 2);
  });

  it("collectMddQualityIssues detecta cola truncada", () => {
    const issues = collectMddQualityIssues("## 4. Contratos\n\n```json\n{ \"a\": 1");
    assert.ok(issues.some((i) => /json abierto|truncado/i.test(i)));
  });

  it("detectPlaceholderNoise catches dash placeholders", () => {
    const msg = detectPlaceholderNoise("## 1. Contexto\n\nObjetivos --- --- ---\n");
    assert.ok(msg);
  });

  it("extractMddInfraRequirements reads manifest and prose", () => {
    const req = extractMddInfraRequirements(MDD_BASE);
    assert.equal(req.hashingAlgorithm, "Argon2id");
    assert.equal(req.dlqRequired, true);
    assert.equal(req.staticDeploy, "cloudfront_s3");
  });

  it("checkInfraManifestConformance gaps when infra misses Argon2", () => {
    const gaps = checkInfraManifestConformance(
      MDD_BASE,
      `# Infra\n\n${"Docker compose stack for API and worker. ".repeat(4)}`,
    );
    assert.ok(gaps.some((g) => /Argon2id/i.test(g)));
  });

  it("findApiSemanticAliasWarnings detects auth/login vs token", () => {
    const warnings = findApiSemanticAliasWarnings(
      "POST /api/v1/auth/token",
      "POST /api/v1/auth/login",
    );
    assert.equal(warnings.length, 1);
  });

  it("listOrphanSqlTableNames finds thin tables", () => {
    const names = listOrphanSqlTableNames(MDD_BASE);
    assert.ok(names.includes("whatsapp_devices"));
  });

  it("enrichOrphanSqlTablesInDraft adds business columns", () => {
    const enriched = enrichOrphanSqlTablesInDraft(MDD_BASE);
    assert.match(enriched, /whatsapp_devices[\s\S]*name VARCHAR/);
    assert.equal(listOrphanSqlTableNames(enriched).length, 0);
  });

  it("stripContextPlaceholderDashes removes dash noise in §1", () => {
    const draft = "## 1. Contexto\n\nObjetivos --- --- ---\n\nDetalle real.";
    const cleaned = stripContextPlaceholderDashes(draft);
    assert.ok(!/---\s+---\s+---/.test(cleaned));
    assert.ok(cleaned.includes("Detalle real"));
  });

  it("stripContextPlaceholderDashes demotes ### used as bullets", () => {
    const draft = "## 1. Contexto\n\n### Comerciales - gestión de licencias\n\nTexto.";
    const cleaned = stripContextPlaceholderDashes(draft);
    assert.match(cleaned, /- \*\*Comerciales:\*\* gestión de licencias/);
  });

  it("removeThinSqlStubsWhenProseRich drops thin CREATE when prose defines entity", () => {
    const draft = `# MDD

## 3. Modelo de Datos

### strategies
| column | type |
| name | VARCHAR(255) |
| config | JSONB |

\`\`\`sql
CREATE TABLE strategies (
  id UUID PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL
);
\`\`\`
`;
    const cleaned = removeThinSqlStubsWhenProseRich(draft);
    assert.ok(!/CREATE TABLE strategies/i.test(cleaned));
    assert.ok(cleaned.includes("### strategies"));
  });

  it("applyMddQualityAutoRepairs reduces issues on sample MDD", () => {
    const before = collectMddQualityIssues(MDD_BASE).length;
    const { markdown, repairs } = applyMddQualityAutoRepairs(MDD_BASE);
    const after = collectMddQualityIssues(markdown).length;
    assert.ok(repairs.length > 0);
    assert.ok(after < before);
  });

  it("isAutoRepairableCrossConsistencyIssue cubre JWT y api_prefix", () => {
    assert.ok(
      isAutoRepairableCrossConsistencyIssue(
        "§6/§7: algoritmo JWT incoherente (§6=RS256, §7=HS256); §6 es SSOT.",
      ),
    );
    assert.ok(
      isAutoRepairableDeliveryGateWarning(
        'Manifest api_prefix "/api" no coincide con rutas dominantes (/api/v1).',
      ),
    );
  });
});
