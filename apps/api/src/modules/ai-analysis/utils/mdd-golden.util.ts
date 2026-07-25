/**
 * @fileoverview Golden files de referencia para salidas MDD.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

const FIXTURES_DIR = join(__dirname, "fixtures/mdd");

/** Normaliza saltos de línea y espacios finales para comparación estable en golden tests. */
export function normalizeGoldenText(text: string): string {
  return text.replace(/\r\n/g, "\n").trimEnd();
}

export function loadGoldenFixture(name: string, kind: "in" | "out", ext: "md" | "json"): string {
  return readFileSync(join(FIXTURES_DIR, `${name}.${kind}.${ext}`), "utf8");
}

export function assertGoldenEqual(actual: string, expected: string, label: string): void {
  const normActual = normalizeGoldenText(actual);
  const normExpected = normalizeGoldenText(expected);
  if (normActual !== normExpected) {
    throw new Error(
      `[golden:${label}] output mismatch\n--- expected ---\n${normExpected}\n--- actual ---\n${normActual}`,
    );
  }
}
