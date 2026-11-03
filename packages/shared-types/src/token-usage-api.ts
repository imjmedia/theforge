/**
 * Contrato API ↔ web de la telemetría de consumo de tokens (`GET /ai-analysis/token-usage`).
 *
 * Lo produce `aggregateTokenUsageRows` en `apps/api/src/modules/ai-analysis/token-usage/token-usage.service.ts`.
 * Las fechas viajan serializadas como ISO string (JSON). Los contadores `failedCalls`, `estimatedCalls` y
 * `costUnknown` son opcionales para no romper clientes anteriores a su introducción; el API siempre los envía.
 */

/** Contadores de llamadas, presentes en cada documento y en cada entrada de modelo. */
export interface TokenUsageCallCounters {
  /**
   * Llamadas fallidas (error, timeout o cancelación). Entran en `calls`/`generations` con coste 0 y, si el
   * proveedor no devolvió uso, tokens 0. No se facturan.
   */
  failedCalls?: number;
  /** Llamadas con tokens estimados (caracteres/4) en vez de uso real del proveedor. */
  estimatedCalls?: number;
  /** true si alguna llamada con tokens no tiene tarifa: el coste mostrado no es completo. */
  costUnknown?: boolean;
}

/** Desglose de un documento por proveedor/modelo. */
export interface TokenUsageModelSummary extends TokenUsageCallCounters {
  providerId: string;
  modelId: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  costUsd: number;
  costMxn: number;
  /** Número de filas (llamadas) de este modelo, incluidas las fallidas. */
  calls: number;
}

/** Resumen de un documento generado (incluye regeneraciones y chat cuando aplica). */
export interface TokenUsageDocumentSummary extends TokenUsageCallCounters {
  documentField: string;
  totalPromptTokens: number;
  totalCompletionTokens: number;
  totalTokens: number;
  totalCostUsd: number;
  totalCostMxn: number;
  /** Veces que se generó este documento (cada regeneración es un evento distinto). */
  generations: number;
  byModel: TokenUsageModelSummary[];
  /** Primera vez que se generó este documento (ISO string). */
  firstAt: string;
  /** Última vez que se generó este documento (ISO string). */
  lastAt: string;
}

/** Respuesta completa de `GET /ai-analysis/token-usage` para un proyecto. */
export interface TokenUsageSummary {
  projectId: string;
  totalPromptTokens: number;
  totalCompletionTokens: number;
  totalTokens: number;
  totalCostUsd: number;
  totalCostMxn: number;
  documents: TokenUsageDocumentSummary[];
  /** Tipo de cambio vigente al hacer la consulta (informativo; los totales MXN usan el snapshot por evento). */
  mxnPerUsd: number;
}
