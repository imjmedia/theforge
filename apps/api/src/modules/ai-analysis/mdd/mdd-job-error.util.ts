import { UnrecoverableError } from "bullmq";

const USER_CANCEL_MESSAGE = "Cancelado por el usuario";

export function isMddUserCancellationError(err: unknown): boolean {
  if (err instanceof Error && err.name === "AbortError") return true;
  const msg = err instanceof Error ? err.message : String(err);
  return (
    msg.includes(USER_CANCEL_MESSAGE) ||
    msg.includes("Cancelado por el administrador") ||
    /\b(aborted|abort)\b/i.test(msg)
  );
}

/** Evita reintentos BullMQ tras cancelación (preserva threadId / checkpoint LangGraph). */
export function toMddJobError(err: unknown): Error {
  if (isMddUserCancellationError(err)) {
    const message = err instanceof Error ? err.message : String(err);
    return new UnrecoverableError(message);
  }
  return err instanceof Error ? err : new Error(String(err));
}
