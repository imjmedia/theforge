/**
 * @fileoverview Validación de ideas de proyecto antes de generación DBGA.
 */

/** Mensaje NDJSON cuando la idea no alcanza para ejecutar el grafo DBGA. */
export const INSUFFICIENT_DBGA_IDEA_MESSAGE =
  "Escribe tu dominio o idea de producto con más detalle (problema, usuarios o referencia de mercado). Un saludo no basta para generar el Benchmark.";

const GREETING_ONLY =
  /^(hola|hello|hi|hey|buenas|buenos dias|buenas tardes|buenas noches|que tal|como estas|saludos|thanks|gracias)(\s+\S+){0,3}$/;

function normalizeForGreetingCheck(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Ideas demasiado cortas o solo saludo: el Scout suele responder en prosa y rompe el parseo JSON.
 */
export function isInsufficientDbgaIdea(idea: string): boolean {
  const t = idea.trim();
  if (!t) return true;
  if (t.length >= 24) return false;
  const normalized = normalizeForGreetingCheck(t);
  if (GREETING_ONLY.test(normalized)) return true;
  if (t.length < 8) return true;
  return false;
}
