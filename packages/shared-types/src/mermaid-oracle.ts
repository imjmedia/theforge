/**
 * Regla de oro de Mermaid, pura y sin dependencia de `mermaid`:
 *
 *  1. Si el original parsea, NO se toca (ni `trim`).
 *  2. Solo se intenta reparar lo que el parser rechaza.
 *  3. Una reparación se acepta únicamente si el parser la acepta.
 *  4. Si el parser no está disponible, el texto queda intacto (`unverified`); nunca se declara inválido.
 *
 * El parser se inyecta (`MermaidParser`): la web pasa `mermaid.parse` del navegador y la API un parser
 * Node (jsdom + mermaid). Este módulo solo orquesta candidatos y decide.
 */
import {
  decodeMermaidHtmlEntities,
  repairMermaidBlockBody,
  stripMermaidFenceWrappers,
} from "./mermaid.js";

/** Resultado de parsear un diagrama. `unavailable` = no se pudo consultar al parser (nunca implica inválido). */
export type MermaidParseResult =
  | { status: "ok"; diagramType?: string }
  | { status: "invalid"; error: string }
  | { status: "unavailable"; error: string };

export type MermaidParser = (text: string) => Promise<MermaidParseResult>;

export interface MermaidResolution {
  /**
   * - `original`: el original parsea; `text` es el original intacto.
   * - `repaired`: el original no parseaba y un candidato sí; `text` es el candidato.
   * - `invalid`: ni el original ni los candidatos parsean; `text` es el ORIGINAL.
   * - `unverified`: el parser no estuvo disponible; `text` es el ORIGINAL.
   */
  status: "original" | "repaired" | "invalid" | "unverified";
  text: string;
  original: string;
  /** Error del parser sobre el original (`invalid`) o motivo de indisponibilidad (`unverified`). */
  error?: string;
  diagramType?: string;
  /** Llamadas totales al parser (original + candidatos probados). */
  attempts: number;
  /** Índice (en la lista de candidatos) del candidato aceptado; solo con `repaired`. */
  candidateIndex?: number;
}

export interface ResolveMermaidOptions {
  /** Tope de candidatos de reparación a probar (el parseo del original no cuenta). Por defecto 5 (todos los candidatos de `proposeMermaidRepairs`). */
  maxAttempts?: number;
  signal?: AbortSignal;
  /** Generador de candidatos; por defecto `proposeMermaidRepairs`. */
  propose?: (body: string) => string[];
}

const DEFAULT_MAX_ATTEMPTS = 5;

/**
 * Candidatos de reparación para un cuerpo que el parser rechazó, deduplicados y distintos del original,
 * de menos a más invasivo.
 *
 * F1: cinco candidatos fijos (sin fences; sin fences y con entidades HTML decodificadas; reparación del
 * original; reparación sin fences; reparación con entidades decodificadas). Las entidades se decodifican
 * en candidatos propios porque `A --&gt; B` es habitual en MDDs persistidos y, al ser candidatos, solo se
 * aceptan si el parser los acepta (un `&amp;` legítimo dentro de una etiqueta nunca se toca si el original
 * ya parsea). En F3 se divide en reglas con nombre por tipo de diagrama, ofrecidas de
 * menos a más agresivas.
 */
export function proposeMermaidRepairs(body: string): string[] {
  const original = body ?? "";
  const stripped = stripMermaidFenceWrappers(original);
  const decoded = decodeMermaidHtmlEntities(stripped);
  const raw = [
    stripped,
    decoded,
    repairMermaidBlockBody(original),
    repairMermaidBlockBody(stripped),
    repairMermaidBlockBody(decoded),
  ];
  const seen = new Set<string>([original]);
  const out: string[] = [];
  for (const candidate of raw) {
    if (!candidate.trim() || seen.has(candidate)) continue;
    seen.add(candidate);
    out.push(candidate);
  }
  return out;
}

/** Un parser que lanza se trata como no disponible: nunca como diagrama inválido. */
async function safeParse(parse: MermaidParser, text: string): Promise<MermaidParseResult> {
  try {
    return await parse(text);
  } catch (err) {
    return {
      status: "unavailable",
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Resuelve un cuerpo Mermaid (sin fences) aplicando la regla de oro con el parser inyectado.
 * Idempotente: `resolve(resolve(x).text)` da `original` si el primero fue `original` o `repaired`.
 */
export async function resolveMermaidWithOracle(
  body: string,
  parse: MermaidParser,
  opts: ResolveMermaidOptions = {},
): Promise<MermaidResolution> {
  const original = body ?? "";
  const maxAttempts = Math.max(0, Math.floor(opts.maxAttempts ?? DEFAULT_MAX_ATTEMPTS));
  let attempts = 1;

  const first = await safeParse(parse, original);
  if (first.status === "ok") {
    return {
      status: "original",
      text: original,
      original,
      diagramType: first.diagramType,
      attempts,
    };
  }
  if (first.status === "unavailable") {
    return { status: "unverified", text: original, original, error: first.error, attempts };
  }

  const candidates = (opts.propose ?? proposeMermaidRepairs)(original);
  const seen = new Set<string>([original]);
  let tried = 0;
  for (let i = 0; i < candidates.length; i++) {
    if (tried >= maxAttempts || opts.signal?.aborted) break;
    const candidate = candidates[i]!;
    if (seen.has(candidate)) continue;
    seen.add(candidate);
    tried++;
    attempts++;
    const result = await safeParse(parse, candidate);
    if (result.status === "ok") {
      return {
        status: "repaired",
        text: candidate,
        original,
        diagramType: result.diagramType,
        attempts,
        candidateIndex: i,
      };
    }
    if (result.status === "unavailable") {
      return { status: "unverified", text: original, original, error: result.error, attempts };
    }
  }

  // Sin candidato válido (o tope/aborto): se conserva el original y el error del parser sobre él.
  return { status: "invalid", text: original, original, error: first.error, attempts };
}

export interface FenceBlock {
  /** Índice de la línea de apertura. */
  open: number;
  /** Índice de la línea de cierre (siempre existe: los fences sin cerrar se ignoran). */
  close: number;
  info: string;
}

/**
 * Localiza fences de nivel raíz (CommonMark: ≥3 acentos graves o tildes, cierre del mismo carácter y al
 * menos la misma longitud, sin info string). El contenido de un fence no se interpreta, así que un
 * ```mermaid dentro de un fence ````markdown no cuenta. Un fence sin cierre se ignora.
 */
export function findTopLevelFences(lines: string[]): FenceBlock[] {
  const blocks: FenceBlock[] = [];
  let i = 0;
  while (i < lines.length) {
    const open = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec((lines[i] ?? "").replace(/\r$/, ""));
    if (!open) {
      i++;
      continue;
    }
    const marker = open[1]!;
    const info = open[2]!.trim();
    // Un info string con acentos graves no abre fence (CommonMark).
    if (marker[0] === "`" && info.includes("`")) {
      i++;
      continue;
    }
    const closeRe = new RegExp(`^ {0,3}\\${marker[0]}{${marker.length},}[ \\t]*$`);
    let close = -1;
    for (let j = i + 1; j < lines.length; j++) {
      if (closeRe.test((lines[j] ?? "").replace(/\r$/, ""))) {
        close = j;
        break;
      }
    }
    if (close === -1) {
      i++;
      continue;
    }
    blocks.push({ open: i, close, info });
    i = close + 1;
  }
  return blocks;
}

/**
 * Resuelve cada fence ```mermaid del documento y sustituye solo los cuerpos `repaired`. El resto del
 * documento (incluidos fences de otros lenguajes y bloques `original`/`invalid`/`unverified`) queda
 * byte a byte igual.
 */
export async function resolveMermaidBlocksInDocument(
  markdown: string,
  parse: MermaidParser,
  opts: ResolveMermaidOptions = {},
): Promise<{ markdown: string; blocks: Array<MermaidResolution & { index: number }> }> {
  const doc = markdown ?? "";
  const lines = doc.split("\n");
  const mermaidFences = findTopLevelFences(lines).filter((f) =>
    /^mermaid(?:\s|$)/i.test(f.info),
  );

  const blocks: Array<MermaidResolution & { index: number }> = [];
  const replacements = new Map<number, { fence: FenceBlock; text: string }>();
  for (let index = 0; index < mermaidFences.length; index++) {
    const fence = mermaidFences[index]!;
    const body = lines.slice(fence.open + 1, fence.close).join("\n");
    const resolution = await resolveMermaidWithOracle(body, parse, opts);
    blocks.push({ ...resolution, index });
    if (resolution.status === "repaired") {
      replacements.set(fence.open, { fence, text: resolution.text });
    }
  }
  if (replacements.size === 0) return { markdown: doc, blocks };

  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const rep = replacements.get(i);
    if (!rep) {
      out.push(lines[i]!);
      continue;
    }
    out.push(lines[i]!, ...rep.text.split("\n"));
    i = rep.fence.close - 1; // la línea de cierre se copia en la siguiente vuelta
  }
  return { markdown: out.join("\n"), blocks };
}
