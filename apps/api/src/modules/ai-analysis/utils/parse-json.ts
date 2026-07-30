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
/**
 * Repara JSON cortado a mitad (el modelo agotó el tope de salida antes de cerrar el objeto).
 * Retrocede hasta el último `}`/`]` que cerró un contenedor completo y cierra ahí lo que
 * quedara abierto, descartando el elemento parcial. Devuelve null si el texto ya estaba
 * balanceado (no era truncamiento) o si no hay ningún punto de corte seguro.
 */
export function repairTruncatedJsonObject(text: string): string | null {
  const stack: Array<"{" | "["> = [];
  let inString = false;
  let lastSafeIndex = -1;
  // Contenedores abiertos EN el punto de corte, no al final del texto: tras el último cierre
  // completo el modelo suele haber abierto ya el elemento parcial que vamos a descartar.
  let safeStack: Array<"{" | "["> = [];
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inString) {
      if (c === "\\") {
        i++;
        continue;
      }
      if (c === '"') inString = false;
      continue;
    }
    if (c === '"') {
      inString = true;
      continue;
    }
    if (c === "{" || c === "[") {
      stack.push(c);
      continue;
    }
    if (c === "}" || c === "]") {
      stack.pop();
      lastSafeIndex = i + 1;
      safeStack = [...stack];
    }
  }
  if (stack.length === 0) return null;
  if (lastSafeIndex <= 0 || safeStack.length === 0) return null;
  const truncated = text.slice(0, lastSafeIndex).replace(/,\s*$/, "");
  const closers = [...safeStack].reverse().map((open) => (open === "{" ? "}" : "]")).join("");
  return truncated + closers;
}

export function parseJsonOrThrow<T>(text: string, schema: z.ZodType<T>): T {
  let stripped = text.replace(/^```json?\s*|\s*```$/g, "").trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripped) as unknown;
  } catch {
    const extracted = extractFirstJsonObject(stripped);
    if (extracted) {
      parsed = JSON.parse(extracted) as unknown;
    } else {
      // Último recurso: respuesta truncada por tope de tokens. Sin esto el nodo cae al
      // fallback y descarta todo lo que el modelo sí había generado.
      const repaired = repairTruncatedJsonObject(stripped);
      if (!repaired) throw new SyntaxError("No se encontró JSON válido en la respuesta.");
      parsed = JSON.parse(repaired) as unknown;
    }
  }
  return schema.parse(parsed);
}
