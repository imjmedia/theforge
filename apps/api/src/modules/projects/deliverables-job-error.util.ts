import { BadRequestException } from "@nestjs/common";
import { UnrecoverableError } from "bullmq";

/** Códigos de negocio que no deben reintentarse en BullMQ (fallo determinístico / calidad). */
const UNRECOVERABLE_ERROR_CODES = new Set([
  "TASKS_QUALITY_BLOCKED",
  "TASKS_PREFLIGHT_BLOCKED",
  "TASKS_PLAN_MISSING_ENDPOINTS",
]);

const UNRECOVERABLE_MESSAGE_SNIPPETS = [
  "Tasks no cumple umbral de calidad",
  "Cancelado por el usuario",
] as const;

export function isUserCancellationError(err: unknown): boolean {
  if (err instanceof Error && err.name === "AbortError") return true;
  const msg = err instanceof Error ? err.message : String(err);
  return (
    msg.includes("Cancelado por el usuario") ||
    /\b(aborted|abort)\b/i.test(msg)
  );
}

function extractErrorMessage(err: unknown): string {
  if (err instanceof BadRequestException) {
    const response = err.getResponse();
    if (typeof response === "string") return response;
    if (response && typeof response === "object") {
      const r = response as { message?: string | string[]; code?: string };
      if (Array.isArray(r.message)) return r.message.join(" ");
      if (typeof r.message === "string") return r.message;
      if (typeof r.code === "string") return r.code;
    }
  }
  return err instanceof Error ? err.message : String(err);
}

/** Errores que BullMQ no debe reintentar (cancelación, calidad Tasks, preflight bloqueado). */
export function isUnrecoverableDeliverablesError(err: unknown): boolean {
  if (isUserCancellationError(err)) return true;

  if (err instanceof BadRequestException) {
    const response = err.getResponse();
    if (response && typeof response === "object") {
      const code = (response as { code?: string }).code;
      if (code && UNRECOVERABLE_ERROR_CODES.has(code)) return true;
    }
  }

  const msg = extractErrorMessage(err);
  for (const code of UNRECOVERABLE_ERROR_CODES) {
    if (msg.includes(code)) return true;
  }
  return UNRECOVERABLE_MESSAGE_SNIPPETS.some((snippet) => msg.includes(snippet));
}

/** Normaliza el error del worker: irrecuperables → UnrecoverableError (sin reintentos BullMQ). */
export function toDeliverablesJobError(err: unknown): Error {
  if (isUnrecoverableDeliverablesError(err)) {
    return new UnrecoverableError(extractErrorMessage(err));
  }
  return err instanceof Error ? err : new Error(String(err));
}
