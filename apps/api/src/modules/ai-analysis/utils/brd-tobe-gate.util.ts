/**
 * @fileoverview Composición de preámbulo BRD To-Be para MDD.
 */

/**
 * Composición de preámbulo BRD para anteponer al MDD (solo BRD; To-Be y As-Is eliminados).
 */

/** Bloque markdown para anteponer al Benchmark/MDD si hay BRD presente. */
export function composeBrdPreamble(brdContent: string | null | undefined): string {
  const brd = (brdContent ?? "").trim();
  if (brd.length < 40) return "";
  return (
    "## Contexto — BRD (negocio, KPIs, alcance)\n\n" +
    brd.slice(0, 24_000) +
    "\n\n---\n\n" +
    "**Instrucción:** El MDD debe trazarse al BRD; no contradigas el BRD salvo que el Benchmark aporte matices explícitos.\n\n"
  );
}
