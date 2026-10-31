/**
 * @fileoverview Validación del payload de los jobs de chat MDD (`manager` y `resume`).
 * Pura (sin Nest): la usan el controller (400) y los specs.
 */
import type { ChatImagePart } from "@theforge/shared-types";

/** Modos del chat MDD que corren el turno de Manager dentro del worker y emiten eventos con cursor. */
export const MDD_CHAT_JOB_MODES = ["manager", "resume"] as const;
export type MddChatJobMode = (typeof MDD_CHAT_JOB_MODES)[number];

export function isMddChatJobMode(mode: unknown): mode is MddChatJobMode {
  return mode === "manager" || mode === "resume";
}

export type MddChatJobPayloadFields = {
  mode: string;
  projectId?: string;
  threadId?: string;
  userMessage?: string;
  initialMessage?: string;
  imageAttachments?: ChatImagePart[];
};

/**
 * Devuelve el mensaje de error (400) si el payload del job de chat es inválido, o `null` si es válido.
 * - `resume`: exige `projectId`, `threadId` y `userMessage` o imágenes (igual que `mdd/stream/resume`).
 * - `manager`: exige `projectId`.
 */
export function validateMddChatJobPayload(data: MddChatJobPayloadFields): string | null {
  if (!isMddChatJobMode(data.mode)) return null;
  if (!data.projectId?.trim()) return "projectId is required";
  if (data.mode === "resume") {
    if (!data.threadId?.trim()) return "projectId and threadId are required for mode resume";
    const hasText = Boolean(data.userMessage?.trim());
    const hasImages = Boolean(data.imageAttachments?.length);
    if (!hasText && !hasImages) return "userMessage or images are required for mode resume";
  }
  return null;
}
