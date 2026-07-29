/**
 * Reparaciones deterministas de formato MDD (§2 ASCII, §4 JSON, §5 BDD, cola truncada).
 */

const ASCII_DIAGRAM_CHARS = /[│┌└┬┴├┤┼▼▲◄►]|^[\s|+\\/_\-=]{4,}/;

function findJsonFenceClose(text: string, contentStart: number): number {
  let pos = contentStart;
  let depth = 1;
  while (pos < text.length && depth > 0) {
    const idx = text.indexOf("```", pos);
    if (idx === -1) return -1;
    const after = text.slice(idx + 3);
    if (/^json\b/i.test(after)) {
      depth++;
      pos = idx + 7;
      continue;
    }
    depth--;
    if (depth === 0) return idx;
    pos = idx + 3;
  }
  return -1;
}

function mapJsonFenceBodies(text: string, transform: (body: string) => string): string {
  if (!text) return text;
  const lower = text.toLowerCase();
  let result = "";
  let i = 0;
  while (i < text.length) {
    const open = lower.indexOf("```json", i);
    if (open === -1) {
      result += text.slice(i);
      break;
    }
    result += text.slice(i, open);
    let cursor = open + 7;
    if (text[cursor] === "\r") cursor++;
    if (text[cursor] === "\n") cursor++;
    const contentStart = cursor;
    const closeIdx = findJsonFenceClose(text, contentStart);
    if (closeIdx === -1) {
      result += text.slice(open);
      break;
    }
    const inner = text.slice(contentStart, closeIdx);
    const repaired = transform(inner);
    result += "```json\n" + repaired + "\n```";
    i = closeIdx + 3;
  }
  return result;
}

/** Dentro de bloques ```json, convierte viñetas `- "key":` en claves JSON válidas. */
export function repairJsonPaginationListMarkers(text: string): string {
  return mapJsonFenceBodies(text, (body) => body.replace(/^\s*-\s+(")/gm, "$1"));
}

/** Normaliza claves JSON con espacios inválidos emitidas por el LLM. */
export function repairInvalidJsonKeysWithSpaces(text: string): string {
  return mapJsonFenceBodies(text, (body) =>
    body
      .replace(/"is default"/gi, '"is_default"')
      .replace(/"(\w+)\s+(\w+)":/g, (m, a: string, b: string) => {
        if (a.toLowerCase() === "is" && b.toLowerCase() === "default") return '"is_default":';
        return m;
      }),
  );
}

/** Inserta comas faltantes entre objetos hermanos en arrays JSON. */
export function repairBrokenJsonArrayElements(text: string): string {
  return mapJsonFenceBodies(text, (body) => {
    let out = body.replace(/(\})\s*\n(\s*\{)/g, "$1,\n$2");
    const lines = out.split("\n");
    const fixed: string[] = [];
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      fixed.push(line);
      const trimmed = line.trim();
      const next = (lines[i + 1] ?? "").trim();
      if (!next.startsWith("{")) continue;
      if (trimmed.endsWith(",") || trimmed.endsWith("{") || trimmed === "[") continue;
      if (/^["\]}]|null|true|false|-?\d/.test(trimmed) || trimmed.endsWith("}")) {
        fixed[fixed.length - 1] = `${line.replace(/\s*$/, "")},`;
      }
    }
    return fixed.join("\n");
  });
}

/** Desanida fences ```json internos dentro de un bloque JSON (§4). */
export function repairNestedJsonFenceInContratos(text: string): string {
  return mapJsonFenceBodies(text, (body) => {
    let cleaned = body;
    let prev = "";
    while (prev !== cleaned) {
      prev = cleaned;
      cleaned = cleaned
        .replace(/^\s*```json\s*[\r]?\n/gim, "")
        .replace(/^\s*```\s*[\r]?\n/gm, "")
        .replace(/```json\s*/gi, "")
        .replace(/```/g, "");
    }
    return cleaned.trim();
  });
}

/** Separa `---### GET` y cierres JSON pegados al siguiente endpoint. */
export function repairGluedHrBeforeApiHeading(text: string): string {
  if (!text) return text;
  let out = text.replace(/\r\n/g, "\n");
  out = out.replace(
    /(\*\*(?:Request body|Response\s+\d+)[^*]*\*\*)```json/gi,
    "$1\n\n```json",
  );
  out = out.replace(/---(\s*)###\s+(GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD)\s/gi, "---\n\n### $2 ");
  out = out.replace(
    /(\})\s*---(\s*)###\s+(GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD)\s/gi,
    "$1\n```\n\n---\n\n### $3 ",
  );
  out = out.replace(
    /(\*\*Response\s+\d+:\*\*)\s*---(\s*)###\s+(GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD)\s/gi,
    "$1\n\n---\n\n### $3 ",
  );
  out = out.replace(
    /("updated_at":\s*"[^"]*")\s*---(\s*)###\s+(GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD)\s/gi,
    "$1\n}\n```\n\n---\n\n### $3 ",
  );
  out = out.replace(/(\n\}\s*)---(\s*)###\s+(GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD)\s/gi, "$1\n\n---\n\n### $3 ");
  return out;
}

/** Quita prefijo `- ` en líneas de diagrama ASCII dentro de ```text. */
export function repairBulletPrefixedAsciiInTextFences(text: string): string {
  if (!text) return text;
  return text.replace(/```text\s*\n([\s\S]*?)```/gi, (_full, body: string) => {
    const fixed = body
      .split("\n")
      .map((line: string) => {
        const trimmed = line.trim();
        const bullet = trimmed.match(/^[-*]\s+(.+)$/);
        if (!bullet) return line;
        const rest = bullet[1]!.trim();
        if (ASCII_DIAGRAM_CHARS.test(rest)) return rest;
        return line;
      })
      .join("\n");
    return `\`\`\`text\n${fixed}\n\`\`\``;
  });
}

/** Fusiona bloques ```text consecutivos (diagramas §2 partidos). */
export function mergeConsecutiveTextDiagramFences(text: string): string {
  if (!text) return text;
  let out = text;
  let prev = "";
  while (prev !== out) {
    prev = out;
    out = out.replace(
      /```text\s*\n([\s\S]*?)```[ \t]*\n+```text\s*\n([\s\S]*?)```/gi,
      (_m, a: string, b: string) => `\`\`\`text\n${a.trimEnd()}\n${b.trimStart()}\n\`\`\``,
    );
  }
  return out;
}

/** Normaliza encabezados BDD sueltos en §5 (### 1. + título, keywords Dado/Cuando/Entonces). */
export function repairMddSection5BddFormat(text: string): string {
  const headingMatch = text.match(/(?:^|\n)(##\s+5\.\s*Lógica[^\n]*)/i);
  if (!headingMatch || headingMatch.index === undefined) return text;
  const sectionStart = headingMatch.index + headingMatch[0].length;
  const rest = text.slice(sectionStart);
  const nextH2 = rest.search(/\n##\s+/);
  const body = nextH2 !== -1 ? rest.slice(0, nextH2) : rest;
  let fixed = body;
  fixed = fixed.replace(/^###\s+(\d+)\.\s*\n+\s*\*\*([^*]+)\*\*/gim, "### $1. $2");
  fixed = fixed.replace(/^###\s+(\d+)\.\s*\n+\s*([^\n#*][^\n]+)/gim, "### $1. $2");
  fixed = fixed.replace(
    /^-\s+(dado|cuando|entonces)\b/gim,
    (_m, kw: string) => `- **${kw.charAt(0).toUpperCase()}${kw.slice(1).toLowerCase()}**`,
  );
  if (fixed === body) return text;
  return text.slice(0, sectionStart) + fixed + (nextH2 !== -1 ? rest.slice(nextH2) : "");
}

/** Detecta cola truncada (fences, UI/UX, JSON §4 abierto). */
export function detectTruncatedMddTail(draft: string): string | null {
  const trimmed = (draft ?? "").trimEnd();
  if (!trimmed) return null;
  const lastJsonOpen = trimmed.lastIndexOf("```json");
  if (lastJsonOpen !== -1 && !trimmed.slice(lastJsonOpen + 7).includes("```")) {
    return "Contratos §4: bloque ```json abierto al final del documento.";
  }
  const fenceCount = (trimmed.match(/```/g) ?? []).length;
  if (fenceCount % 2 !== 0) {
    return "Documento truncado: fence ``` sin cerrar al final.";
  }
  const uiTail = trimmed.match(/\n##\s+UI\/UX\s+Design\s+Intent\b([\s\S]*)$/i)?.[1]?.trim() ?? "";
  if (uiTail && (/\*\*[A-Za-zÁÉÍÓÚáéíóú]{1,12}$/.test(uiTail) || />\s*[^<\n]{0,30}$/.test(uiTail))) {
    return "Sección UI/UX Design Intent truncada o incompleta.";
  }
  return null;
}

/** Pipeline agrupado de reparaciones MDD P0–P2. */
export function repairMddFormatIssues(text: string): string {
  if (!text?.trim()) return text ?? "";
  let out = text.replace(/\r\n/g, "\n");
  out = repairGluedHrBeforeApiHeading(out);
  out = repairJsonPaginationListMarkers(out);
  out = repairInvalidJsonKeysWithSpaces(out);
  out = repairBrokenJsonArrayElements(out);
  out = repairNestedJsonFenceInContratos(out);
  out = repairBulletPrefixedAsciiInTextFences(out);
  out = mergeConsecutiveTextDiagramFences(out);
  out = repairMddSection5BddFormat(out);
  return out;
}
