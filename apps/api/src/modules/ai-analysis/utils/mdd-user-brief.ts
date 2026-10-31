/**
 * @fileoverview Extracción de resumen de usuario desde estado MDD.
 */

import type { MDDStateType } from "../state/index.js";
import {
  MDD_MAX_EXPLICIT_REQUIREMENTS_CHARS,
  MDD_MAX_PLAN_BLOCK_CHARS,
  MDD_MAX_PLAN_DIRECTIVE_CHARS,
  MDD_MAX_USER_BRIEF_FROM_ACCUMULATED_CHARS,
} from "@theforge/shared-types";
import {
  minLengthForExplicitRequirements,
  STACK_TECHNOLOGY_REGEX,
} from "./user-declared-stack.util.js";

/** Prefijos que suelen preceder al requisito real del usuario (se eliminan para obtener el brief). */
const COMMAND_PREFIXES = [
  /^regenera\s+(el\s+)?(documento|mdd|documento\s+)?,?\s*/i,
  /^genera\s+(el\s+)?(documento|mdd)\s*,?\s*/i,
  /^esto\s+es\s+lo\s+que\s+quiero\s+(hacer|)\s*:?\s*/i,
  /^quiero\s+que\s+(el\s+documento\s+)?/i,
  /^necesito\s+que\s+(el\s+documento\s+)?/i,
  /^haz\s+(el\s+)?(documento|mdd)\s*,?\s*/i,
  /^elabora\s+(el\s+)?(documento|mdd)\s*,?\s*/i,
  /^petición\s*:?\s*/i,
];

/** Longitud mínima para considerar un mensaje como "brief" sustancial (evitar "sí", "ok"). */
const MIN_BRIEF_LENGTH = 25;

/**
 * Extrae un brief de una línea: quita prefijos de comando y devuelve el núcleo del requisito.
 */
function stripCommandPrefix(text: string): string {
  let out = text.trim();
  for (const re of COMMAND_PREFIXES) {
    out = out.replace(re, "").trim();
  }
  return out;
}

/**
 * Devuelve una frase corta "lo que el usuario pide" para inyectar al inicio del contexto de cada agente.
 * Así todos los agentes ven el mismo objetivo: "una aplicación que hace X".
 */
export function getUserBrief(state: MDDStateType): string {
  const last = (state.lastUserMessage ?? "").trim();
  if (last.length >= MIN_BRIEF_LENGTH) {
    const stripped = stripCommandPrefix(last);
    if (stripped.length >= MIN_BRIEF_LENGTH) return stripped.slice(0, MDD_MAX_USER_BRIEF_FROM_ACCUMULATED_CHARS);
  }
  const accumulated = (state.userInputAccumulated ?? "").trim();
  if (accumulated.length >= MIN_BRIEF_LENGTH) {
    const lastBlock = accumulated.includes("---")
      ? accumulated.split("---").map((s) => s.trim()).filter(Boolean).pop() ?? accumulated
      : accumulated;
    const withoutPeticion = lastBlock.replace(/^petición\s*:?\s*/i, "").trim();
    const stripped = stripCommandPrefix(withoutPeticion);
    if (stripped.length >= MIN_BRIEF_LENGTH) return stripped.slice(0, MDD_MAX_USER_BRIEF_FROM_ACCUMULATED_CHARS);
    if (lastBlock.length >= MIN_BRIEF_LENGTH) return lastBlock.slice(0, MDD_MAX_USER_BRIEF_FROM_ACCUMULATED_CHARS);
  }
  const scope = (state.clarifiedScope ?? "").trim();
  if (scope.length >= MIN_BRIEF_LENGTH) {
    const firstParagraph = scope.split(/\n\n+/)[0]?.trim() ?? scope;
    return firstParagraph.slice(0, 400);
  }
  const dbga = (state.dbgaContent ?? "").trim();
  if (dbga.length >= MIN_BRIEF_LENGTH) return dbga.slice(0, 400);
  return "";
}

/** Respuestas breves que no son requisitos (sí, ok, de acuerdo, etc.). */
const TRIVIAL_REPLY = /^(?:Usuario:\s*)?(?:s[ií]|s[ií]\s*,\s*de\s*acuerdo|de\s*acuerdo|ok|vale|correcto|estoy\s+de\s+acuerdo|perfecto|acepto)[\s.]*$/i;

/** Aprobaciones/afirmaciones cortas ("sí, procede", "me parece bien", "claro") que no son requisitos. */
const TRIVIAL_AFFIRMATION =
  /^(?:Usuario:\s*|Petici[oó]n:\s*)?(?:s[ií]|no|ok(?:ay)?|vale|dale|va|claro|por\s+supuesto|adelante|aprobado|apru[eé]bo|perfecto|excelente|correcto|de\s+acuerdo|est[aá]\s+bien|me\s+parece\s+bien|proced\w*|ejec[uú]t\w*|conf[ií]rmo|listo|contin[uú]\w*|hazlo|gracias)(?:[\s.,;:!?¡¿]+(?:s[ií]|ok|dale|adelante|procede\w*|ejec[uú]t\w*|el\s+plan|por\s+favor|gracias|perfecto|listo|claro))*[\s.,;:!?¡¿]*$/i;

/** Mensaje sin contenido de requisito (sí/no/ok/procede…). */
function isTrivialUserText(text: string): boolean {
  const t = text.trim();
  return TRIVIAL_REPLY.test(t) || TRIVIAL_AFFIRMATION.test(t);
}

/** Longitud mínima del último mensaje para entrar como primer bloque de la directiva. */
const MIN_CURRENT_MESSAGE_LENGTH = 10;

function meetsRequirementsMinLength(text: string, minLen: number): boolean {
  return text.length >= minLen;
}

/**
 * Texto de requisitos o petición del usuario para inyectar al Arquitecto (§3 y §4).
 * Prioridad: userInputAccumulated (bloques sustanciales que no sean solo "sí"/"ok"), luego dbgaContent.
 * Si el último mensaje es sustancial y aún no está cubierto en el acumulado, se añade (evita que una petición reciente no llegue al nodo cuando el acumulado no se fusionó igual).
 */
export function getUserExplicitRequirements(state: MDDStateType): string {
  let combined = "";
  const accumulated = (state.userInputAccumulated ?? "").trim();
  const accumulatedMinLen = minLengthForExplicitRequirements(accumulated);
  if (accumulated.length >= accumulatedMinLen) {
    const blocks = accumulated.split(/\n\n---\n\n/).map((s) => s.trim()).filter(Boolean);
    const substantial = blocks.filter(
      (b) =>
        meetsRequirementsMinLength(b, minLengthForExplicitRequirements(b)) &&
        !isTrivialUserText(b.replace(/^Usuario:\s*/i, "").trim()),
    );
    if (substantial.length > 0) {
      combined = substantial.join("\n\n");
    }
  }
  if (!combined.length) {
    const dbga = (state.dbgaContent ?? "").trim();
    if (dbga.length >= minLengthForExplicitRequirements(dbga) && !dbga.startsWith("(Sin Benchmark")) {
      const peticionMatch = dbga.match(/(?:Petición|Usuario|Respuesta del usuario)[:\s]*\n([\s\S]{1,1200})/i);
      combined = peticionMatch?.[1]?.trim() ? peticionMatch[1].trim() : dbga;
    }
  }
  const last = (state.lastUserMessage ?? "").trim();
  const lastMinLen = minLengthForExplicitRequirements(last);
  if (last.length >= lastMinLen && !isTrivialUserText(last)) {
    const lastNorm = last.replace(/^(Usuario|Petición):\s*/i, "").trim();
    const prefix = lastNorm.slice(0, Math.min(120, lastNorm.length));
    if (!combined.length) {
      combined = lastNorm;
    } else if (prefix.length >= 40 && !combined.includes(prefix)) {
      combined = `${combined}\n\n---\n\n${lastNorm}`;
    }
  }
  return combined.slice(0, MDD_MAX_EXPLICIT_REQUIREMENTS_CHARS);
}

const MIN_SUBSTANTIVE_LENGTH = 25;

/** Bloques que parecen pregunta del sistema, no requisito del usuario (excluir de directiva). */
const SYSTEM_QUESTION_PATTERN = /^(?:¿Ejecutar\s+este\s+plan|¿Puedes\s+detallar|¿Quieres\s+que\s+avancemos)/i;

/** Indicios de requisito de diseño: entidades, modelo, diagrama, aplicaciones, roles, permisos, stack, arquitectura, despliegue. */
const DESIGN_REQUIREMENT_REGEX = new RegExp(
  STACK_TECHNOLOGY_REGEX.source +
    "|\\b(aplicaciones?|diagrama\\s*(er|entidad|relaci[oó]n)?|entidad|entidades|modelo\\s+de\\s+datos|roles?|permisos?|relaci[oó]n(es)?|tablas?|usuarios?|CREATE\\s+TABLE|contratos?\\s+de\\s+api|endpoints?|documentaci[oó]n\\s+(de\\s+)?api|microservicio|consumo\\s+del\\s+microservicio|otras\\s+aplicaciones|api\\s+propia|secci[oó]n\\s*7|§7)\\b",
  "i",
);

/**
 * Ultimo mensaje sustancial del usuario (directiva al confirmar un plan): prioridad diseño > ultimo bloque > lastUserMessage.
 */
export function getLastSubstantiveUserMessage(state: MDDStateType): string {
  const accumulated = (state.userInputAccumulated ?? "").trim();
  if (accumulated.length >= MIN_SUBSTANTIVE_LENGTH) {
    const blocks = accumulated.split(/\n\n---\n\n/).map((s) => s.trim()).filter(Boolean);
    let fallback = "";
    for (let i = blocks.length - 1; i >= 0; i--) {
      const b = blocks[i];
      const withoutPrefix = b.replace(/^Usuario:\s*|Plan aprobado:\s*/gi, "").trim();
      if (withoutPrefix.length < MIN_SUBSTANTIVE_LENGTH || isTrivialUserText(withoutPrefix)) continue;
      if (SYSTEM_QUESTION_PATTERN.test(withoutPrefix)) continue;
      if (DESIGN_REQUIREMENT_REGEX.test(withoutPrefix)) return withoutPrefix.slice(0, 800);
      if (!fallback) fallback = withoutPrefix.slice(0, 800);
    }
    if (fallback) return fallback;
  }
  const last = (state.lastUserMessage ?? "").trim();
  if (last.length >= MIN_SUBSTANTIVE_LENGTH && !isTrivialUserText(last)) return last.slice(0, 800);
  return "";
}

const MAX_PLAN_BLOCKS = 4;

/**
 * Directiva completa para el plan: agrega varios bloques con requisitos de diseño + fragmento de clarifiedScope.
 * Usar como planUserIntent para que el Arquitecto y el Critic reciban la intención completa (no solo el último mensaje).
 */
export function getPlanDirective(state: MDDStateType): string {
  const parts: string[] = [];
  const accumulated = (state.userInputAccumulated ?? "").trim();
  const strip = (b: string) => b.replace(/^Usuario:\s*|Plan aprobado:\s*|Petición:\s*/gi, "").trim();

  // Primer bloque: el mensaje actual (si es sustantivo). Sin esto, con acumulado/alcance ya poblados
  // la petición recién escrita quedaba fuera de la directiva y se perdía al aprobar el plan ("sí").
  const lastRaw = strip((state.lastUserMessage ?? "").trim());
  const currentMessage =
    lastRaw.length >= MIN_CURRENT_MESSAGE_LENGTH && !isTrivialUserText(lastRaw) && !SYSTEM_QUESTION_PATTERN.test(lastRaw)
      ? lastRaw.slice(0, MDD_MAX_PLAN_BLOCK_CHARS)
      : "";
  const sameAsCurrent = (b: string) =>
    !!currentMessage && (b === currentMessage || b.startsWith(currentMessage.slice(0, 120)) || currentMessage.startsWith(b.slice(0, 120)));

  if (accumulated.length >= MIN_SUBSTANTIVE_LENGTH || currentMessage) {
    const blocks = accumulated.split(/\n\n---\n\n/).map((s) => s.trim()).filter(Boolean);
    const substantial: string[] = [];
    for (let i = blocks.length - 1; i >= 0 && substantial.length < MAX_PLAN_BLOCKS; i--) {
      const withoutPrefix = strip(blocks[i]);
      if (withoutPrefix.length < MIN_SUBSTANTIVE_LENGTH || isTrivialUserText(withoutPrefix)) continue;
      if (SYSTEM_QUESTION_PATTERN.test(withoutPrefix)) continue;
      if (sameAsCurrent(withoutPrefix.slice(0, MDD_MAX_PLAN_BLOCK_CHARS))) continue;
      substantial.unshift(withoutPrefix.slice(0, MDD_MAX_PLAN_BLOCK_CHARS));
    }
    const ordered = currentMessage ? [currentMessage, ...substantial] : substantial;
    if (ordered.length > 0) {
      parts.push("Requisitos del usuario (conversación reciente):\n" + ordered.join("\n\n---\n\n"));
    }
  }
  const scope = (state.clarifiedScope ?? "").trim();
  if (scope.length >= 50) {
    const fragment = scope.slice(0, 500) + (scope.length > 500 ? "…" : "");
    parts.push("Alcance clarificado (resumen):\n" + fragment);
  }
  const combined = parts.join("\n\n");
  if (combined.length > MDD_MAX_PLAN_DIRECTIVE_CHARS) return combined.slice(0, MDD_MAX_PLAN_DIRECTIVE_CHARS) + "…";
  if (combined) return combined;
  return getLastSubstantiveUserMessage(state);
}
