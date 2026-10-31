/**
 * @fileoverview Configuración pública del chat MDD (`GET ai-analysis/mdd/config`).
 * `MDD_CHAT_VIA_QUEUE` (default "1"): el chat encola el turno en BullMQ y consume los eventos con cursor.
 * Cualquier valor "0", "false", "off" o "no" vuelve al NDJSON legacy dentro del request HTTP.
 */
export type MddChatConfig = { chatViaQueue: boolean };

const FALSY = new Set(["0", "false", "off", "no", "disabled"]);

export function resolveMddChatViaQueue(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = (env.MDD_CHAT_VIA_QUEUE ?? "1").trim().toLowerCase();
  return !FALSY.has(raw);
}

export function resolveMddChatConfig(env: NodeJS.ProcessEnv = process.env): MddChatConfig {
  return { chatViaQueue: resolveMddChatViaQueue(env) };
}
