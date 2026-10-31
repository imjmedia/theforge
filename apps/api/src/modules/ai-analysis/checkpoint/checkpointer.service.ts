import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";
import pg from "pg";
import { shouldStartBullmqWorkers } from "../../../common/bullmq-runtime.config.js";
import {
  ensureLangGraphCheckpointSchema,
  LANGGRAPH_CHECKPOINT_SCHEMA,
  purgeStaleLangGraphThreads,
  resolveCheckpointTtlMs,
} from "./langgraph-checkpoint-setup.util.js";

/** Primera purga tras el arranque (deja que el worker termine el recovery) y cadencia posterior. */
const PURGE_FIRST_DELAY_MS = 5 * 60_000;
const PURGE_INTERVAL_MS = 6 * 60 * 60_000;
const PURGE_ADVISORY_LOCK_KEY = 7_482_910_35;

/**
 * Crea y mantiene el PostgresSaver para LangGraph.
 * El DDL lo ejecuta `ensureLangGraphCheckpointSchema` (idempotente + advisory lock),
 * no `PostgresSaver.setup()` directo — evita race pg_type_typname_nsp_index en multi-réplica.
 */
@Injectable()
export class CheckpointerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CheckpointerService.name);

  private checkpointer: PostgresSaver | null = null;
  private setupPromise: Promise<void> | null = null;
  private purgeTimer: ReturnType<typeof setTimeout> | null = null;

  async onModuleInit(): Promise<void> {
    this.logger.log("[CheckpointerService] onModuleInit start");
    await this.getCheckpointer();
    // Solo el rol worker (o `all`) purga; el contenedor HTTP no toca el almacén de checkpoints.
    if (shouldStartBullmqWorkers() && process.env.DATABASE_URL?.trim()) {
      this.schedulePurge(PURGE_FIRST_DELAY_MS);
    }
    this.logger.log("[CheckpointerService] onModuleInit end");
  }

  onModuleDestroy(): void {
    if (this.purgeTimer) clearTimeout(this.purgeTimer);
    this.purgeTimer = null;
  }

  private schedulePurge(delayMs: number): void {
    this.purgeTimer = setTimeout(() => {
      void this.purgeStaleThreads()
        .catch((err: unknown) => {
          this.logger.warn(`purgeStaleThreads falló: ${err instanceof Error ? err.message : String(err)}`);
        })
        .finally(() => {
          if (this.purgeTimer) this.schedulePurge(PURGE_INTERVAL_MS);
        });
    }, delayMs);
    this.purgeTimer.unref?.();
  }

  /**
   * Elimina checkpoints LangGraph de hilos inactivos (último checkpoint y fila `AgentStateCheckpoint`
   * más viejos que `olderThanMs`; default `LANGGRAPH_CHECKPOINT_TTL_DAYS` = 14 días).
   * Como el checkpoint ya no se borra al terminar cada turno, esta purga evita el crecimiento sin límite.
   * Un advisory lock evita que varias réplicas worker purguen a la vez.
   */
  async purgeStaleThreads(olderThanMs: number = resolveCheckpointTtlMs()): Promise<{ purged: number }> {
    const url = process.env.DATABASE_URL?.trim();
    if (!url) return { purged: 0 };
    const pool = new pg.Pool({ connectionString: url, max: 1 });
    const client = await pool.connect();
    try {
      const lock = await client.query("SELECT pg_try_advisory_lock($1) AS ok", [PURGE_ADVISORY_LOCK_KEY]);
      if (!lock.rows[0]?.ok) return { purged: 0 };
      try {
        const { threadIds } = await purgeStaleLangGraphThreads(client, {
          olderThanMs,
          schema: LANGGRAPH_CHECKPOINT_SCHEMA,
        });
        if (threadIds.length > 0) {
          this.logger.log(
            `purgeStaleThreads: ${threadIds.length} hilo(s) inactivo(s) eliminados (> ${Math.round(olderThanMs / 86_400_000)}d): ${threadIds.slice(0, 20).join(", ")}${threadIds.length > 20 ? "…" : ""}`,
          );
        }
        return { purged: threadIds.length };
      } finally {
        await client.query("SELECT pg_advisory_unlock($1)", [PURGE_ADVISORY_LOCK_KEY]).catch(() => undefined);
      }
    } finally {
      client.release();
      await pool.end();
    }
  }

  /**
   * Devuelve el checkpointer; si no existe, lo crea desde DATABASE_URL y asegura el schema.
   */
  async getCheckpointer(): Promise<PostgresSaver | null> {
    const url = process.env.DATABASE_URL;
    if (!url?.trim()) {
      this.logger.log("[CheckpointerService] getCheckpointer: no DATABASE_URL, skipping.");
      return null;
    }
    if (this.checkpointer) {
      return this.checkpointer;
    }
    if (this.setupPromise) {
      await this.setupPromise;
      return this.checkpointer;
    }
    this.setupPromise = this.initCheckpointer(url);
    await this.setupPromise;
    this.setupPromise = null;
    return this.checkpointer;
  }

  private async initCheckpointer(connString: string): Promise<void> {
    this.logger.log("[CheckpointerService] initCheckpointer start");
    const trimmed = connString.trim();
    try {
      this.logger.log("[CheckpointerService] ensureLangGraphCheckpointSchema running...");
      await ensureLangGraphCheckpointSchema(trimmed);
      this.logger.log("LangGraph checkpoint schema ready (checkpoints tables).");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(
        `LangGraph checkpoint schema setup failed — DBGA / Paso 0 need tables checkpoints, checkpoint_blobs, checkpoint_writes. Run DB migrations (e.g. prisma migrate deploy). ${message}`,
      );
      throw err;
    }
    this.checkpointer = PostgresSaver.fromConnString(trimmed, {
      schema: "langgraph",
    });
    this.logger.log("[CheckpointerService] initCheckpointer end");
  }
}
