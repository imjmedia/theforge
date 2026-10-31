/**
 * @fileoverview Parseo tolerante de las preguntas del Clarifier (modo questions-only).
 *
 * Antes el schema era `z.array(z.string()).min(1).max(2)`: tres preguntas válidas
 * disparaban un ZodError y el nodo caía a las preguntas genéricas ("¿Cuáles son los
 * objetivos principales del sistema?"). Aquí se acepta cualquier cantidad, se
 * recortan a `CLARIFIER_MAX_QUESTIONS`, y si el JSON no parsea se rescatan las
 * preguntas del texto libre antes de recurrir al fallback.
 */

import { z } from "zod";
import { extractFirstJsonObject } from "./parse-json.js";

export const CLARIFIER_MAX_QUESTIONS = 2;
const MIN_QUESTION_CHARS = 15;

const GENERIC_QUESTIONS = [
  "¿Cuáles son los objetivos principales del sistema o producto?",
  "¿Qué aplicaciones o sistemas deben integrarse (ej. SSO, APIs)?",
];

const questionsJsonSchema = z.object({
  questions: z.array(z.unknown()).min(1),
});

function cleanQuestion(raw: unknown): string | null {
  if (typeof raw !== "string") {
    if (raw && typeof raw === "object") {
      const obj = raw as Record<string, unknown>;
      const key = ["question", "text", "pregunta", "content"].find((k) => typeof obj[k] === "string");
      if (key) return cleanQuestion(obj[key]);
    }
    return null;
  }
  const q = raw
    .replace(/^\s*(?:[-*•]|\d+[.)])\s*/, "")
    .replace(/^["'“”]+|["'“”]+$/g, "")
    .trim();
  return q.length >= MIN_QUESTION_CHARS ? q : null;
}

function dedupe(list: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const q of list) {
    const key = q.toLowerCase().replace(/\s+/g, " ");
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(q);
  }
  return out;
}

/** Preguntas embebidas en texto libre: «¿…?» o líneas que terminan en «?». */
function questionsFromProse(text: string): string[] {
  const out: string[] = [];
  const spanish = text.match(/¿[^¿?]{10,400}\?/g) ?? [];
  for (const m of spanish) {
    const q = cleanQuestion(m);
    if (q) out.push(q);
  }
  if (out.length === 0) {
    for (const line of text.split(/\r?\n/)) {
      const t = line.trim();
      if (/\?\s*$/.test(t)) {
        const q = cleanQuestion(t);
        if (q) out.push(q);
      }
    }
  }
  return out;
}

/**
 * Extrae hasta `CLARIFIER_MAX_QUESTIONS` preguntas del texto del LLM.
 * Orden: JSON `{questions:[…]}` (cualquier longitud) → preguntas en prosa. Devuelve [] si no hay nada usable.
 */
export function parseClarifierQuestions(text: string): string[] {
  const raw = (text ?? "").trim();
  if (!raw) return [];
  let fromJson: string[] = [];
  const jsonStr = extractFirstJsonObject(raw) ?? raw;
  try {
    const parsed = questionsJsonSchema.safeParse(JSON.parse(jsonStr));
    if (parsed.success) {
      fromJson = parsed.data.questions.map(cleanQuestion).filter((q): q is string => q != null);
    }
  } catch {
    // no es JSON; se intenta prosa
  }
  const candidates = fromJson.length > 0 ? fromJson : questionsFromProse(raw);
  return dedupe(candidates).slice(0, CLARIFIER_MAX_QUESTIONS);
}

const FEEDBACK_ITEM_RE = /\[([^\]]+)\]\s*(.+?)\s*Corrección:\s*(.+?)(?=\s*\[[^\]]+\]\s|\s*$)/gs;

/**
 * Preguntas de respaldo cuando el LLM no produjo ninguna. Se derivan del feedback del
 * Auditor (propuesta + validación, que es lo que el prompt pide) y solo en último
 * término se usan las dos genéricas.
 */
export function fallbackClarifierQuestions(auditorFeedback?: string | null): string[] {
  const feedback = (auditorFeedback ?? "").trim();
  if (!feedback) return [...GENERIC_QUESTIONS];
  const out: string[] = [];
  for (const m of feedback.matchAll(FEEDBACK_ITEM_RE)) {
    const sections = m[1].trim();
    const fix = m[3].replace(/\s+/g, " ").trim().replace(/[.。]+$/, "");
    if (fix.length < 10) continue;
    out.push(`¿Validas aplicar esta corrección en ${sections}: ${fix.slice(0, 280)}${fix.length > 280 ? "…" : ""}?`);
    if (out.length >= CLARIFIER_MAX_QUESTIONS) break;
  }
  if (out.length > 0) return out;
  const excerpt = feedback.replace(/\s+/g, " ").slice(0, 280);
  return [`¿Confirmas que avancemos con lo que señala el Auditor: "${excerpt}${feedback.length > 280 ? "…" : ""}"?`];
}
