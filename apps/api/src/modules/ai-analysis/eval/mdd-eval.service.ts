/**
 * @fileoverview Servicio del eval de MDDs para la web (Ajustes → Evaluación MDD). Arma los DTOs del
 * contrato `@theforge/shared-types/mdd-eval-api` a partir de los casos, de `run.json` + `summary.json`
 * en disco y del estado vivo de la cola, y orquesta alta / cancelación de corridas.
 */

import { existsSync, readFileSync } from "node:fs";
import {
  BadRequestException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import {
  DEFAULT_PROJECT_GROUP_ID,
  mddEvalStartRunSchema,
  type MddEvalCaseDetailDto,
  type MddEvalCaseSummaryDto,
  type MddEvalCompareDto,
  type MddEvalRunDto,
} from "@theforge/shared-types";
import { getRequestUserId } from "../../../common/request-user.store.js";
import { PrismaService } from "../../../prisma/prisma.service.js";
import { AIFactory } from "../../ai/ai.factory.js";
import { loadMddEvalCases } from "./mdd-eval-cases.util.js";
import {
  buildMddEvalCompareDto,
  buildMddEvalRunDto,
  deriveMddEvalRunStatus,
  toCaseDetailDto,
  toCaseSummaryDto,
  type MddEvalLiveState,
} from "./mdd-eval-dto.util.js";
import { MddEvalQueueService } from "./mdd-eval-queue.service.js";
import {
  MddEvalRunStore,
  buildMddEvalRunId,
  isSafeMddEvalId,
  metaFromSummary,
  type MddEvalRunMeta,
} from "./mdd-eval-run-store.util.js";
import { readGitSha } from "./mdd-eval-runner.js";
import type { MddEvalCase, MddEvalSummary } from "./mdd-eval.types.js";

const MAX_LISTED_RUNS = 50;

@Injectable()
export class MddEvalService {
  /** Sustituibles en tests. */
  store = new MddEvalRunStore();
  casesDir?: string;
  now: () => Date = () => new Date();

  constructor(
    private readonly prisma: PrismaService,
    private readonly aiFactory: AIFactory,
    private readonly queue: MddEvalQueueService,
  ) {}

  // ── Casos ───────────────────────────────────────────────────────────────

  private loadCases(): MddEvalCase[] {
    try {
      return loadMddEvalCases(this.casesDir);
    } catch (error) {
      throw new ServiceUnavailableException(
        `No se pudieron cargar los casos del eval: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  listCases(): MddEvalCaseSummaryDto[] {
    return this.loadCases().map(toCaseSummaryDto);
  }

  getCase(id: string): MddEvalCaseDetailDto {
    const found = this.loadCases().find((c) => c.id === id);
    if (!found) throw new NotFoundException(`Caso de eval no encontrado: ${id}`);
    return toCaseDetailDto(found);
  }

  // ── Alta de corridas ────────────────────────────────────────────────────

  /** Valida el body, comprueba grupo y proveedor LLM del solicitante, persiste `run.json` y encola. */
  async startRun(body: unknown): Promise<MddEvalRunDto> {
    const parsed = mddEvalStartRunSchema.safeParse(body ?? {});
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    const input = parsed.data;
    const userId = getRequestUserId();

    const allCases = this.loadCases();
    const requested = [...new Set(input.caseIds ?? [])];
    const unknown = requested.filter((id) => !allCases.some((c) => c.id === id));
    if (unknown.length > 0) {
      throw new BadRequestException(`Casos desconocidos: ${unknown.join(", ")}`);
    }
    const caseIds = requested.length > 0 ? requested : allCases.map((c) => c.id);
    if (caseIds.length === 0) throw new BadRequestException("No hay casos de eval disponibles");

    const groupId = input.groupId ?? DEFAULT_PROJECT_GROUP_ID;
    const group = await this.prisma.projectGroup.findUnique({ where: { id: groupId }, select: { id: true } });
    if (!group) {
      throw new BadRequestException(
        `El grupo de proyectos ${groupId} no existe; indica otro grupo (groupId) para los proyectos temporales.`,
      );
    }

    // Los proyectos temporales son del solicitante y el pipeline usa SU proveedor LLM (BYOK).
    try {
      await this.aiFactory.resolveRuntime(userId);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new BadRequestException(
        `No tienes un proveedor de LLM configurado o disponible; la evaluación usa tu proveedor. Configúralo en Ajustes → Proveedores de IA e inténtalo de nuevo. (${detail})`,
      );
    }

    const startedAt = this.now();
    const runId = buildMddEvalRunId(startedAt, (id) => this.store.runExists(id));
    const meta: MddEvalRunMeta = {
      runId,
      status: "queued",
      requestedByUserId: userId,
      groupId,
      caseIds,
      concurrency: input.concurrency,
      keepProjects: input.keepProjects,
      ...(input.timeoutMs ? { timeoutMs: input.timeoutMs } : {}),
      startedAt: startedAt.toISOString(),
      progress: { total: caseIds.length, done: 0, running: [] },
      ...(readGitSha() ? { gitSha: readGitSha() } : {}),
    };
    await this.store.writeMeta(meta);
    try {
      await this.queue.enqueue(meta);
    } catch (error) {
      await this.store.writeMeta({
        ...meta,
        status: "failed",
        finishedAt: this.now().toISOString(),
        error: `No se pudo encolar la corrida: ${error instanceof Error ? error.message : String(error)}`,
      });
      throw new ServiceUnavailableException("No se pudo encolar la corrida (cola de evaluación no disponible)");
    }
    return this.getRun(runId);
  }

  // ── Consulta ────────────────────────────────────────────────────────────

  /** Corrida por id: cola + disco. Funciona para corridas solo en disco (CLI/antiguas) y solo en cola. */
  async getRun(runId: string): Promise<MddEvalRunDto> {
    const dto = await this.tryGetRun(runId);
    if (!dto) throw new NotFoundException(`Corrida no encontrada: ${runId}`);
    return dto;
  }

  private async tryGetRun(runId: string, prefetchedLive?: MddEvalLiveState | null): Promise<MddEvalRunDto | undefined> {
    if (!isSafeMddEvalId(runId)) return undefined;
    let live: MddEvalLiveState | null | undefined = prefetchedLive;
    let liveUnavailable = false;
    if (live === undefined) {
      try {
        live = await this.queue.getLiveState(runId);
      } catch {
        live = null;
        liveUnavailable = true;
      }
    }
    const diskSummary = this.store.readSummary(runId);
    const summary = diskSummary ?? live?.summary;
    const diskMeta = this.store.readMeta(runId);
    const meta = diskMeta ?? live?.meta ?? (summary ? metaFromSummary(summary) : undefined);
    if (!meta) return undefined;

    const { status, error } = deriveMddEvalRunStatus({
      metaStatus: meta.status,
      live,
      hasSummary: Boolean(summary),
      liveUnavailable,
      metaError: diskMeta?.error,
    });
    return buildMddEvalRunDto({
      meta,
      status,
      error,
      summary: status === "completed" || status === "failed" ? summary : undefined,
      progress: live?.state === "active" || live?.state === "waiting" ? (live.progress ?? meta.progress) : undefined,
      hasMarkdown: (record) => {
        if (!diskSummary) return false;
        return Boolean(this.store.markdownPath(runId, diskSummary, record.caseId));
      },
    });
  }

  /** Corridas recientes (más nuevas primero, máx. 50): cola/memoria + summaries en disco. */
  async listRuns(): Promise<MddEvalRunDto[]> {
    const liveById = new Map<string, MddEvalLiveState>();
    try {
      for (const { runId, live } of await this.queue.listLive(MAX_LISTED_RUNS)) liveById.set(runId, live);
    } catch {
      // sin cola: se lista solo lo que hay en disco
    }
    const ids = new Set<string>([...this.store.listRunIds().slice(0, MAX_LISTED_RUNS), ...liveById.keys()]);
    const runs: MddEvalRunDto[] = [];
    for (const runId of ids) {
      const dto = await this.tryGetRun(runId, liveById.get(runId) ?? null);
      if (dto) runs.push(dto);
    }
    runs.sort((a, b) => (a.startedAt < b.startedAt ? 1 : a.startedAt > b.startedAt ? -1 : b.runId.localeCompare(a.runId)));
    return runs.slice(0, MAX_LISTED_RUNS);
  }

  async cancelRun(runId: string): Promise<MddEvalRunDto> {
    const current = await this.getRun(runId);
    if (current.status !== "queued" && current.status !== "running") return current;
    const result = await this.queue.cancel(runId);
    if (result === "cancelled") {
      // Sacada de la cola antes de empezar: no habrá worker que escriba el estado final.
      const meta = this.store.readMeta(runId);
      if (meta) {
        await this.store.writeMeta({ ...meta, status: "cancelled", finishedAt: this.now().toISOString() });
      }
    }
    return this.getRun(runId);
  }

  /** Markdown del MDD generado para un caso de una corrida; 404 si no existe. */
  getCaseMarkdown(runId: string, caseId: string): string {
    if (!isSafeMddEvalId(runId) || !isSafeMddEvalId(caseId)) {
      throw new NotFoundException("Markdown no encontrado");
    }
    const summary = this.store.readSummary(runId);
    const file = summary ? this.store.markdownPath(runId, summary, caseId) : undefined;
    if (!file || !existsSync(file)) throw new NotFoundException("Markdown no encontrado");
    return readFileSync(file, "utf8");
  }

  compare(base: string | undefined, target: string | undefined): MddEvalCompareDto {
    if (!base || !target) throw new BadRequestException("Indica base y target (runIds) para comparar");
    const load = (runId: string): MddEvalSummary => {
      const summary = isSafeMddEvalId(runId) ? this.store.readSummary(runId) : undefined;
      if (!summary) throw new NotFoundException(`La corrida ${runId} no tiene resultados para comparar`);
      return summary;
    };
    return buildMddEvalCompareDto(load(base), load(target));
  }
}
