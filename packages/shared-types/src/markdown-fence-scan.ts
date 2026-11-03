/**
 * Semántica ÚNICA de bloques de código (```/~~~) para el pipeline MDD, el gate de entrega y la
 * rúbrica del eval. Sigue CommonMark por líneas: un bloque abierto solo se cierra con una línea
 * compuesta únicamente por el marcador (misma clase de carácter, longitud >= a la del opener).
 * Dentro de un bloque abierto TODO es contenido, incluida una línea "```mermaid" o
 * "```TechnicalMetadata".
 *
 * Contraste: contar ocurrencias de "```" (paridad) no distingue un cierre de un opener; por eso
 * no se usa en ningún sitio de este módulo ni de los que lo consumen.
 */

/** Bloque de código detectado. `startLine` / `endLine` son 1-based. */
export type MarkdownFenceBlock = {
  /** Info string en minúsculas (`sql`, `mermaid`, …); "" si no hay. */
  lang: string;
  /** Líneas interiores unidas por `\n` (sin el opener ni el cierre). */
  content: string;
  /** Marcador del opener tal cual (```, ````, ~~~). */
  fence: string;
  startLine: number;
  /** Línea del cierre, o `null` si el bloque no cierra antes del EOF. */
  endLine: number | null;
  closed: boolean;
};

export type MarkdownFenceScan = {
  blocks: MarkdownFenceBlock[];
  /** Por índice 0-based de línea: true si la línea pertenece a un bloque (opener, contenido o cierre). */
  inFence: boolean[];
  /** true si el último bloque queda abierto al EOF. */
  unclosed: boolean;
};

/** Opener: 0-3 espacios, 3+ backticks o tildes, info string sin espacios y nada más. */
const OPENER_RE = /^ {0,3}(`{3,}|~{3,})[ \t]*([^`\s]*)[ \t]*$/;
/** Línea compuesta solo por un marcador (candidato a cierre). */
const FENCE_ONLY_RE = /^ {0,3}(`{3,}|~{3,})[ \t]*$/;
/** Texto seguido de ``` al final: `  A --> B```` (cierre pegado dentro de un bloque). */
const GLUED_CLOSER_RE = /^(.*\S)(`{3,})[ \t]*$/;
/** Texto seguido de opener pegado: `…la firma.```sql` (solo fuera de bloque). */
const GLUED_OPENER_RE = /^(.*\S)(`{3,})([A-Za-z][\w+.-]*)[ \t]*$/;
/** Cierre pegado a un heading canónico: ```## 4. Contratos de API. */
const GLUED_CLOSER_HEADING_RE = /^(`{3,})[ \t]*(##\s+(?:[1-7]\.|UI\/UX).*)$/i;
/** Heading H2 canónico (§1–§7 numerados o UI/UX). */
const CANONICAL_H2_RE = /^##\s+(?:[1-7]\.|UI\/UX)/i;
/** Separador horizontal `---`. */
const HR_RE = /^\s*---\s*$/;
/** Langs que muestran Markdown de ejemplo: un opener anidado dentro de ellos es contenido. */
const MARKDOWN_LANGS = new Set(["markdown", "md"]);
/** Artefactos del MDD: un heading `###` dentro de ellos es prosa que quedó tras un fence sin cerrar. */
const MDD_ARTIFACT_LANGS = new Set(["sql", "postgres", "postgresql", "pgsql", "mermaid", "json", "technicalmetadata"]);
/** Heading H3 (`### …`). */
const H3_HEADING_RE = /^###\s+\S/;

function stripCr(line: string): string {
  return line.replace(/\r$/, "");
}

type ParsedOpener = { fence: string; lang: string };

function parseOpener(line: string): ParsedOpener | null {
  const m = OPENER_RE.exec(stripCr(line));
  if (!m) return null;
  return { fence: m[1]!, lang: (m[2] ?? "").toLowerCase() };
}

/** ¿`line` cierra un bloque abierto con marcador `fence`? */
function isCloser(line: string, fence: string): boolean {
  const m = FENCE_ONLY_RE.exec(stripCr(line));
  if (!m) return false;
  const run = m[1]!;
  return run[0] === fence[0] && run.length >= fence.length;
}

/**
 * Recorre `lines` (0-based) y devuelve los bloques de código y la pertenencia de cada línea.
 * Pura: no modifica el texto.
 */
export function scanMarkdownFences(lines: string[]): MarkdownFenceScan {
  const blocks: MarkdownFenceBlock[] = [];
  const inFence: boolean[] = lines.map(() => false);
  let open: { fence: string; lang: string; startIdx: number; body: string[] } | null = null;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? "";
    if (open === null) {
      const opener = parseOpener(line);
      if (opener) {
        inFence[i] = true;
        open = { fence: opener.fence, lang: opener.lang, startIdx: i, body: [] };
      }
      continue;
    }
    inFence[i] = true;
    if (isCloser(line, open.fence)) {
      blocks.push({
        lang: open.lang,
        content: open.body.join("\n"),
        fence: open.fence,
        startLine: open.startIdx + 1,
        endLine: i + 1,
        closed: true,
      });
      open = null;
    } else {
      open.body.push(line);
    }
  }

  if (open !== null) {
    blocks.push({
      lang: open.lang,
      content: open.body.join("\n"),
      fence: open.fence,
      startLine: open.startIdx + 1,
      endLine: null,
      closed: false,
    });
  }
  return { blocks, inFence, unclosed: open !== null };
}

type OpenState = { fence: string; lang: string } | null;

/** Línea siguiente no vacía de `lines` desde `from` (exclusivo), o `undefined`. */
function nextNonBlank(lines: string[], from: number): string | undefined {
  for (let j = from; j < lines.length; j += 1) {
    if ((lines[j] ?? "").trim() !== "") return lines[j];
  }
  return undefined;
}

/**
 * Repara fences rotos del borrador, de forma idempotente, con la semántica de
 * {@link scanMarkdownFences}. Reglas por línea, en este orden:
 *
 * a) Cierre pegado: dentro de un bloque abierto, `texto```` se parte en `texto` + línea "```".
 * b) Opener pegado a prosa: fuera de bloque, `texto.```sql` se parte en `texto.` + "```sql".
 * c) Opener anidado: dentro de un bloque abierto (salvo markdown/md), una línea "```lang" cierra
 *    el bloque anterior (línea "```" + línea en blanco) y abre el nuevo.
 * d) Heading canónico (§1–§7, UI/UX) dentro de un bloque abierto: se cierra el bloque antes
 *    (línea "```" + línea en blanco). Un `---` seguido de heading canónico también cierra antes.
 *    Un "```## N. …" pegado se trata como cierre + heading.
 *    Extensión (no está en la lista original): un heading `### …` dentro de un bloque abierto
 *    de artefacto MDD (sql, postgres, mermaid, json, TechnicalMetadata) cierra el bloque antes.
 * e) Bloque abierto al EOF: se cierra con su propio marcador.
 *
 * Sin fences rotos devuelve el mismo texto byte a byte.
 */
export function normalizeMarkdownFences(draft: string): string {
  const text = draft ?? "";
  if (!text.trim()) return text;

  const lines = text.split("\n");
  const out: string[] = [];
  const state: { open: OpenState } = { open: null };

  const closeOpen = (): void => {
    if (state.open === null) return;
    out.push(state.open.fence, "");
    state.open = null;
  };

  const feed = (line: string, index: number): void => {
    const bare = stripCr(line);

    if (state.open === null) {
      const opener = parseOpener(bare);
      if (opener) {
        state.open = opener;
        out.push(line);
        return;
      }
      // b) opener pegado a prosa
      const glued = GLUED_OPENER_RE.exec(bare);
      if (glued) {
        out.push(glued[1]!);
        feed(`${glued[2]}${glued[3]}`, index);
        return;
      }
      out.push(line);
      return;
    }

    const open = state.open;
    if (isCloser(bare, open.fence)) {
      out.push(line);
      state.open = null;
      return;
    }

    // d) cierre pegado a un heading canónico
    const gluedHeading = GLUED_CLOSER_HEADING_RE.exec(bare);
    if (gluedHeading && gluedHeading[1]!.length >= open.fence.length) {
      closeOpen();
      feed(gluedHeading[2]!, index);
      return;
    }

    // a) cierre pegado a texto (solo bloques con backticks)
    if (open.fence[0] === "`") {
      const glued = GLUED_CLOSER_RE.exec(bare);
      if (glued && glued[2]!.length >= open.fence.length) {
        out.push(glued[1]!, glued[2]!);
        state.open = null;
        return;
      }
    }

    // c) opener anidado con info string
    const nested = parseOpener(bare);
    if (nested && nested.lang !== "" && !MARKDOWN_LANGS.has(open.lang)) {
      closeOpen();
      feed(line, index);
      return;
    }

    // d) heading canónico, o hr seguido de heading canónico
    if (CANONICAL_H2_RE.test(bare)) {
      closeOpen();
      out.push(line);
      return;
    }
    if (HR_RE.test(bare)) {
      const next = nextNonBlank(lines, index + 1);
      if (next !== undefined && CANONICAL_H2_RE.test(stripCr(next))) {
        closeOpen();
        out.push(line);
        return;
      }
    }
    if (H3_HEADING_RE.test(bare) && MDD_ARTIFACT_LANGS.has(open.lang)) {
      closeOpen();
      out.push(line);
      return;
    }

    out.push(line);
  };

  lines.forEach((line, index) => feed(line, index));

  // e) bloque abierto al EOF
  if (state.open !== null) {
    while (out.length > 0 && out[out.length - 1]!.trim() === "") out.pop();
    out.push(state.open.fence, "");
    state.open = null;
  }
  return out.join("\n");
}
