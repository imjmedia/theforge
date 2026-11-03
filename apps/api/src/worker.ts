/**
 * Proceso BullMQ dedicado (sin HTTP). Arrancar con THEFORGE_RUNTIME_ROLE=worker.
 */
import { Logger } from "@nestjs/common";
import { config } from "dotenv";
import { resolve } from "node:path";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module.js";
import {
  assertRedisConfiguredForProduction,
  resolveTheForgeRuntimeRole,
  shouldStartBullmqWorkers,
} from "./common/bullmq-runtime.config.js";
import { installBigIntJsonSupport } from "./common/json-bigint.js";

installBigIntJsonSupport();

config({ path: resolve(process.cwd(), "../../.env") });
config();

async function bootstrapWorker() {
  const logger = new Logger("WorkerBootstrap");
  assertRedisConfiguredForProduction();
  const role = resolveTheForgeRuntimeRole();
  if (!shouldStartBullmqWorkers()) {
    throw new Error(
      `THEFORGE_RUNTIME_ROLE=${role} does not start BullMQ workers; use worker role or all.`,
    );
  }

  logger.log(
    `[worker] build=${process.env.THEFORGE_BUILD_SHA ?? "dev"} role=${role} redis=${process.env.REDIS_URL ? "set" : "missing"}`,
  );
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ["error", "warn", "log"],
  });
  app.enableShutdownHooks();
  logger.log("[worker] BullMQ workers initialized; process will stay alive until SIGTERM.");
}

bootstrapWorker().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`[worker] failed to start: ${message}`);
  if (err instanceof Error && err.stack) console.error(err.stack);
  process.exit(1);
});
