import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DEFAULT_DESIGN_FIRST_ENABLED,
  DEFAULT_DESIGN_FIRST_FIGMA_MAX_NODES,
  DEFAULT_DESIGN_FIRST_MAX_IMAGES,
  DEFAULT_DESIGN_FIRST_MAX_SPEC_BYTES,
  DEFAULT_DESIGN_FIRST_VISION_BUDGET_MS,
  DEFAULT_FIGMA_API_BASE_URL,
  DEFAULT_TRUST_PROXY,
  KNOWN_INSECURE_JWT_SECRETS,
  MDD_NODE_BUDGET_MIN_MS,
  validateEnv,
} from "./env.schema.js";
import { readCompilerFirstConfigFromEnv } from "./compiler-first.config.js";

const STRONG_SECRET = "s".repeat(16) + "T".repeat(16) + "9";

const prodBase = {
  NODE_ENV: "production",
  JWT_SECRET: STRONG_SECRET,
  DATABASE_URL: "postgresql://u:p@db:5432/app",
  REDIS_URL: "redis://redis:6379",
  TOKEN_MASTER_KEYS: "v1:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
  CORS_ORIGINS: "https://app.example.com",
};

function messageOf(raw: Record<string, unknown>): string {
  try {
    validateEnv(raw);
  } catch (e) {
    return (e as Error).message;
  }
  assert.fail("se esperaba un error de validación");
}

describe("validateEnv", () => {
  it("development sin variables es válido y aplica defaults", () => {
    const env = validateEnv({});
    assert.equal(env.NODE_ENV, "development");
    assert.equal(env.THEFORGE_RUNTIME_ROLE, "all");
    assert.equal(env.JWT_EXPIRES_IN, "7d");
    assert.equal(env.JWT_SECRET, undefined);
  });

  it("producción completa es válida", () => {
    const env = validateEnv(prodBase);
    assert.equal(env.NODE_ENV, "production");
  });

  it("producción sin JWT_SECRET falla mencionando JWT_SECRET", () => {
    const { JWT_SECRET: _omit, ...raw } = prodBase;
    assert.match(messageOf(raw), /JWT_SECRET/);
  });

  it("producción con JWT_SECRET vacío falla", () => {
    assert.match(messageOf({ ...prodBase, JWT_SECRET: "   " }), /JWT_SECRET/);
  });

  it("producción con JWT_SECRET corto falla y no filtra el valor", () => {
    const short = "corto-pero-secreto";
    const msg = messageOf({ ...prodBase, JWT_SECRET: short });
    assert.match(msg, /JWT_SECRET/);
    assert.ok(!msg.includes(short));
  });

  it("producción con literal conocido falla", () => {
    for (const known of KNOWN_INSECURE_JWT_SECRETS) {
      const msg = messageOf({ ...prodBase, JWT_SECRET: known });
      assert.match(msg, /JWT_SECRET/);
      assert.ok(!msg.includes(known));
    }
  });

  it("literal conocido de 32+ caracteres se rechaza por ser conocido", () => {
    const known = "local-dev-jwt-secret-replace-in-dokploy";
    assert.ok(known.length >= 32);
    assert.match(messageOf({ ...prodBase, JWT_SECRET: known }), /desarrollo conocido/);
  });

  it("producción sin TOKEN_MASTER_KEYS falla y el mensaje no contiene el valor", () => {
    const { TOKEN_MASTER_KEYS: _t, ...sinKeys } = prodBase;
    assert.match(messageOf(sinKeys), /TOKEN_MASTER_KEYS/);
  });

  it("producción sin DATABASE_URL o REDIS_URL falla", () => {
    const { DATABASE_URL: _d, ...sinDb } = prodBase;
    const { REDIS_URL: _r, ...sinRedis } = prodBase;
    assert.match(messageOf(sinDb), /DATABASE_URL/);
    assert.match(messageOf(sinRedis), /REDIS_URL/);
  });

  it("producción rol worker sin CORS_ORIGINS es válida", () => {
    const { CORS_ORIGINS: _c, ...raw } = prodBase;
    const env = validateEnv({ ...raw, THEFORGE_RUNTIME_ROLE: "worker" });
    assert.equal(env.THEFORGE_RUNTIME_ROLE, "worker");
  });

  it("producción rol http o all sin CORS_ORIGINS falla", () => {
    const { CORS_ORIGINS: _c, ...raw } = prodBase;
    assert.match(messageOf({ ...raw, THEFORGE_RUNTIME_ROLE: "http" }), /CORS_ORIGINS/);
    assert.match(messageOf(raw), /CORS_ORIGINS/);
    assert.match(messageOf({ ...raw, CORS_ORIGINS: " , " }), /CORS_ORIGINS/);
  });

  it("TRUST_PROXY: ausente o vacío vale 1; acepta enteros >= 0 (también como texto)", () => {
    assert.equal(DEFAULT_TRUST_PROXY, 1);
    assert.equal(validateEnv({}).TRUST_PROXY, 1);
    assert.equal(validateEnv({ TRUST_PROXY: "  " }).TRUST_PROXY, 1);
    assert.equal(validateEnv({ TRUST_PROXY: "0" }).TRUST_PROXY, 0);
    assert.equal(validateEnv({ TRUST_PROXY: "2" }).TRUST_PROXY, 2);
    assert.equal(validateEnv({ ...prodBase, TRUST_PROXY: "3" }).TRUST_PROXY, 3);
  });

  it("TRUST_PROXY: negativo, decimal o no numérico falla mencionando la variable", () => {
    for (const bad of ["-1", "1.5", "abc"]) {
      assert.match(messageOf({ TRUST_PROXY: bad }), /TRUST_PROXY/);
    }
  });

  it("rol inválido falla", () => {
    assert.match(messageOf({ THEFORGE_RUNTIME_ROLE: "otro" }), /THEFORGE_RUNTIME_ROLE/);
  });

  it("el rol es insensible a mayúsculas y espacios", () => {
    assert.equal(validateEnv({ THEFORGE_RUNTIME_ROLE: " Worker " }).THEFORGE_RUNTIME_ROLE, "worker");
  });

  it("NODE_ENV inválido falla", () => {
    assert.match(messageOf({ NODE_ENV: "staging" }), /NODE_ENV/);
  });

  it("passthrough conserva variables extra", () => {
    const env = validateEnv({ OPENAI_API_KEY: "x", MDD_BULLMQ_CONCURRENCY: "3" }) as Record<string, unknown>;
    assert.equal(env.OPENAI_API_KEY, "x");
    assert.equal(env.MDD_BULLMQ_CONCURRENCY, "3");
  });
});

describe("validateEnv: presupuestos LANGGRAPH_MDD_*_BUDGET_MS", () => {
  const BUDGETS = [
    "LANGGRAPH_MDD_AUDITOR_NODE_BUDGET_MS",
    "LANGGRAPH_MDD_MANAGER_TURN_BUDGET_MS",
    "LANGGRAPH_MDD_CRITIC_BUDGET_MS",
    "LANGGRAPH_MDD_CROSS_CONSISTENCY_BUDGET_MS",
  ];

  it("un presupuesto de 10000 ms es inválido y el mensaje nombra la variable, sin el valor", () => {
    for (const name of BUDGETS) {
      const msg = messageOf({ [name]: "10000" });
      assert.match(msg, new RegExp(name));
      assert.match(msg, /debe ser un entero ≥ 15000 ms/);
    }
  });

  it("un valor no entero o no numérico también falla", () => {
    assert.match(messageOf({ LANGGRAPH_MDD_CRITIC_BUDGET_MS: "abc" }), /LANGGRAPH_MDD_CRITIC_BUDGET_MS/);
    assert.match(messageOf({ LANGGRAPH_MDD_CRITIC_BUDGET_MS: "15000.5" }), /entero/);
  });

  it("15000 ms (el mínimo) y los presupuestos ausentes o vacíos son válidos", () => {
    const env = validateEnv({ LANGGRAPH_MDD_MANAGER_TURN_BUDGET_MS: "15000", LANGGRAPH_MDD_CRITIC_BUDGET_MS: "" });
    assert.equal(env.LANGGRAPH_MDD_MANAGER_TURN_BUDGET_MS, 15000);
    assert.equal(env.LANGGRAPH_MDD_CRITIC_BUDGET_MS, undefined);
    assert.equal(env.LANGGRAPH_MDD_AUDITOR_NODE_BUDGET_MS, undefined);
  });
});

describe("validateEnv: Design-First y COMPILER_FIRST", () => {
  it("aplica defaults de límites y flag apagado (CL-21)", () => {
    const env = validateEnv({});
    assert.equal(env.DESIGN_FIRST_ENABLED, DEFAULT_DESIGN_FIRST_ENABLED);
    assert.equal(env.FIGMA_API_BASE_URL, DEFAULT_FIGMA_API_BASE_URL);
    assert.equal(env.DESIGN_FIRST_FIGMA_MAX_NODES, DEFAULT_DESIGN_FIRST_FIGMA_MAX_NODES);
    assert.equal(env.DESIGN_FIRST_MAX_IMAGES, DEFAULT_DESIGN_FIRST_MAX_IMAGES);
    assert.equal(env.DESIGN_FIRST_MAX_SPEC_BYTES, DEFAULT_DESIGN_FIRST_MAX_SPEC_BYTES);
    assert.equal(env.DESIGN_FIRST_VISION_BUDGET_MS, DEFAULT_DESIGN_FIRST_VISION_BUDGET_MS);
  });

  it("rechaza presupuestos Design-First menores a 15000 ms", () => {
    for (const name of ["DESIGN_FIRST_VISION_BUDGET_MS", "DESIGN_FIRST_DATANEEDS_BUDGET_MS"]) {
      const msg = messageOf({ [name]: "14999" });
      assert.match(msg, new RegExp(name));
      assert.match(msg, /15000/);
    }
    const ok = validateEnv({
      DESIGN_FIRST_VISION_BUDGET_MS: String(MDD_NODE_BUDGET_MIN_MS),
      DESIGN_FIRST_DATANEEDS_BUDGET_MS: String(MDD_NODE_BUDGET_MIN_MS),
    });
    assert.equal(ok.DESIGN_FIRST_VISION_BUDGET_MS, MDD_NODE_BUDGET_MIN_MS);
    assert.equal(ok.DESIGN_FIRST_DATANEEDS_BUDGET_MS, MDD_NODE_BUDGET_MIN_MS);
  });

  it("FIGMA_API_BASE_URL exige https", () => {
    assert.match(messageOf({ FIGMA_API_BASE_URL: "http://api.figma.com/v1" }), /FIGMA_API_BASE_URL/);
    assert.match(messageOf({ FIGMA_API_BASE_URL: "http://api.figma.com/v1" }), /https/);
    assert.equal(
      validateEnv({ FIGMA_API_BASE_URL: "https://api.figma.com/v1" }).FIGMA_API_BASE_URL,
      "https://api.figma.com/v1",
    );
  });

  it("rechaza enteros no positivos en límites Design-First", () => {
    for (const name of [
      "DESIGN_FIRST_FIGMA_MAX_NODES",
      "DESIGN_FIRST_MAX_IMAGES",
      "DESIGN_FIRST_MAX_SPEC_BYTES",
      "DESIGN_FIRST_FIGMA_TIMEOUT_MS",
    ]) {
      assert.match(messageOf({ [name]: "0" }), new RegExp(name));
    }
  });

  it("COMPILER_FIRST_* conserva la semántica heredada vía helper", () => {
    const defaults = readCompilerFirstConfigFromEnv(validateEnv({}));
    assert.equal(defaults.useCompilerFirstBlueprint, false);
    assert.equal(defaults.useCompilerFirstApiContracts, true);
    assert.equal(defaults.useCompilerFirstLogicFlows, true);
    assert.equal(defaults.useCompilerFirstInfra, true);

    const allOff = readCompilerFirstConfigFromEnv(
      validateEnv({
        COMPILER_FIRST_BLUEPRINT: "true",
        COMPILER_FIRST_API_CONTRACTS: "false",
        COMPILER_FIRST_LOGIC_FLOWS: "false",
        COMPILER_FIRST_INFRA: "false",
      }),
    );
    assert.equal(allOff.useCompilerFirstBlueprint, true);
    assert.equal(allOff.useCompilerFirstApiContracts, false);
    assert.equal(allOff.useCompilerFirstLogicFlows, false);
    assert.equal(allOff.useCompilerFirstInfra, false);
  });
});
