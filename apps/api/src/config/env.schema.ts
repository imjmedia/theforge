/**
 * Validación tipada del entorno (zod) para `ConfigModule.forRoot({ validate })`.
 *
 * Fuente única de las reglas de arranque: en producción exige `JWT_SECRET` robusto, `DATABASE_URL`,
 * `REDIS_URL`, `TOKEN_MASTER_KEYS` y, si el proceso sirve HTTP, `CORS_ORIGINS`. Fuera de producción todo es opcional.
 * `TRUST_PROXY` (entero ≥ 0, default 1) fija cuántos proxies inversos de confianza hay delante de la API.
 * Falla cerrado: un entorno inválido aborta el arranque con un mensaje que lista las variables
 * (nunca sus valores).
 */
import { z } from "zod";

/** Secretos JWT conocidos/de desarrollo que jamás deben usarse en producción. */
export const KNOWN_INSECURE_JWT_SECRETS: readonly string[] = [
  "dev-only-insecure-jwt-secret",
  "local-dev-jwt-secret-replace-in-dokploy",
];

/** Longitud mínima del `JWT_SECRET` en producción. */
export const JWT_SECRET_MIN_LENGTH = 32;

/** Valores reales de `THEFORGE_RUNTIME_ROLE` (ver `common/bullmq-runtime.config.ts`). */
export const RUNTIME_ROLES = ["all", "http", "worker"] as const;

/** Saltos de proxy inverso de confianza por defecto (Traefik/nginx delante de la API). */
export const DEFAULT_TRUST_PROXY = 1;

/** Cadena vacía o solo espacios se trata como variable ausente. */
const emptyToUndefined = (value: unknown): unknown =>
  typeof value === "string" && value.trim() === "" ? undefined : value;

const optionalString = z.preprocess(emptyToUndefined, z.string().optional());

const runtimeRole = z.preprocess(
  (value) => {
    const v = emptyToUndefined(value);
    return typeof v === "string" ? v.trim().toLowerCase() : v;
  },
  z.enum(RUNTIME_ROLES).default("all"),
);

/** `TRUST_PROXY`: número de proxies de confianza (entero ≥ 0). 0 = no confiar en `X-Forwarded-For`. */
const trustProxy = z.preprocess(
  emptyToUndefined,
  z.coerce
    .number({ invalid_type_error: "debe ser un entero mayor o igual a 0" })
    .int("debe ser un entero mayor o igual a 0")
    .min(0, "debe ser un entero mayor o igual a 0")
    .default(DEFAULT_TRUST_PROXY),
);

/** `THREAD_RUN_LOCK_TTL_MS`: TTL del lease por hilo del harness MDD (entero ≥ 1000; default 1 200 000 = 20 min). */
const threadRunLockTtlMs = z.preprocess(
  emptyToUndefined,
  z.coerce
    .number({ invalid_type_error: "debe ser un entero mayor o igual a 1000 (ms)" })
    .int("debe ser un entero mayor o igual a 1000 (ms)")
    .min(1000, "debe ser un entero mayor o igual a 1000 (ms)")
    .optional(),
);

/** Mínimo de cada presupuesto wall-clock del pipeline MDD (ms): por debajo no cabe ni un intento. */
export const MDD_NODE_BUDGET_MIN_MS = 15_000;

/** `LANGGRAPH_MDD_*_BUDGET_MS`: entero ≥ 15 000 ms (opcional; el default vive en `ai-analysis/utils/mdd-llm-timeout.util.ts`). */
const mddNodeBudgetMs = z.preprocess(
  emptyToUndefined,
  z.coerce
    .number({ invalid_type_error: `debe ser un entero ≥ ${MDD_NODE_BUDGET_MIN_MS} ms` })
    .int(`debe ser un entero ≥ ${MDD_NODE_BUDGET_MIN_MS} ms`)
    .min(MDD_NODE_BUDGET_MIN_MS, `debe ser un entero ≥ ${MDD_NODE_BUDGET_MIN_MS} ms`)
    .optional(),
);

export const envSchema = z
  .object({
    NODE_ENV: z.preprocess(emptyToUndefined, z.enum(["development", "test", "production"]).default("development")),
    THEFORGE_RUNTIME_ROLE: runtimeRole,
    JWT_SECRET: optionalString,
    JWT_EXPIRES_IN: z.preprocess(emptyToUndefined, z.string().default("7d")),
    DATABASE_URL: optionalString,
    REDIS_URL: optionalString,
    TOKEN_MASTER_KEYS: optionalString,
    CORS_ORIGINS: optionalString,
    TRUST_PROXY: trustProxy,
    THREAD_RUN_LOCK_TTL_MS: threadRunLockTtlMs,
    LANGGRAPH_MDD_AUDITOR_NODE_BUDGET_MS: mddNodeBudgetMs,
    LANGGRAPH_MDD_MANAGER_TURN_BUDGET_MS: mddNodeBudgetMs,
    LANGGRAPH_MDD_CRITIC_BUDGET_MS: mddNodeBudgetMs,
    LANGGRAPH_MDD_CROSS_CONSISTENCY_BUDGET_MS: mddNodeBudgetMs,
  })
  .passthrough()
  .superRefine((env, ctx) => {
    if (env.NODE_ENV !== "production") return;

    const fail = (
      name: "DATABASE_URL" | "REDIS_URL" | "CORS_ORIGINS" | "JWT_SECRET" | "TOKEN_MASTER_KEYS",
      message: string,
    ) =>
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: [name], message });

    const secret = env.JWT_SECRET?.trim();
    if (!secret) {
      fail("JWT_SECRET", "es obligatoria en producción");
    } else if (secret.length < JWT_SECRET_MIN_LENGTH) {
      fail("JWT_SECRET", `debe tener al menos ${JWT_SECRET_MIN_LENGTH} caracteres`);
    } else if (KNOWN_INSECURE_JWT_SECRETS.includes(secret)) {
      fail("JWT_SECRET", "no puede ser un valor de desarrollo conocido");
    }

    if (!env.DATABASE_URL?.trim()) fail("DATABASE_URL", "es obligatoria en producción");
    if (!env.REDIS_URL?.trim()) fail("REDIS_URL", "es obligatoria en producción (BullMQ)");
    if (!env.TOKEN_MASTER_KEYS?.trim()) {
      fail("TOKEN_MASTER_KEYS", "es obligatoria en producción (cifrado de claves de proveedores)");
    }

    const servesHttp = env.THEFORGE_RUNTIME_ROLE === "all" || env.THEFORGE_RUNTIME_ROLE === "http";
    const hasCors = (env.CORS_ORIGINS ?? "")
      .split(",")
      .some((origin) => origin.trim().length > 0);
    if (servesHttp && !hasCors) {
      fail("CORS_ORIGINS", "es obligatoria en producción cuando el rol sirve HTTP (lista separada por comas)");
    }
  });

export type Env = z.infer<typeof envSchema>;

/**
 * Valida el entorno crudo. Para `ConfigModule.forRoot({ validate: validateEnv })`.
 * Lanza `Error` en español listando las variables inválidas, sin imprimir sus valores.
 */
export function validateEnv(raw: Record<string, unknown>): Env {
  const result = envSchema.safeParse(raw);
  if (result.success) return result.data;

  const lines = result.error.issues.map((issue) => {
    const name = issue.path.join(".") || "(entorno)";
    return `  - ${name}: ${issue.message}`;
  });
  throw new Error(`Configuración de entorno inválida:\n${lines.join("\n")}`);
}
