import { Logger } from "@nestjs/common";
import type { RunnableConfig } from "@langchain/core/runnables";
import type {
  ChannelVersions,
  Checkpoint,
  CheckpointMetadata,
  CheckpointTuple,
  PendingWrite,
} from "@langchain/langgraph-checkpoint";
import type { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";
import type { BaseCheckpointSaver } from "@langchain/langgraph/web";
import type { PrismaService } from "../../../prisma/prisma.service.js";

/** Claves en `config.configurable` para fencing del checkpoint MDD (ADR 0004, D-6). */
export const MDD_LEASE_FENCE_CONFIG_KEY = "mddLeaseFence";
export const MDD_STAGE_ID_CONFIG_KEY = "mddStageId";

export function parseConfigFence(configurable: Record<string, unknown> | undefined): number | undefined {
  const raw = configurable?.[MDD_LEASE_FENCE_CONFIG_KEY];
  if (raw === undefined || raw === null || raw === "") return undefined;
  const n = typeof raw === "number" ? raw : Number(raw);
  return Number.isFinite(n) ? n : undefined;
}

export function parseConfigStageId(configurable: Record<string, unknown> | undefined): string | undefined {
  const raw = configurable?.[MDD_STAGE_ID_CONFIG_KEY];
  const s = typeof raw === "string" ? raw.trim() : "";
  return s || undefined;
}

/**
 * true si la etapa ya fue reclamada por un turno con fence mayor que el del checkpoint en curso.
 */
export async function isCheckpointWriteStale(
  prisma: Pick<PrismaService, "stage">,
  stageId: string | undefined,
  fence: number | undefined,
): Promise<boolean> {
  if (!stageId || fence === undefined) return false;
  const stage = await prisma.stage.findUnique({
    where: { id: stageId },
    select: { mddLeaseFence: true },
  });
  if (stage?.mddLeaseFence == null) return false;
  return stage.mddLeaseFence > BigInt(fence);
}

export function buildMddGraphConfigurable(
  threadId: string,
  opts?: { stageId?: string | null; fence?: number },
): Record<string, string> {
  const configurable: Record<string, string> = { thread_id: threadId };
  const stageId = opts?.stageId?.trim() ?? "";
  if (stageId) configurable[MDD_STAGE_ID_CONFIG_KEY] = stageId;
  if (opts?.fence !== undefined) configurable[MDD_LEASE_FENCE_CONFIG_KEY] = String(opts.fence);
  return configurable;
}

export type StaleMddCheckpointDiscarder = {
  deleteThread: (threadId: string) => Promise<void>;
};

/**
 * Si el turno lleva un fence menor que el de la etapa, purga el hilo LangGraph (estado zombi).
 * Devuelve true si se descartó el checkpoint.
 */
export async function discardStaleMddCheckpointIfNeeded(
  checkpointer: StaleMddCheckpointDiscarder,
  prisma: Pick<PrismaService, "stage">,
  config: { configurable?: Record<string, unknown> },
  log: Pick<Logger, "warn">,
): Promise<boolean> {
  const configurable = config.configurable;
  const fence = parseConfigFence(configurable);
  const stageId = parseConfigStageId(configurable);
  const threadId = typeof configurable?.thread_id === "string" ? configurable.thread_id.trim() : "";
  if (!threadId || !(await isCheckpointWriteStale(prisma, stageId, fence))) return false;
  log.warn(
    `[FencedCheckpoint] hilo ${threadId} descartado: fence del turno (${fence}) < fence de la etapa ${stageId ?? "?"}`,
  );
  await checkpointer.deleteThread(threadId);
  return true;
}

/**
 * Envuelve PostgresSaver: en `put` / `putWrites` rechaza escrituras si `Stage.mddLeaseFence` > fence del turno.
 */
export class FencedCheckpointSaver implements BaseCheckpointSaver {
  private readonly logger = new Logger(FencedCheckpointSaver.name);

  readonly serde: PostgresSaver["serde"];

  constructor(
    private readonly inner: PostgresSaver,
    private readonly prisma: Pick<PrismaService, "stage">,
  ) {
    this.serde = inner.serde;
  }

  get(config: RunnableConfig): Promise<Checkpoint | undefined> {
    return this.inner.get(config);
  }

  getTuple(config: RunnableConfig): Promise<CheckpointTuple | undefined> {
    return this.inner.getTuple(config);
  }

  list(config: RunnableConfig, options?: Parameters<PostgresSaver["list"]>[1]): AsyncGenerator<CheckpointTuple> {
    return this.inner.list(config, options);
  }

  getNextVersion(current: number | undefined, channel?: unknown): number {
    return this.inner.getNextVersion(current, channel as never);
  }

  end(): Promise<void> {
    return this.inner.end();
  }

  deleteThread(threadId: string): Promise<void> {
    return this.inner.deleteThread(threadId);
  }

  private async shouldSkipWrite(config: RunnableConfig): Promise<boolean> {
    const fence = parseConfigFence(config.configurable as Record<string, unknown> | undefined);
    const stageId = parseConfigStageId(config.configurable as Record<string, unknown> | undefined);
    if (fence === undefined) return false;
    const stale = await isCheckpointWriteStale(this.prisma, stageId, fence);
    if (stale) {
      const threadId = config.configurable?.thread_id ?? "?";
      this.logger.warn(
        `[FencedCheckpoint] put omitido thread=${threadId} stage=${stageId ?? ""} fence=${fence} (etapa reclamada por turno más reciente)`,
      );
    }
    return stale;
  }

  async put(
    config: RunnableConfig,
    checkpoint: Checkpoint,
    metadata: CheckpointMetadata,
    newVersions: ChannelVersions,
  ): Promise<RunnableConfig> {
    if (await this.shouldSkipWrite(config)) {
      const tuple = await this.inner.getTuple(config);
      if (tuple?.config) return tuple.config;
      return config;
    }
    return this.inner.put(config, checkpoint, metadata, newVersions);
  }

  async putWrites(config: RunnableConfig, writes: PendingWrite[], taskId: string): Promise<void> {
    if (await this.shouldSkipWrite(config)) return;
    await this.inner.putWrites(config, writes, taskId);
  }
}
