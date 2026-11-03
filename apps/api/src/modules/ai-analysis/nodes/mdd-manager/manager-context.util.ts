import { Command } from "@langchain/langgraph";
import type { MDDStateType } from "../../state/index.js";

export const LOG = (msg: string, ...args: unknown[]) => console.log(`[MDD:Manager] ${msg}`, ...args);

/** Texto que se muestra en lugar de un porcentaje cuando el Auditor no entregó nota. */
export const SCORE_UNAVAILABLE_LABEL = "sin nota (auditoría no disponible)";

/**
 * Nota efectiva del Auditor para decisiones del Manager. `undefined` = sin nota (Auditor caído o aún sin valor):
 * jamás se convierte en 0 ni se compara como tal.
 */
export function resolveManagerScore(state: Pick<MDDStateType, "auditorScore" | "auditorOutcome">): number | undefined {
  if (state.auditorOutcome === "unavailable") return undefined;
  return typeof state.auditorScore === "number" ? state.auditorScore : undefined;
}

/** "60%" o, sin nota, la etiqueta explícita (para mensajes internos al usuario/Clarifier). */
export function formatScorePercent(score: number | undefined): string {
  return typeof score === "number" ? `${score}%` : SCORE_UNAVAILABLE_LABEL;
}

/** Complemento de "Estamos …": "al 60%" o "sin nota (auditoría no disponible)". */
export function describePrecision(precision: number | undefined): string {
  return typeof precision === "number" ? `al ${precision}%` : SCORE_UNAVAILABLE_LABEL;
}

/** Mensaje directivo con las preguntas del Clarifier; sin nota lo dice explícitamente en vez de "0%". */
export function buildQuestionsDirectiveReply(precision: number | undefined, questions: string[]): string {
  return (
    "Estamos " +
    describePrecision(precision) +
    ". Para avanzar al 85%, necesito que definamos los siguientes puntos.\n\n" +
    questions.join("\n\n")
  );
}

/** Respuesta a "¿qué falta para el 85%?" con el feedback del Auditor. */
export function buildWhatNeededReply(precision: number | undefined, auditorFeedback: string): string {
  return (
    "Estamos " +
    describePrecision(precision) +
    ". Para avanzar al 85%, necesitamos:\n\n" +
    auditorFeedback.trim() +
    "\n\n¿Quieres que avancemos con estos puntos? Responde validando o indicando cambios concretos."
  );
}

/** Sin nota no alcanza el umbral (no se puede afirmar calidad), pero tampoco se trata como 0. */
export function isBelowQuality(score: number | undefined, threshold: number): boolean {
  return score === undefined || score < threshold;
}

export function hasRealBenchmark(state: MDDStateType): boolean {
  const c = (state.dbgaContent ?? "").trim();
  return c.length > 0 && !/^\(sin\s+benchmark|sin\s+contexto/i.test(c);
}

export function mddHasContent(state: MDDStateType): boolean {
  return (state.mddDraft?.trim()?.length ?? 0) > 100;
}

/**
 * Texto del usuario que se anexa a `dbgaContent` SOLO cuando no hay Benchmark real (placeholder o vacío),
 * donde dbgaContent hace de "entrada del usuario". Con Benchmark real se conserva intacto: las peticiones
 * ya viven en `userInputAccumulated` (y de ahí las lee getLastSubstantiveUserMessage / getPlanDirective);
 * mutarlo con "Petición: …" contaminaba el benchmark que ven Clarifier, Auditor y §5.
 */
export function dbgaContentWithUserText(state: MDDStateType, text: string | undefined): string | undefined {
  if (!text?.trim()) return state.dbgaContent;
  if (hasRealBenchmark(state)) return state.dbgaContent;
  const current = (state.dbgaContent ?? "").trim();
  return [current, text.trim()].filter(Boolean).join("\n\n");
}

/**
 * Anexa un bloque de usuario a `userInputAccumulated` (separador `\n\n---\n\n`), sin duplicar si el último
 * bloque ya es el mismo texto (p. ej. tras el interrupt de "reply" que ya lo acumuló).
 */
export function appendUserInput(
  accumulated: string | undefined,
  text: string | undefined,
  label: "Usuario" | "Petición" = "Usuario",
): string {
  const base = (accumulated ?? "").trim();
  const t = (text ?? "").trim();
  if (!t) return base;
  const lastBlock = base.split(/\n\n---\n\n/).pop()?.replace(/^(Usuario|Petición):\s*/i, "").trim() ?? "";
  if (lastBlock === t) return base;
  return [base, `${label}: ${t}`].filter(Boolean).join("\n\n---\n\n");
}

/** Estado con el mensaje actual ya acumulado: base para calcular directivas/planes que no pierdan la petición. */
export function stateWithUserMessage(
  state: MDDStateType,
  userMessage: string,
  label: "Usuario" | "Petición" = "Usuario",
): MDDStateType {
  return { ...state, userInputAccumulated: appendUserInput(state.userInputAccumulated, userMessage, label) };
}

/**
 * Flags transitorios que deben limpiarse al empezar un turno nuevo (el checkpoint ahora persiste entre
 * turnos). NO incluye auditorScore/auditorFeedback/userInputAccumulated: esa es la memoria que se conserva.
 * Todas las claves deben existir como canal en el estado (un canal desconocido en un update hace fallar a LangGraph).
 */
export const TURN_TRANSIENT_RESET = {
  deliveryGateAttempt: 0,
  deliveryGateLoopActive: false,
  deliveryGateFixTarget: undefined,
  deliveryGatePlaceholderFingerprint: undefined,
  deliveryGateBlockersFingerprint: undefined,
  lastStepFailed: undefined,
  architectCriticAttempts: undefined,
  architectCriticFeedback: undefined,
  auditorRan: undefined,
  auditorOutcome: undefined,
  auditorUnavailableReason: undefined,
  postCriticParallelDone: undefined,
  section5FormatSkipped: undefined,
  meshJumpCount: undefined,
} as const;

/**
 * Mezcla el reset de flags transitorios en el update de un Command cuando llega un mensaje nuevo del usuario.
 * El update explícito del handler tiene prioridad (se esparce después del reset).
 */
export function withTurnReset(command: Command, userMessage: string): Command {
  if (!userMessage.trim()) return command;
  const update = command.update;
  if (update !== undefined && (typeof update !== "object" || Array.isArray(update))) return command;
  return new Command({
    update: { ...TURN_TRANSIENT_RESET, ...((update as Record<string, unknown> | undefined) ?? {}) },
    goto: command.goto,
  });
}
