/**
 * @fileoverview Limpieza de artefactos en sección 1 del MDD.
 */

/**
 * Limpieza post-Clarifier/§1: ruido de pegado BRD (Auto-trazabilidad, stubs truncados).
 */

const AUTO_TRAZABILIDAD_LINE = /^\s*\*\(Auto-trazabilidad\s+BRD:[^)]*\)\*\s*$/i;
const BRD_STUB_LINE = /^\s*BRD\s*[—–-]\s*.+$/i;

function isTruncatedBrdStubLine(line: string): boolean {
  const t = line.trim();
  if (!BRD_STUB_LINE.test(t)) return false;
  const stub = t.replace(/^BRD\s*[—–-]\s*/i, "").trim();
  if (stub.length === 0 || stub.length >= 140) return false;
  if (/[.!?:;)]$/.test(stub)) return false;
  return /\w$/.test(stub);
}

/** Quita líneas Auto-trazabilidad BRD y stubs BRD truncados a mitad de frase. */
export function stripBrdPasteNoiseFromSection1(body: string): string {
  const lines = (body ?? "").split(/\r?\n/);
  const out: string[] = [];
  for (const line of lines) {
    if (AUTO_TRAZABILIDAD_LINE.test(line)) continue;
    if (isTruncatedBrdStubLine(line)) continue;
    out.push(line);
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}
