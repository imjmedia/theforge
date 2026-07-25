/**
 * @fileoverview Parser JSON — extrae JSON de bloques markdown o texto plano.
 */

import type { z } from "zod";

/**
 * Extrae contenido de un bloque ```json ... ``` si existe.
 */
export function extractJsonFromCodeBlock(text: string): string | null {
  const match = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (match?.[1]) return match[1].trim();
  return null;
}

/**
 * Extrae el primer objeto JSON completo (desde el primer `{` hasta el `}` que cierra).
 * Útil cuando el LLM devuelve texto con JSON embebido o markdown alrededor.
 */
export function extractFirstJsonObject(text: string): string | null {
  const fromBlock = extractJsonFromCodeBlock(text);
  if (fromBlock) {
    const obj = extractFirstJsonObjectRaw(fromBlock);
    if (obj) return obj;
  }
  return extractFirstJsonObjectRaw(text.trim());
}

function extractFirstJsonObjectRaw(trimmed: string): string | null {
  const start = trimmed.indexOf("{");
  if (start === -1) return null;
  let depth = 0;
  let inString: "'" | '"' | null = null;
  let i = start;
  const len = trimmed.length;
  while (i < len) {
    const c = trimmed[i];
    if (inString) {
      if (c === "\\") {
        i += 2;
        continue;
      }
      if (c === inString) inString = null;
      i++;
      continue;
    }
    if (c === '"' || c === "'") {
      inString = c;
      i++;
      continue;
    }
    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) return trimmed.slice(start, i + 1);
    }
    i++;
  }
  return null;
}

/**
 * Parsea texto que puede contener JSON con o sin markdown code fence.
 * Usado por nodos MDD y Benchmark para homologar el parsing de respuestas del LLM.
 * Si hay texto alrededor del JSON, intenta extraer el primer objeto con extractFirstJsonObject.
 */
export function parseJsonOrThrow<T>(text: string, schema: z.ZodType<T>): T {
  let stripped = text.replace(/^```json?\s*|\s*```$/g, "").trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripped) as unknown;
  } catch {
    const extracted = extractFirstJsonObject(stripped);
    if (extracted) parsed = JSON.parse(extracted) as unknown;
    else throw new SyntaxError("No se encontró JSON válido en la respuesta.");
  }
  return schema.parse(parsed);
}
