import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  checkArchitectureVsMdd,
  checkTasksEntityMigrations,
  checkTasksBlueprintPhases,
  checkSchedulerConsistency,
  checkResearchGapsInTasks,
  checkEventContractsCoverage,
  checkLlmJsonSchemas,
  collectSddPrecisionGaps,
  precisionGapsForPostPassRetry,
} from "./sdd-precision-checks.util.js";

const FIX = join(__dirname, "__fixtures__/ia-trading-gaps");
const mdd = readFileSync(join(FIX, "mdd-snippet.md"), "utf8");
const research = readFileSync(join(FIX, "research-snippet.md"), "utf8");
const blueprint = readFileSync(join(FIX, "blueprint-phases-snippet.md"), "utf8");

describe("sdd-precision-checks.util", () => {
  it("checkArchitectureVsMdd flags missing Alpha Engine module", () => {
    const arch = "# Arquitectura\n\nmodules/auth/\nmodules/recommendations/\n";
    const result = checkArchitectureVsMdd(mdd, arch);
    assert.equal(result.ok, false);
    assert.ok(result.gaps.some((g) => /Alpha Engine/i.test(g)));
  });

  it("checkTasksEntityMigrations flags missing signal_id migration", () => {
    const tasks =
      "- [ ] Implementar endpoint POST /api/v1/recommendations según contrato API\n";
    const result = checkTasksEntityMigrations(mdd, tasks);
    assert.equal(result.ok, false);
    assert.ok(result.gaps.some((g) => /signal_id/i.test(g)));
  });

  it("checkTasksBlueprintPhases flags missing phase sections", () => {
    const tasks = "## User Story: US-005 Generación de Recomendación\n- [ ] task\n";
    const result = checkTasksBlueprintPhases(blueprint, tasks);
    assert.equal(result.ok, false);
  });

  it("checkSchedulerConsistency detects CST vs UTC conflict", () => {
    const lf = "Scheduler 22:00 CST martes/jueves";
    const us = "cron 08:00 UTC lunes";
    const result = checkSchedulerConsistency(mdd, lf, us);
    assert.equal(result.ok, false);
  });

  it("checkResearchGapsInTasks flags uncovered open gap", () => {
    const tasks = "- [ ] Crear auth module\n";
    const result = checkResearchGapsInTasks(research, tasks, mdd);
    assert.equal(result.ok, false);
  });

  it("collectSddPrecisionGaps and precisionGapsForPostPassRetry", () => {
    const gaps = collectSddPrecisionGaps({
      mdd,
      architecture: "# Arquitectura\n\nmodules/auth/\nmodules/recommendations/\n",
      blueprint,
      tasks: "- [ ] Implementar endpoint POST /api/v1/recommendations según contrato\n",
      logicFlows: "22:00 CST",
      userStories: "08:00 UTC lunes",
      phase0Summary: research,
    });
    assert.ok(gaps.length > 0);
    const flags = precisionGapsForPostPassRetry(gaps);
    assert.equal(flags.retryArchitecture, true);
    assert.equal(flags.retryLogicFlows, true);
    assert.ok(flags.retryTasks || flags.retryArchitecture);
  });

  it("checkEventContractsCoverage skips EDA gaps when MDD §2 is BullMQ", () => {
    const mddBull = "## 2. Stack\nBullMQ + Redis.\n";
    const blueprintEda = "## Blueprint\nEvent-driven outbox pattern.\n";
    const result = checkEventContractsCoverage(mddBull, blueprintEda, "", "");
    assert.equal(result.ok, true);
  });

  it("checkLlmJsonSchemas skips KMS-like REST JSON when MDD has no LLM scope", () => {
    const mddKms = `## 1. Alcance
Sistema de gestión de conocimiento (KMS). API REST para documentos y auditoría.
## 2. Stack
NestJS + PostgreSQL + Redis cache.
`;
    const ucKms = `## Caso de Uso 1: Exportar auditoría
El administrador solicita exportación de audit logs en formato JSON.
La API devuelve respuesta JSON con metadata del documento consultado.
## Caso de Uso 2: Consultar documento
GET /api/v1/documents/{id} responde application/json con el contenido indexado.
`;
    const result = checkLlmJsonSchemas(ucKms, "", mddKms);
    assert.equal(result.ok, true);
    assert.equal(result.gaps.length, 0);
  });

  it("checkLlmJsonSchemas flags explicit LLM structured output without Zod annex", () => {
    const mddLlm = `## 1. Alcance
Motor de recomendaciones con salida estructurada del modelo.
## 2. Stack
LLM Orchestrator + NestJS + PostgreSQL.
`;
    const ucLlm = `## Caso de Uso 1: Generar recomendación
El LLM devuelve JSON estructurado con sustancia económica y justificación técnica del activo.
El analista valida la respuesta estructurada antes de publicar la señal.
`;
    const result = checkLlmJsonSchemas(ucLlm, "", mddLlm);
    assert.equal(result.ok, false);
    assert.ok(result.gaps.some((g) => /\[LLM JSON\]/i.test(g)));
  });

  it("checkLlmJsonSchemas passes when UC includes Schema Zod annex", () => {
    const mddLlm = `## 1. Alcance
Recomendaciones IA con JSON schema validable.
## 2. Stack
LLM Orchestrator + NestJS.
`;
    const ucWithZod = `## Caso de Uso 1: Generar recomendación
El output del modelo es JSON estructurado con sustancia económica.

### Schema Zod
\`\`\`typescript
export const RecommendationSchema = z.object({
  ticker: z.string(),
  rationale: z.string(),
});
\`\`\`
`;
    const result = checkLlmJsonSchemas(ucWithZod, "", mddLlm);
    assert.equal(result.ok, true);
    assert.equal(result.gaps.length, 0);
  });
});
