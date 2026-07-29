import {
  checkApiVsMdd,
  extractEndpoints,
  extractMddSection4Endpoints,
  normEp,
  apiEndpointsMatch,
  type ApiConformanceResult,
} from "./conformance.service.js";
import { unifyApiContractsPrefix } from "./api-prefix-unify.util.js";

export function runApiConformanceCheck(
  mddContent: string,
  apiContent: string,
): ApiConformanceResult {
  return checkApiVsMdd(mddContent, apiContent);
}

/** Feedback conciso para reintento LLM. */
export function buildApiRetryFeedback(result: ApiConformanceResult): string {
  const parts: string[] = [];
  if (result.missingInApi.length > 0) {
    parts.push(
      `Faltan ${result.missingInApi.length} endpoint(s) del MDD §4 en el documento API. ` +
        `DEBES añadir UNA fila por endpoint en la tabla markdown (Método | Ruta | …): ` +
        result.missingInApi.slice(0, 12).join(", ") +
        (result.missingInApi.length > 12 ? ", …" : ""),
    );
  }
  if (result.extraInApi.length > 0) {
    parts.push(
      `Elimina o alinea ${result.extraInApi.length} endpoint(s) no declarados en MDD §4: ` +
        result.extraInApi.slice(0, 8).join(", ") +
        (result.extraInApi.length > 8 ? ", …" : ""),
    );
  }
  return parts.join("\n\n");
}

function indexApiTableRowsByNorm(apiContent: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const line of apiContent.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("|")) continue;
    if (/^\|\s*[-:]+\s*\|/.test(trimmed)) continue;
    const eps = extractEndpoints(trimmed);
    if (eps.length !== 1) continue;
    map.set(normEp(eps[0]!), trimmed);
  }
  return map;
}

function findRowForMddEndpoint(norm: string, rowByNorm: Map<string, string>): string | undefined {
  if (rowByNorm.has(norm)) return rowByNorm.get(norm);
  for (const [key, row] of rowByNorm) {
    if (apiEndpointsMatch(norm, key)) return row;
  }
  return undefined;
}

function defaultApiTableRow(ep: { method: string; path: string }): string {
  const path = ep.path.replace(/`/g, "").trim();
  return `| ${ep.method.toUpperCase()} | \`${path}\` | MDD §4 | Bearer | auto |`;
}

function extractApiDocPreamble(content: string): string {
  const lines = content.split(/\r?\n/);
  const out: string[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (/^\|\s*(GET|POST|PUT|PATCH|DELETE)\s*\|/i.test(trimmed)) break;
    if (/^#{1,3}\s+(GET|POST|PUT|PATCH|DELETE)\s+\//i.test(trimmed)) break;
    out.push(line);
  }
  const joined = out.join("\n").trim();
  return joined.length > 0 ? joined : "# Contratos API";
}

/**
 * Reconstruye la tabla API exactamente según MDD §4 (SSOT): sin extras, con filas faltantes.
 */
export function reconcileApiContractsToMdd(mddContent: string, apiContent: string): string {
  const { content: prefixed } = unifyApiContractsPrefix(mddContent, apiContent ?? "");
  const mddEps = extractMddSection4Endpoints(mddContent);
  if (mddEps.length === 0) return prefixed;

  const rowByNorm = indexApiTableRowsByNorm(prefixed);
  const rows: string[] = [];
  for (const ep of mddEps) {
    const norm = normEp(ep);
    rows.push(findRowForMddEndpoint(norm, rowByNorm) ?? defaultApiTableRow(ep));
  }

  const header = extractApiDocPreamble(prefixed);
  const table =
    `| Método | Ruta | Descripción | Auth | Notas |\n|--------|------|-------------|------|-------|\n` +
    rows.join("\n");

  return `${header}\n\n## Contratos API (MDD §4)\n\n${table}\n`;
}

/** Añade filas de tabla para endpoints §4 ausentes (conformidad determinista). */
export function injectMissingApiEndpoints(mddContent: string, apiContent: string): string {
  return reconcileApiContractsToMdd(mddContent, apiContent);
}

/** Reparación post-IA: tabla API = MDD §4 (prefijo unificado, sin endpoints extra). */
export function repairApiProgrammaticGaps(mddContent: string, apiContent: string): string {
  return reconcileApiContractsToMdd(mddContent, apiContent);
}
