/**
 * @fileoverview Punto de entrada de **@theforge/api** (NestJS). Carga variables de entorno desde la raíz del
 * monorepo y locales, ajusta límites de `EventEmitter`, valida correo OTP en producción, aplica CORS estricto,
 * body JSON/urlencoded (hasta 50mb para contenido MDD) y escucha en `PORT` (default 3000).
 *
 * @copyright 2026 Jorge Correa
 * @license Apache-2.0
 * @author Jorge Correa <jcorrea@e-personal.net>
 */
import { Logger } from "@nestjs/common";
import { config } from "dotenv";
import * as dns from "node:dns";
import { resolve } from "node:path";
import { ConfigService } from "@nestjs/config";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module.js";
import { DEFAULT_TRUST_PROXY } from "./config/env.schema.js";
import { ModelsUnavailableExceptionFilter } from "./common/filters/models-unavailable.exception-filter.js";
import {
  assertRedisConfiguredForProduction,
  resolveTheForgeRuntimeRole,
  shouldStartHttpServer,
} from "./common/bullmq-runtime.config.js";

// SMTP (p. ej. Gmail): priorizar IPv4 evita timeouts cuando IPv6 no llega al servidor de correo.
if (typeof dns.setDefaultResultOrder === "function") {
  dns.setDefaultResultOrder("ipv4first");
}

// Cargar .env de la raíz del repo (turbo ejecuta con cwd = apps/api) y luego local
config({ path: resolve(process.cwd(), "../../.env") });
config();

// Evitar MaxListenersExceededWarning cuando streams/LLM añaden múltiples abort listeners
import { EventEmitter } from "node:events";
import { json, urlencoded } from "express";

EventEmitter.defaultMaxListeners = 20;
if (typeof process.setMaxListeners === "function") process.setMaxListeners(20);

function corsOriginsFromEnv(): string[] {
  const raw = process.env.CORS_ORIGINS?.trim();
  const list = raw
    ? raw
        .split(",")
        .map((o) => o.trim())
        .filter(Boolean)
    : [];
  if (list.length > 0) return list;
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "CORS_ORIGINS is required in production (lista separada por comas, ej. https://app.tudominio.com)",
    );
  }
  return ["http://localhost:5173", "http://127.0.0.1:5173"];
}

async function bootstrap() {
  const logger = new Logger("Bootstrap");
  assertRedisConfiguredForProduction();
  const role = resolveTheForgeRuntimeRole();
  if (!shouldStartHttpServer()) {
    throw new Error(
      `THEFORGE_RUNTIME_ROLE=${role} does not start the HTTP server; run worker.js for BullMQ consumers.`,
    );
  }
  logger.log(
    `[bootstrap] build=${process.env.THEFORGE_BUILD_SHA ?? "dev"} role=${role} di=forwardRef`,
  );
  logger.log("[bootstrap] Creating Nest application...");
  const app = await NestFactory.create(AppModule, {
    logger: ["error", "warn", "log", "debug", "verbose"],
  });
  logger.log("[bootstrap] Nest application created.");
  app.enableShutdownHooks();
  // Proxies inversos de confianza (`TRUST_PROXY`, default 1 = Traefik/nginx): `req.ip` toma la IP real del cliente (rate limit de auth).
  const trustProxy = app.get(ConfigService).get<number>("TRUST_PROXY") ?? DEFAULT_TRUST_PROXY;
  (app.getHttpAdapter().getInstance() as { set: (k: string, v: unknown) => unknown }).set("trust proxy", trustProxy);
  app.useGlobalFilters(new ModelsUnavailableExceptionFilter());
  const origins = corsOriginsFromEnv();
  app.enableCors({ origin: origins, credentials: true });

  // Increase body size limit for MDD content
  app.use(json({ limit: "50mb" }));
  app.use(urlencoded({ extended: true, limit: "50mb" }));

  // Timeout largo para pipelines de generación MDD (hasta 10 min)
  const httpServer = app.getHttpServer();
  httpServer.timeout = parseInt(process.env.HTTP_SERVER_TIMEOUT_MS ?? "600000", 10);

  const port = process.env.PORT ?? 3000;
  logger.log("[bootstrap] Initializing modules (onModuleInit hooks)...");
  await app.init();
  logger.log("[bootstrap] Modules initialized.");
  logger.log(`[bootstrap] Starting HTTP server on port ${port}...`);
  await app.listen(port);
  logger.log(`[bootstrap] API listening on port ${port}.`);
}

const bootstrapWatchdog = setTimeout(() => {
  console.error("[bootstrap-watchdog] API bootstrap did not complete within 90s; forcing exit.");
  process.exit(1);
}, 90_000);

bootstrap().then(() => {
  clearTimeout(bootstrapWatchdog);
}).catch((err: unknown) => {
  clearTimeout(bootstrapWatchdog);
  const message = err instanceof Error ? err.message : String(err);
  console.error(`[bootstrap] API failed to start: ${message}`);
  if (err instanceof Error && err.stack) console.error(err.stack);
  process.exit(1);
});
