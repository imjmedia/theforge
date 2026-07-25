/**
 * Merge de MDD por sección (## N. …).
 *
 * Caso de uso: la IA (o el orquestador) devuelve un MDD nuevo, pero ese MDD
 * puede ser (a) una sección regenerada, (b) un documento regenerado completo
 * y truncado por límite de tokens, o (c) un documento regenerado completo y
 * completo. Esta utilidad evita el bug histórico en el que un MDD regenerado
 * pero TRUNCADO sobreescribía el documento persistido, perdiendo secciones
 * que ya estaban bien.
 *
 * Reglas:
 *  1. Si `incoming` está vacío o no tiene secciones, devuelve `existing` sin
 *     cambios.
 *  2. Si `incoming` contiene una sección con el mismo heading `## N. …` que
 *     `existing`, se reemplaza sólo ese bloque. El resto de `existing` se
 *     preserva íntegro.
 *  3. Si `incoming` tiene una sección que no existe en `existing`, se añade
 *     manteniendo el orden (se posiciona relativo a las otras secciones).
 *  4. El front matter (todo lo anterior al primer `## N. …`) del incoming
 *     reemplaza el de existing, salvo que incoming no traiga front matter
 *     propio (en ese caso se conserva el de existing).
 *  5. Si `incoming` parece una regeneración completa pero está claramente
 *     truncada (cubre mucho menos de la mitad del `existing` y `existing`
 *     tiene más de 3 secciones), se aplica merge, NO replace. Esto es la
 *     defensa principal contra el bug original.
 *  6. Code fences ``` ``` se respetan: nada dentro cuenta como `## N.`.
 *  7. Sub-secciones (`###`, `####`) forman parte del cuerpo de su sección
 *     padre; nunca se promueven a secciones.
 *
 * Mantén la función pura y determinista: el mismo par (existing, incoming)
 * produce el mismo output siempre.
 */

import {
  CONTRATOS_HAS_ENDPOINTS,
  isContratosPlaceholder,
  isContratosSubstantial,
} from "../ai-analysis/utils/mdd-sanitize/contratos-format.js";
import {
  reattachMddUiUxDesignIntentSuffix,
  splitMddUiUxDesignIntentSuffix,
} from "../ai-analysis/utils/mdd-sanitize/section-merge.js";

/** Orden canónico §1–§7 para serializar merge (evita §4 al final tras §7). */
function canonicalSectionSortKey(heading: string): number {
  const m = heading.match(/^##\s+(\d+)\./);
  if (m) {
    const n = parseInt(m[1]!, 10);
    return n >= 1 && n <= 7 ? n : 999;
  }
  return 999;
}

export type MddSection = {
  /** Texto literal del heading, ej. "## 4. Contratos de API". */
  heading: string;
  /** Cuerpo de la sección, sin el heading, sin trim. */
  body: string;
  /** Posición (1-based) de la sección dentro del documento (1 = primera). */
  order: number;
};

export type MddParseResult = {
  /** Texto anterior al primer `## N. …`. Vacío si no hay front matter. */
  frontMatter: string;
  /** Secciones en orden de aparición. */
  sections: MddSection[];
};

export type MddMergeStats = {
  /** Secciones del incoming que sustituyeron a una sección existente. */
  sectionsReplaced: string[];
  /** Secciones del incoming que se añadieron (no existían en existing). */
  sectionsAdded: string[];
  /** Secciones del existing que se preservaron porque no estaban en incoming. */
  sectionsKept: string[];
  /** `true` si incoming y existing son efectivamente iguales tras normalizar. */
  noChange: boolean;
  /** `true` si incoming es claramente más corto que existing (merge defensivo). */
  truncatedIncoming: boolean;
  /** Modo de merge aplicado. */
  mode: "full-replace" | "section-merge" | "keep-existing" | "first-write";
};

export type MddMergeResult = {
  /** Markdown final, listo para persistir. */
  content: string;
  /** Métricas del merge. */
  stats: MddMergeStats;
};

const FENCE_LINE_RE = /^[ \t]*(`{3,}|~{3,})/;

/** Parsea un MDD en front matter + secciones (level-2 numeradas). */
export function parseMddBySection(md: string | null | undefined): MddParseResult {
  const src = (md ?? "").replace(/\r\n/g, "\n");
  if (!src.trim()) return { frontMatter: "", sections: [] };

  // Identifica índices de headings `## N. …`, ignorando los que estén dentro
  // de un code fence abierto y no cerrado.
  const headingMatches: { index: number; length: number }[] = [];
  let inFence = false;
  let fenceMarker: string | null = null;
  const lines = splitLines(src);
  let cursor = 0;
  for (const line of lines) {
    const lineStart = cursor;
    cursor += line.length + 1; // +1 por el \n que splitLines omitió
    const fenceMatch = line.match(FENCE_LINE_RE);
    if (fenceMatch) {
      if (!inFence) {
        inFence = true;
        fenceMarker = fenceMatch[1]!;
      } else if (fenceMarker && line.trimStart().startsWith(fenceMarker)) {
        inFence = false;
        fenceMarker = null;
      }
      continue;
    }
    if (inFence) continue;
    const m = line.match(/^##\s+\d+\.\s+\S.*$/);
    if (m) {
      headingMatches.push({ index: lineStart, length: m[0].length });
    }
  }

  if (headingMatches.length === 0) {
    return { frontMatter: src, sections: [] };
  }

  const firstIdx = headingMatches[0]!.index;
  const frontMatter = src.slice(0, firstIdx);

  const sections: MddSection[] = [];
  for (let i = 0; i < headingMatches.length; i += 1) {
    const head = headingMatches[i]!;
    const bodyStart = head.index + head.length;
    const nextHead = headingMatches[i + 1];
    const bodyEnd = nextHead ? nextHead.index : src.length;
    const headingLine = src.slice(head.index, head.index + head.length);
    const body = src.slice(bodyStart, bodyEnd);
    sections.push({
      heading: headingLine.trim(),
      body,
      order: i + 1,
    });
  }

  return { frontMatter, sections };
}

/** Llave estable para mapear secciones entre documentos: número de sección. */
function sectionKey(heading: string): string {
  const m = heading.match(/^##\s+(\d+)\./);
  return m ? `§${m[1]}` : heading.trim();
}

/** Detecta un incoming que parece regeneración truncada. */
function looksTruncated(incoming: MddParseResult, existing: MddParseResult): boolean {
  if (existing.sections.length < 4) return false;
  if (incoming.sections.length === 0) return false;
  const incomingChars = incoming.frontMatter.length + incoming.sections.reduce((a, s) => a + s.heading.length + s.body.length, 0);
  const existingChars = existing.frontMatter.length + existing.sections.reduce((a, s) => a + s.heading.length + s.body.length, 0);
  if (existingChars === 0) return false;
  // Heurística: incoming cubre < 50% del existing Y existing tiene >3 secciones
  // y incoming tiene menos de la mitad de secciones. Ajustable vía test.
  if (incomingChars * 2 < existingChars && incoming.sections.length * 2 < existing.sections.length) {
    return true;
  }
  return false;
}

/** Normaliza para comparar igualdad "efectiva" (ignora espacios extremos). */
function normalized(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

/**
 * Merge principal. Ver documentación al inicio del archivo para reglas.
 */
export function mergeMddBySection(
  existing: string | null | undefined,
  incoming: string | null | undefined,
): MddMergeResult {
  const existingSplit = splitMddUiUxDesignIntentSuffix(existing ?? "");
  const incomingSplit = splitMddUiUxDesignIntentSuffix(incoming ?? "");
  const existingParsed = parseMddBySection(existingSplit.core);
  const incomingParsed = parseMddBySection(incomingSplit.core);
  const preservedUiUx = incomingSplit.uiUxSuffix || existingSplit.uiUxSuffix;

  // Caso 1: incoming vacío / sin secciones → mantener existing.
  if (incomingParsed.sections.length === 0) {
    return {
      content: existing ?? "",
      stats: {
        sectionsReplaced: [],
        sectionsAdded: [],
        sectionsKept: existingParsed.sections.map((s) => s.heading),
        noChange: true,
        truncatedIncoming: false,
        mode: existing ? "keep-existing" : "first-write",
      },
    };
  }

  // Caso 2: existing vacío → incoming es el primer write (acepta tal cual).
  if (existingParsed.sections.length === 0) {
    const sorted = [...incomingParsed.sections].sort(
      (a, b) => canonicalSectionSortKey(a.heading) - canonicalSectionSortKey(b.heading),
    );
    return {
      content: reattachMddUiUxDesignIntentSuffix(
        serializeMerged(incomingParsed.frontMatter, sorted),
        preservedUiUx,
      ),
      stats: {
        sectionsReplaced: [],
        sectionsAdded: incomingParsed.sections.map((s) => s.heading),
        sectionsKept: [],
        noChange: false,
        truncatedIncoming: false,
        mode: "first-write",
      },
    };
  }

  // Caso 3: incoming parece truncado → merge defensivo.
  const truncated = looksTruncated(incomingParsed, existingParsed);

  // Construye índice de existing por sección.
  const existingByKey = new Map<string, MddSection>();
  for (const sec of existingParsed.sections) {
    existingByKey.set(sectionKey(sec.heading), sec);
  }

  // Construye índice de incoming por sección.
  const incomingByKey = new Map<string, MddSection>();
  for (const sec of incomingParsed.sections) {
    incomingByKey.set(sectionKey(sec.heading), sec);
  }

  const replaced: string[] = [];
  const added: string[] = [];
  const kept: string[] = [];

  // Regla de "energía": FORZAR section-merge siempre que existing tenga
  // contenido. full-replace NUNCA es necesario en este flujo porque el
  // section-merge ya preserva las secciones existentes que incoming no cubre,
  // reemplaza las que sí cubre (con threshold de 20% por-sección que protege
  // contra placeholders), y añade secciones nuevas de incoming al final.
  // El "full-replace" era una optimización que en la práctica degrada
  // contenido cuando el LLM regenera con menos detalle (caso del Clarifier
  // iter 2 sobre el documento bueno de iter 1).
  if (existing && existing.trim().length > 0) {
    // Existing no vacío → usar SIEMPRE section-merge para preservar calidad.
    // La "inteligencia" del merge por sección + threshold 20% protege
    // contra placeholders vacíos del incoming.
  } else {
    // Existing vacío (primer write) → incoming es el primer write.
    const sorted = [...incomingParsed.sections].sort(
      (a, b) => canonicalSectionSortKey(a.heading) - canonicalSectionSortKey(b.heading),
    );
    const content = reattachMddUiUxDesignIntentSuffix(
      serializeMerged(incomingParsed.frontMatter, sorted),
      preservedUiUx,
    );
    return {
      content,
      stats: {
        sectionsReplaced: [],
        sectionsAdded: incomingParsed.sections.map((s) => s.heading),
        sectionsKept: [],
        noChange: false,
        truncatedIncoming: false,
        mode: "first-write",
      },
    };
  }

  // Modo merge: el orden de las secciones viene de existing (preserva orden
  // histórico). Se inserta cada sección de incoming en la posición de su
  // homóloga en existing, o al final si no existe.
  const mergedSections: MddSection[] = [];
  const seenKeys = new Set<string>();

  for (const existingSec of existingParsed.sections) {
    const key = sectionKey(existingSec.heading);
    const incomingSec = incomingByKey.get(key);
    if (incomingSec) {
      // Skip si el incoming está vacío / sólo whitespace / es claramente más
      // corto que el existing → preferimos conservar el existing bueno antes que
      // pisarlo con un placeholder vacío. Heurística: si incoming tiene < 20%
      // de los chars de existing, mantener existing. Sin lower-bound en existing
      // (el threshold 20% ya filtra secciones cortas sin disparar falsos
      // positivos — antes había un guard `existingBodyLen > 200` que dejaba
      // sin protección secciones como §4 "Contratos de API" con 30 chars).
      const existingBodyLen = existingSec.body.trim().length;
      const incomingBodyLen = incomingSec.body.trim().length;
      const existingBody = existingSec.body.trim();
      const incomingBody = incomingSec.body.trim();
      const preferIncomingOverContratosStub =
        key === "§4" &&
        isContratosPlaceholder(existingBody) &&
        (/```json/i.test(incomingBody) ||
          (isContratosSubstantial(incomingBody) && CONTRATOS_HAS_ENDPOINTS.test(incomingBody)));
      if (
        preferIncomingOverContratosStub ||
        !(
          incomingBodyLen === 0 ||
          (existingBodyLen > 0 && incomingBodyLen * 100 < existingBodyLen * 20)
        )
      ) {
        replaced.push(incomingSec.heading);
        mergedSections.push(incomingSec);
      } else {
        kept.push(existingSec.heading);
        mergedSections.push(existingSec);
      }
      seenKeys.add(key);
    } else {
      kept.push(existingSec.heading);
      mergedSections.push(existingSec);
    }
  }

  // Secciones nuevas del incoming (no existían) → añadir al final.
  for (const incomingSec of incomingParsed.sections) {
    const key = sectionKey(incomingSec.heading);
    if (!seenKeys.has(key)) {
      added.push(incomingSec.heading);
      mergedSections.push(incomingSec);
      seenKeys.add(key);
    }
  }

  const content = reattachMddUiUxDesignIntentSuffix(
    serializeMerged(
      incomingParsed.frontMatter || existingParsed.frontMatter,
      [...mergedSections].sort(
        (a, b) => canonicalSectionSortKey(a.heading) - canonicalSectionSortKey(b.heading),
      ),
    ),
    preservedUiUx,
  );

  return {
    content,
    stats: {
      sectionsReplaced: replaced,
      sectionsAdded: added,
      sectionsKept: kept,
      noChange: normalized(content) === normalized(existing ?? ""),
      truncatedIncoming: truncated,
      mode: "section-merge",
    },
  };
}

function serializeMerged(frontMatter: string, sections: MddSection[]): string {
  const out: string[] = [];
  const fm = frontMatter.replace(/\s+$/g, "");
  if (fm) out.push(fm);
  for (const sec of sections) {
    out.push(sec.heading);
    out.push(sec.body.replace(/^\n+/, ""));
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";
}

function splitLines(src: string): string[] {
  if (!src.length) return [];
  return src.split("\n");
}
