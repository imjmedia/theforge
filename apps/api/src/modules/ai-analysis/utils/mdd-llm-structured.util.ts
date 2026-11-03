/**
 * @fileoverview Invocación LLM con salida estructurada validada (zod) y reparación acotada.
 */

/**
 * `invokeLlmStructured` envuelve `invokeLlmWithRetry` para los nodos que esperan JSON:
 * extrae el JSON del texto, lo valida con un esquema zod y, si no cumple, re-inyecta el
 * error de validación al modelo para UNA reparación (configurable) antes de rendirse.
 *
 * Contrato (patrón mcp-y-agentes-ia): la salida del LLM se valida antes de usarse; los
 * reintentos son acotados con el error re-inyectado; un abort nunca se reintenta.
 *
 * Nunca lanza: una salida inválida, un fallo de transporte y una cancelación se devuelven
 * como `{ ok: false, reason }`. `invokeLlmWithRetry` sí lanza `AbortError` ante cancelación
 * (señal externa o `getActiveLlmAbortSignal()`); aquí se captura y se traduce a
 * `reason: "aborted"` para que el caller decida si propaga (`throw createLlmAbortError(tag)`).
 *
 * Aditivo: no cambia la firma ni el comportamiento de `invokeLlmWithRetry`.
 *
 * Presupuesto (`deadlineMs`): tope total de la llamada, reparación incluida. Antes de cada intento se exige
 * al menos `MIN_ATTEMPT_BUDGET_MS`; el intento en vuelo se aborta al agotarse el presupuesto con
 * `DeadlineExceededError` y el resultado es `reason: "deadline"` (no `"aborted"`, que queda para cancelaciones).
 * Si el presupuesto no alcanza para REPARAR tras una salida inválida, el resultado es `reason: "invalid"` con
 * `attempts` 1 (el fallo es de calidad, no de presupuesto): `"deadline"` solo cuando no hubo presupuesto ni para el primer intento.
 */
import { AIMessage, HumanMessage, type BaseMessage } from "@langchain/core/messages";
import type { z } from "zod";
import { extractFirstJsonObject } from "./parse-json.js";
import {
  extractLlmText,
  getActiveLlmAbortSignal,
  invokeLlmWithRetry,
  type InvokableLlm,
  type InvokeWithRetryOptions,
} from "./mdd-llm-retry.util.js";

/** Tope de caracteres de la salida previa que se re-inyecta en la reparación. */
const REPAIR_PREVIOUS_OUTPUT_MAX_CHARS = 4_000;
/** Máximo de issues de zod que se listan en el mensaje de reparación. */
const REPAIR_MAX_ISSUES = 5;
/** Presupuesto mínimo (ms) para lanzar un intento (inicial o reparación); por debajo se devuelve `deadline`. */
const MIN_ATTEMPT_BUDGET_MS = 15_000;

/**
 * Motivo con el que se aborta la señal cuando se agota `deadlineMs`. `invokeLlmWithRetry` no lo distingue por
 * clase (compara por `name`), así que el nombre es parte del contrato con `mdd-llm-retry.util.ts`.
 */
export class DeadlineExceededError extends Error {
  constructor(tag: string, deadlineMs: number) {
    super(`[${tag}] presupuesto de ${deadlineMs} ms agotado`);
    this.name = "DeadlineExceededError";
  }
}

const defaultSetTimer = (fn: () => void, ms: number): unknown => setTimeout(fn, ms);
const defaultClearTimer = (handle: unknown): void => clearTimeout(handle as ReturnType<typeof setTimeout>);

export type InvokeLlmStructuredArgs<T> = Omit<
  InvokeWithRetryOptions,
  "isResponseValid" | "acceptToolCallsWithoutContent"
> & {
  llm: InvokableLlm;
  messages: BaseMessage[];
  schema: z.ZodType<T>;
  /** Etiqueta corta para logs ("Auditor", "Security", …). */
  tag: string;
  /** Reintentos de reparación tras una salida inválida (default 1). */
  repairAttempts?: number;
  /** Extractor del JSON dentro del texto. Default: fence ```json / texto completo / primer objeto balanceado. */
  extractJson?: (text: string) => string | null;
  /** Presupuesto total (ms) de la llamada, reparación incluida. Sin valor, no hay tope total (comportamiento previo). */
  deadlineMs?: number;
  /** Sólo para pruebas: reloj (ms) del presupuesto. Default `Date.now`. Se pasa también a `invokeLlmWithRetry`. */
  now?: () => number;
  /** Sólo para pruebas: arma el temporizador del presupuesto. Default `setTimeout`. */
  setTimer?: (fn: () => void, ms: number) => unknown;
  /** Sólo para pruebas: cancela el temporizador del presupuesto. Default `clearTimeout`. */
  clearTimer?: (handle: unknown) => void;
};

export type InvokeLlmStructuredResult<T> =
  | { ok: true; value: T; attempts: number; rawText: string }
  | {
      ok: false;
      reason: "transport" | "invalid" | "aborted" | "deadline";
      attempts: number;
      lastError?: string;
      rawText?: string;
    };

/**
 * Extractor por defecto: (1) cuerpo del primer fence ```json si ya es JSON válido (admite
 * arrays), (2) el texto completo si ya es JSON válido, (3) primer objeto balanceado
 * (`extractFirstJsonObject`, que también mira dentro del fence).
 */
export function defaultExtractJson(text: string): string | null {
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidates = [fence?.[1]?.trim(), text.trim()];
  for (const c of candidates) {
    if (!c) continue;
    try {
      JSON.parse(c);
      return c;
    } catch {
      /* siguiente candidato */
    }
  }
  return extractFirstJsonObject(text);
}

function formatIssues(error: z.ZodError): string[] {
  return error.issues.slice(0, REPAIR_MAX_ISSUES).map((issue) => {
    const path = issue.path.length > 0 ? issue.path.join(".") : "(raíz)";
    return `- ${path}: ${issue.message}`;
  });
}

function buildRepairMessages(previousText: string, issues: string[]): BaseMessage[] {
  const previous =
    previousText.length > REPAIR_PREVIOUS_OUTPUT_MAX_CHARS
      ? `${previousText.slice(0, REPAIR_PREVIOUS_OUTPUT_MAX_CHARS)}…[recortado]`
      : previousText;
  return [
    new AIMessage(previous),
    new HumanMessage(
      "Tu respuesta anterior no cumple el esquema esperado. Problemas detectados:\n" +
        `${issues.join("\n")}\n\n` +
        "Devuelve SOLO el JSON corregido, completo y válido, sin texto adicional ni explicaciones.",
    ),
  ];
}

/**
 * `SyntaxError.message` de `JSON.parse` incluye un fragmento de la salida del LLM (`... "texto" is not
 * valid JSON`), que acabaría en logs y en `lastError`. Se reduce al tipo de error y la posición, en una
 * sola línea de <= 120 caracteres.
 */
export function describeJsonParseError(err: unknown): string {
  const name = err instanceof Error ? err.name : "Error";
  const message = err instanceof Error ? err.message : String(err);
  const position = /position (\d+)/.exec(message)?.[1];
  const line = /line (\d+) column (\d+)/.exec(message);
  const where = position
    ? ` en posición ${position}`
    : line
      ? ` en línea ${line[1]} columna ${line[2]}`
      : "";
  return `JSON no parseable (${name}${where})`.replace(/\s+/g, " ").slice(0, 120);
}

type ParseOutcome<T> = { ok: true; value: T } | { ok: false; issues: string[]; error: string };

function parseStructured<T>(
  text: string,
  schema: z.ZodType<T>,
  extractJson: (text: string) => string | null,
): ParseOutcome<T> {
  const json = extractJson(text);
  if (!json) {
    const error = "no se encontró JSON en la respuesta";
    return { ok: false, issues: [`- (raíz): ${error}`], error };
  }
  let raw: unknown;
  try {
    raw = JSON.parse(json) as unknown;
  } catch (err) {
    const error = describeJsonParseError(err);
    return { ok: false, issues: [`- (raíz): ${error}`], error };
  }
  const result = schema.safeParse(raw);
  if (result.success) return { ok: true, value: result.data };
  const issues = formatIssues(result.error);
  return { ok: false, issues, error: issues.join("; ").slice(0, 500) };
}

function isAbortError(err: unknown): boolean {
  return err instanceof Error && err.name === "AbortError";
}

export async function invokeLlmStructured<T>(
  args: InvokeLlmStructuredArgs<T>,
): Promise<InvokeLlmStructuredResult<T>> {
  const {
    llm,
    messages,
    schema,
    tag,
    repairAttempts,
    extractJson,
    deadlineMs,
    now,
    setTimer,
    clearTimer,
    ...retryOptions
  } = args;
  const maxRepairs = Math.max(0, repairAttempts ?? 1);
  const extract = extractJson ?? defaultExtractJson;
  const externalSignal = retryOptions.signal ?? getActiveLlmAbortSignal();
  const clock = now ?? Date.now;
  const totalAttempts = maxRepairs + 1;

  // Presupuesto total: un temporizador propio aborta con DeadlineExceededError. La señal combinada es la que
  // recibe `invokeLlmWithRetry`, así que el intento en vuelo también se corta al agotarse el presupuesto.
  const startedAt = clock();
  const deadline = deadlineMs !== undefined ? new AbortController() : undefined;
  const signal =
    deadline && externalSignal
      ? AbortSignal.any([externalSignal, deadline.signal])
      : (deadline?.signal ?? externalSignal);
  // Una cancelación externa tiene prioridad: sólo cuenta como presupuesto si el deadline disparó y el turno sigue vivo.
  const deadlineHit = (): boolean => deadline?.signal.aborted === true && externalSignal?.aborted !== true;
  const timerHandle =
    deadline && deadlineMs !== undefined
      ? (setTimer ?? defaultSetTimer)(
          () => deadline.abort(new DeadlineExceededError(tag, deadlineMs)),
          deadlineMs,
        )
      : undefined;

  let currentMessages = messages;
  let attempts = 0;
  let lastText: string | undefined;
  let lastError: string | undefined;
  const deadlineOut = (): InvokeLlmStructuredResult<T> => ({
    ok: false,
    reason: "deadline",
    attempts,
    ...(lastError ? { lastError } : {}),
    ...(lastText ? { rawText: lastText } : {}),
  });

  try {
    while (attempts < totalAttempts) {
      if (externalSignal?.aborted) {
        return { ok: false, reason: "aborted", attempts, ...(lastError ? { lastError } : {}), ...(lastText ? { rawText: lastText } : {}) };
      }
      if (deadlineHit()) return deadlineOut();

      // Presupuesto restante antes de CADA intento (el inicial y cada reparación).
      let remainingMs = Infinity;
      if (deadlineMs !== undefined) {
        remainingMs = deadlineMs - (clock() - startedAt);
        if (remainingMs < MIN_ATTEMPT_BUDGET_MS) {
          console.warn(
            `[${tag}] structured intento ${attempts + 1}/${totalAttempts}: sin presupuesto suficiente (restante ${Math.max(0, Math.round(remainingMs))}ms), no se invoca`,
          );
          // Sin presupuesto para REPARAR tras una salida inválida: el fallo es de calidad, no de presupuesto.
          if (attempts > 0) {
            return {
              ok: false,
              reason: "invalid",
              attempts,
              lastError: `${(lastError ?? "").slice(0, 440)} (sin presupuesto para reparar)`,
              ...(lastText ? { rawText: lastText } : {}),
            };
          }
          return deadlineOut();
        }
      }
      attempts += 1;
      const hardTimeoutMs =
        deadlineMs !== undefined
          ? Math.min(retryOptions.hardTimeoutMs ?? Infinity, remainingMs)
          : retryOptions.hardTimeoutMs;

      let response: unknown;
      try {
        response = await invokeLlmWithRetry(llm, currentMessages, {
          ...retryOptions,
          tag,
          signal,
          now,
          hardTimeoutMs,
        });
      } catch (err) {
        if (deadlineHit()) {
          console.warn(`[${tag}] structured intento ${attempts}/${totalAttempts}: presupuesto agotado (${deadlineMs}ms)`);
          return deadlineOut();
        }
        if (isAbortError(err) || signal?.aborted) {
          console.warn(`[${tag}] structured intento ${attempts}/${totalAttempts}: abortado`);
          return { ok: false, reason: "aborted", attempts, ...(lastText ? { rawText: lastText } : {}) };
        }
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`[${tag}] structured intento ${attempts}/${totalAttempts}: transporte (${msg.slice(0, 200)})`);
        return { ok: false, reason: "transport", attempts, lastError: msg.slice(0, 500), ...(lastText ? { rawText: lastText } : {}) };
      }

      if (response == null) {
        if (deadlineHit()) {
          console.warn(`[${tag}] structured intento ${attempts}/${totalAttempts}: presupuesto agotado (${deadlineMs}ms)`);
          return deadlineOut();
        }
        console.warn(`[${tag}] structured intento ${attempts}/${totalAttempts}: sin respuesta tras reintentos de transporte`);
        return {
          ok: false,
          reason: "transport",
          attempts,
          lastError: "LLM sin respuesta válida tras los reintentos de transporte",
          ...(lastText ? { rawText: lastText } : {}),
        };
      }

      const text = extractLlmText(response);
      lastText = text;
      const parsed = parseStructured(text, schema, extract);
      if (parsed.ok) {
        console.log(`[${tag}] structured intento ${attempts}/${totalAttempts}: ok`);
        return { ok: true, value: parsed.value, attempts, rawText: text };
      }

      lastError = parsed.error;
      console.warn(`[${tag}] structured intento ${attempts}/${totalAttempts}: inválido (${parsed.error.slice(0, 200)})`);
      if (attempts >= totalAttempts) break;
      currentMessages = [...messages, ...buildRepairMessages(text, parsed.issues)];
    }

    return { ok: false, reason: "invalid", attempts, ...(lastError ? { lastError } : {}), ...(lastText ? { rawText: lastText } : {}) };
  } finally {
    if (deadline) (clearTimer ?? defaultClearTimer)(timerHandle);
  }
}
