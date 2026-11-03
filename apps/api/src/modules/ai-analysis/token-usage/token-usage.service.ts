/**
 * @fileoverview Servicio de telemetría de tokens. Persiste cada call LLM en la tabla
 * `TokenUsage` (Prisma) y ofrece agregación por documento/modelo para la UI.
 *
 * El servicio se invoca desde los adapters (workshop chat) y desde `mdd-llm-retry.util`
 * (pipeline MDD). La persistencia es fire-and-forget: cualquier error se loggea pero no
 * bloquea el flujo LLM. Los fallos de escritura se loggean como `error` y se cuentan en
 * `failedWrites` (ver `getTelemetryHealth`) para que no pasen desapercibidos.
 */

import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { PrismaService } from "../../../prisma/prisma.service.js";
import {
  calculateChatCostUsd,
  resolveChatModelPricing,
} from "../../ai/providers/chat-model-pricing.js";
import { FxRateService } from "../../fx-rate/fx-rate.service.js";
import { registerTokenUsageRecorder } from "../../ai/utils/token-usage-recorder.js";
import { classifyTokenUsageOutcome, type TokenUsageOutcome } from "./token-usage.context.js";
import type {
  TokenUsageCallCounters as TokenUsageCallCountersContract,
  TokenUsageDocumentSummary,
  TokenUsageModelSummary,
  TokenUsageSummary as TokenUsageSummaryContract,
} from "@theforge/shared-types";

export type { TokenUsageOutcome } from "./token-usage.context.js";

/** Aproximación de tokens por carácter para estimaciones (abort/timeout, stream cortado). */
export const ESTIMATED_CHARS_PER_TOKEN = 4;

export type TokenUsageContext =
  | "initial"
  | "regenerate"
  | "repair"
  | "refine"
  | "chat"
  | "tool"
  | "unknown";

export interface TokenUsageEvent {
  projectId: string;
  stageId?: string | null;
  /** Campo documental destino (mddContent, specContent, …) o "chat" para Workshop. */
  documentField: string;
  context: TokenUsageContext;
  /** Nodo del pipeline que produjo el call (software_architect, clarifier, …). Null para chat. */
  node?: string | null;
  providerId: string;
  modelId: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  jobId?: string | null;
  /** Capacidad/etiqueta lógica; se usa como `node` si este no viene (no tiene columna). */
  capability?: string | null;
  /** Telemetría por llamada (O14). Todas opcionales; null/undefined → columna NULL. */
  latencyMs?: number | null;
  attempts?: number | null;
  outcome?: TokenUsageOutcome | null;
  /** Si no viene se deduce del catálogo de tarifas (false cuando el modelo no tiene tarifa). */
  costKnown?: boolean | null;
  estimated?: boolean | null;
  modelActual?: string | null;
  /**
   * El proveedor no facturó la llamada (error sin salida): `costUsd` 0 y `costKnown` false.
   * Evita inflar el coste con estimaciones de prompts que nunca se procesaron.
   */
  skipCost?: boolean | null;
}

/** Entrada de `recordEstimated`: identidad de la llamada + tamaño en caracteres. */
export interface TokenUsageEstimateInput {
  projectId: string;
  stageId?: string | null;
  documentField: string;
  context: TokenUsageContext;
  node?: string | null;
  capability?: string | null;
  providerId: string;
  modelId: string;
  jobId?: string | null;
  /** Caracteres del prompt enviado. */
  inputChars: number;
  /** Caracteres de salida recibidos antes del corte. */
  outputChars: number;
  outcome: TokenUsageOutcome;
  latencyMs?: number | null;
  attempts?: number | null;
  modelActual?: string | null;
  skipCost?: boolean | null;
}

/**
 * Modelo con el que se tarifa: el que respondió de verdad (`modelActual`, p. ej. un fallback de la
 * cadena) y, si no hay, el configurado (`modelId`, que es el que se muestra y agrega por modelo).
 */
export function resolvePricingModelId(event: { modelId: string; modelActual?: string | null }): string {
  const actual = event.modelActual?.trim();
  return actual ? actual : event.modelId;
}

/** Convierte caracteres en tokens estimados (chars/4, redondeo hacia arriba, nunca negativo). */
export function estimateTokensFromChars(chars: number): number {
  if (!Number.isFinite(chars) || chars <= 0) return 0;
  return Math.ceil(chars / ESTIMATED_CHARS_PER_TOKEN);
}

export interface TokenUsageTelemetryHealth {
  /** Escrituras a `TokenUsage` que fallaron desde el arranque del proceso. */
  failedWrites: number;
  lastError: string | null;
  lastErrorAt: Date | null;
}

export interface TokenUsageRow extends TokenUsageEvent {
  id: string;
  costUsd: number;
  costMxn: number;
  createdAt: Date;
}

/**
 * Contadores de llamadas (contrato `TokenUsageCallCounters` de `@theforge/shared-types`). Aquí son siempre
 * numéricos/booleanos porque la agregación los calcula en todas las filas. Son aditivos: `calls` (en
 * `byModel`) y `generations` (en el documento) siguen contando todas las filas.
 */
export type TokenUsageCallCounters = Required<TokenUsageCallCountersContract>;

/**
 * Agregado por documento. Extiende el contrato compartido con `Date` en `firstAt`/`lastAt`: la serialización
 * JSON del endpoint los convierte en ISO string, que es lo que describe `TokenUsageDocumentSummary`.
 */
export interface TokenUsageAggregateByDocument
  extends Omit<
      TokenUsageDocumentSummary,
      "firstAt" | "lastAt" | "byModel" | keyof TokenUsageCallCountersContract
    >,
    TokenUsageCallCounters {
  /** Primera y última vez que se generó este documento. */
  firstAt: Date;
  lastAt: Date;
  /** Desglose por modelo. */
  byModel: Array<Required<TokenUsageModelSummary>>;
}

/** Resumen de `getSummary`/`aggregateTokenUsageRows`: el contrato compartido con documentos agregados (Date). */
export interface TokenUsageSummary extends Omit<TokenUsageSummaryContract, "documents"> {
  documents: TokenUsageAggregateByDocument[];
}

@Injectable()
export class TokenUsageService implements OnModuleInit {
  private readonly logger = new Logger(TokenUsageService.name);
  private failedWriteCount = 0;
  private lastError: string | null = null;
  private lastErrorAt: Date | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly fxRate: FxRateService,
  ) {}

  onModuleInit(): void {
    registerTokenUsageRecorder(this);
  }

  /**
   * Persiste un evento de uso. Fire-and-forget — los errores se loggean y no se
   * propagan al caller, para no romper el flujo LLM. El `costMxn` se snapshotea
   * en el momento del call con el tipo de cambio vigente (BdD), por lo que
   * cambios posteriores en Ajustes → Sistema NO afectan a eventos ya persistidos.
   */
  async record(event: TokenUsageEvent): Promise<void> {
    try {
      const pricingModelId = resolvePricingModelId(event);
      const costUsd = event.skipCost
        ? 0
        : calculateChatCostUsd(
            event.providerId,
            pricingModelId,
            event.promptTokens,
            event.completionTokens,
          );
      const costMxn = await this.fxRate.usdToMxn(costUsd);
      const costKnown = event.skipCost
        ? false
        : event.costKnown ?? resolveChatModelPricing(event.providerId, pricingModelId) !== null;

      await this.prisma.tokenUsage.create({
        data: {
          projectId: event.projectId,
          stageId: event.stageId ?? null,
          documentField: event.documentField,
          context: event.context,
          node: event.node ?? event.capability ?? null,
          providerId: event.providerId,
          modelId: event.modelId,
          promptTokens: event.promptTokens,
          completionTokens: event.completionTokens,
          totalTokens: event.totalTokens,
          costUsd,
          costMxn,
          jobId: event.jobId ?? null,
          latencyMs: event.latencyMs ?? null,
          attempts: event.attempts ?? null,
          outcome: event.outcome ?? null,
          costKnown,
          estimated: event.estimated ?? null,
          modelActual: event.modelActual ?? null,
        },
      });
    } catch (err) {
      this.failedWriteCount += 1;
      this.lastError = (err as Error)?.message ?? String(err);
      this.lastErrorAt = new Date();
      this.logger.error(
        `No se pudo persistir TokenUsage (projectId=${event.projectId} model=${event.modelId} tokens=${event.totalTokens} failedWrites=${this.failedWriteCount}): ${this.lastError}`,
      );
    }
  }

  /**
   * Registra una llamada cuyo uso real no llegó (abort, timeout, stream cortado antes de
   * `usage_metadata`): estima tokens como chars/4 y marca la fila `estimated: true`.
   * `costKnown` sale del catálogo de tarifas (false si el modelo no tiene tarifa).
   * Mismo contrato que `record`: nunca lanza.
   */
  async recordEstimated(input: TokenUsageEstimateInput): Promise<void> {
    const promptTokens = estimateTokensFromChars(input.inputChars);
    const completionTokens = estimateTokensFromChars(input.outputChars);
    await this.record({
      projectId: input.projectId,
      stageId: input.stageId ?? null,
      documentField: input.documentField,
      context: input.context,
      node: input.node ?? null,
      capability: input.capability ?? null,
      providerId: input.providerId,
      modelId: input.modelId,
      promptTokens,
      completionTokens,
      totalTokens: promptTokens + completionTokens,
      jobId: input.jobId ?? null,
      latencyMs: input.latencyMs ?? null,
      attempts: input.attempts ?? null,
      outcome: input.outcome,
      costKnown: input.skipCost
        ? false
        : resolveChatModelPricing(input.providerId, resolvePricingModelId(input)) !== null,
      estimated: true,
      modelActual: input.modelActual ?? null,
      skipCost: input.skipCost ?? null,
    });
  }

  /** Wrapper sync de `recordEstimated` (fire-and-forget). */
  recordEstimatedAsync(input: TokenUsageEstimateInput): void {
    void this.recordEstimated(input);
  }

  /** Contador de escrituras fallidas desde el arranque (para health/log). */
  get failedWrites(): number {
    return this.failedWriteCount;
  }

  /** Estado de salud de la telemetría: escrituras fallidas y último error. */
  getTelemetryHealth(): TokenUsageTelemetryHealth {
    return {
      failedWrites: this.failedWriteCount,
      lastError: this.lastError,
      lastErrorAt: this.lastErrorAt,
    };
  }

  /**
   * Wrapper sync que llama a `record` sin await. Útil en adapters donde no queremos
   * añadir latencia al streaming del chat.
   */
  recordAsync(event: TokenUsageEvent): void {
    void this.record(event);
  }

  /**
   * Resumen agregado por documento para la UI. Solo cuenta generations (no chat).
   * Opcionalmente filtra por stageId.
   */
  async getSummary(
    projectId: string,
    options?: { stageId?: string; includeChat?: boolean },
  ): Promise<TokenUsageSummary> {
    const stageId = options?.stageId;
    const includeChat = options?.includeChat ?? false;

    const where: Record<string, unknown> = { projectId };
    if (stageId) where.stageId = stageId;
    if (!includeChat) {
      where.documentField = { not: "chat" };
    }

    const rows = await this.prisma.tokenUsage.findMany({
      where,
      orderBy: { createdAt: "asc" },
    });

    const summary = aggregateTokenUsageRows(projectId, rows as RawTokenUsageRow[]);
    // El FX de la respuesta es el vigente al hacer la consulta (puede diferir del
    // snapshot de cada evento si el usuario lo cambió). Se usa para mostrar
    // el TC activo al usuario en la UI; los totales siguen siendo los snapshots.
    return { ...summary, mxnPerUsd: await this.fxRate.getMxnPerUsd() };
  }

  /**
   * Lista de generaciones crudas (debug / admin). Útil para vista detallada.
   */
  async listEvents(
    projectId: string,
    options?: { stageId?: string; documentField?: string; limit?: number },
  ): Promise<TokenUsageRow[]> {
    const where: Record<string, unknown> = { projectId };
    if (options?.stageId) where.stageId = options.stageId;
    if (options?.documentField) where.documentField = options.documentField;

    const rows = await this.prisma.tokenUsage.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: options?.limit ?? 100,
    });

    return rows.map((r) => ({
      projectId: r.projectId,
      stageId: r.stageId,
      documentField: r.documentField,
      context: r.context as TokenUsageContext,
      node: r.node,
      providerId: r.providerId,
      modelId: r.modelId,
      promptTokens: r.promptTokens,
      completionTokens: r.completionTokens,
      totalTokens: r.totalTokens,
      jobId: r.jobId,
      latencyMs: r.latencyMs,
      attempts: r.attempts,
      outcome: r.outcome as TokenUsageOutcome | null,
      costKnown: r.costKnown,
      estimated: r.estimated,
      modelActual: r.modelActual,
      id: r.id,
      costUsd: r.costUsd,
      costMxn: r.costMxn,
      createdAt: r.createdAt,
    }));
  }
}

/** Tipo de fila cruda expuesta por la BD (modelo Prisma TokenUsage). */
export interface RawTokenUsageRow {
  projectId: string;
  stageId: string | null;
  documentField: string;
  context: string;
  node: string | null;
  providerId: string;
  modelId: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  costUsd: number;
  costMxn: number;
  jobId: string | null;
  /** Telemetría por llamada (O14); ausentes/null en filas anteriores. */
  latencyMs?: number | null;
  attempts?: number | null;
  outcome?: string | null;
  costKnown?: boolean | null;
  estimated?: boolean | null;
  modelActual?: string | null;
  createdAt: Date;
}

/**
 * Función pura de agregación. Toma las filas crudas y devuelve el resumen
 * agrupado por documento y modelo. Útil para testing unitario sin Prisma.
 *
 * El parámetro `mxnPerUsd` es informativo (el TC vigente al hacer la consulta);
 * los totales `costMxn` se calculan a partir de los snapshots por evento, no
 * se recalculan aquí.
 *
 * `calls` y `generations` cuentan todas las filas. `failedCalls`, `estimatedCalls` y `costUnknown` (por
 * documento y por modelo) son contadores aditivos: ver `TokenUsageCallCounters`.
 */
export function aggregateTokenUsageRows(
  projectId: string,
  rows: RawTokenUsageRow[],
  mxnPerUsd: number = 20,
): TokenUsageSummary {
  const byDocument = new Map<string, TokenUsageAggregateByDocument>();
  let totalPromptTokens = 0;
  let totalCompletionTokens = 0;
  let totalTokens = 0;
  let totalCostUsd = 0;
  let totalCostMxn = 0;

  for (const row of rows) {
    totalPromptTokens += row.promptTokens;
    totalCompletionTokens += row.completionTokens;
    totalTokens += row.totalTokens;
    totalCostUsd += row.costUsd;
    totalCostMxn += row.costMxn;

    const failed = classifyTokenUsageOutcome(row) === "failed" ? 1 : 0;
    const estimated = row.estimated === true ? 1 : 0;
    const costUnknown = row.totalTokens > 0 && row.costKnown === false;

    let doc = byDocument.get(row.documentField);
    if (!doc) {
      doc = {
        documentField: row.documentField,
        totalPromptTokens: 0,
        totalCompletionTokens: 0,
        totalTokens: 0,
        totalCostUsd: 0,
        totalCostMxn: 0,
        generations: 0,
        failedCalls: 0,
        estimatedCalls: 0,
        costUnknown: false,
        byModel: [],
        firstAt: row.createdAt,
        lastAt: row.createdAt,
      };
      byDocument.set(row.documentField, doc);
    }

    doc.totalPromptTokens += row.promptTokens;
    doc.totalCompletionTokens += row.completionTokens;
    doc.totalTokens += row.totalTokens;
    doc.totalCostUsd += row.costUsd;
    doc.totalCostMxn += row.costMxn;
    doc.generations += 1;
    doc.failedCalls += failed;
    doc.estimatedCalls += estimated;
    if (costUnknown) doc.costUnknown = true;
    if (row.createdAt < doc.firstAt) doc.firstAt = row.createdAt;
    if (row.createdAt > doc.lastAt) doc.lastAt = row.createdAt;

    let modelEntry = doc.byModel.find(
      (m) => m.providerId === row.providerId && m.modelId === row.modelId,
    );
    if (!modelEntry) {
      modelEntry = {
        providerId: row.providerId,
        modelId: row.modelId,
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
        costUsd: 0,
        costMxn: 0,
        calls: 0,
        failedCalls: 0,
        estimatedCalls: 0,
        costUnknown: false,
      };
      doc.byModel.push(modelEntry);
    }
    modelEntry.promptTokens += row.promptTokens;
    modelEntry.completionTokens += row.completionTokens;
    modelEntry.totalTokens += row.totalTokens;
    modelEntry.costUsd += row.costUsd;
    modelEntry.costMxn += row.costMxn;
    modelEntry.calls += 1;
    modelEntry.failedCalls += failed;
    modelEntry.estimatedCalls += estimated;
    if (costUnknown) modelEntry.costUnknown = true;
  }

  const documents = Array.from(byDocument.values()).sort((a, b) =>
    a.documentField.localeCompare(b.documentField),
  );

  return {
    projectId,
    totalPromptTokens,
    totalCompletionTokens,
    totalTokens,
    totalCostUsd: round(totalCostUsd, 6),
    totalCostMxn: round(totalCostMxn, 6),
    documents,
    mxnPerUsd,
  };
}

function round(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}
