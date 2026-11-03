/**
 * Reparaciones heurísticas para DBGA / Fase 0 mal formateados por el LLM.
 */

const DBGA_SHAPE_RE =
  /^#\s+(?:Domain Benchmark|Fase 0\s*[—-])/im;

const BARE_DBGA_SECTION_RE =
  /^(\d+\.\s+(?:Propósito y Alcance|Entidades del Dominio|Especificaciones Técnicas|Reglas de Negocio|Flujos Principales|Roles y Permisos|Integraciones Externas|Edge Cases y Supuestos|Microservicios y Arquitectura de Motores)[^\n]*)$/i;

const BARE_DBGA_SUBSECTION_RE =
  /^(\d+\.\d+)\s+([A-ZÁÉÍÓÚÑ][^\n]+)$/;

/** Pasos de flujo en tabla GFM rota. */
const FLOW_TABLE_STEP_RES = [
  /^\|\s*\|\s*(\d+)\.\s*\|\s*(.+?)\s*\|?\s*$/,
  /^\|\s*-\s*(\d+)\.\s*\|\s*(.+?)\s*\|?\s*$/,
  /^\|\s*(\d+)\.\s*\|\s*(.+?)\s*\|?\s*$/,
] as const;

const PIPE_BULLET_RE = /^\|\s*•\s*\|\s*(.+?)\s*\|?\s*$/;
const TABLE_SEP_RE = /^\|\s*:?-{3,}/;

function isDbgaShaped(text: string): boolean {
  return DBGA_SHAPE_RE.test(text ?? "");
}

function shouldUnwrapTextFenceBody(body: string): boolean {
  const lines = body.split("\n");
  let score = 0;
  for (const line of lines) {
    const t = line.trim();
    if (/^##\s+\d+\./.test(t)) score += 3;
    if (/^###\s+\d+\./.test(t)) score += 2;
    if (/^-\*\*R\d/.test(t)) score += 2;
    if (FLOW_TABLE_STEP_RES.some((re) => re.test(t))) score += 2;
    if (TABLE_SEP_RE.test(t)) score += 1;
    if (/^\|\s*Rol\s+\|/i.test(t)) score += 2;
    if (PIPE_BULLET_RE.test(t)) score += 2;
  }
  return score >= 2;
}

/** Quita fences ```text cuando el cuerpo es markdown estructurado, no diagrama ASCII. */
export function unwrapMarkdownInTextFences(text: string): string {
  if (!text?.trim()) return text ?? "";
  return text.replace(/```text\s*\n([\s\S]*?)```/gi, (full, body: string) => {
    if (!shouldUnwrapTextFenceBody(body)) return full;
    return `\n${body.trim()}\n`;
  });
}

function formatPipeBulletContent(raw: string): string {
  let content = raw.trim();
  const rule = content.match(/^(R\d+\.\d+)\s*-\s*(.+)$/i);
  if (rule) return `- **${rule[1]}** - ${rule[2]!.trim()}`;
  const edge = content.match(/^(E\d+\.\d+)\s*-\s*(.+)$/i);
  if (edge) return `- **${edge[1]}** - ${edge[2]!.trim()}`;
  if (!content.startsWith("- ")) return `- ${content}`;
  return content;
}

/** Convierte tablas `| • | … |` (reglas, integraciones, motores) a viñetas markdown. */
export function repairPipeBulletPseudoTables(text: string): string {
  const lines = text.split("\n");
  const out: string[] = [];
  let i = 0;

  while (i < lines.length) {
    const trimmed = lines[i]!.trim();
    const bulletMatch = trimmed.match(PIPE_BULLET_RE);
    if (bulletMatch) {
      const block: string[] = [formatPipeBulletContent(bulletMatch[1]!)];
      i += 1;
      if (i < lines.length && TABLE_SEP_RE.test(lines[i]!.trim())) i += 1;
      while (i < lines.length) {
        const next = lines[i]!.trim();
        const m = next.match(PIPE_BULLET_RE);
        if (!m) break;
        block.push(formatPipeBulletContent(m[1]!));
        i += 1;
        if (i < lines.length && TABLE_SEP_RE.test(lines[i]!.trim())) i += 1;
      }
      out.push(...block, "");
      continue;
    }
    out.push(lines[i]!);
    i += 1;
  }
  return out.join("\n");
}

/** Convierte pseudo-tablas de pasos de flujo a listas ordenadas. */
export function repairFlowStepPseudoTables(text: string): string {
  const lines = text.split("\n");
  const out: string[] = [];
  let i = 0;

  while (i < lines.length) {
    const trimmed = lines[i]!.trim();
    let stepMatch: RegExpMatchArray | null = null;
    for (const re of FLOW_TABLE_STEP_RES) {
      stepMatch = trimmed.match(re);
      if (stepMatch) break;
    }
    if (stepMatch) {
      const block: string[] = [`${stepMatch[1]}. ${stepMatch[2]!.trim()}`];
      i += 1;
      if (i < lines.length && TABLE_SEP_RE.test(lines[i]!.trim())) i += 1;
      while (i < lines.length) {
        const next = lines[i]!.trim();
        let m: RegExpMatchArray | null = null;
        for (const re of FLOW_TABLE_STEP_RES) {
          m = next.match(re);
          if (m) break;
        }
        if (!m) break;
        block.push(`${m[1]}. ${m[2]!.trim()}`);
        i += 1;
        if (i < lines.length && TABLE_SEP_RE.test(lines[i]!.trim())) i += 1;
      }
      out.push(...block, "");
      continue;
    }
    out.push(lines[i]!);
    i += 1;
  }
  return out.join("\n");
}

/** `## 2.` suelto antes de un ítem numerado → `2. …` */
export function repairOrphanNumberHeadings(text: string): string {
  return text.replace(
    /^##\s+(\d+)\.\s*\n+(\*\*[^\n]+(?:\*\*[^\n]*)?)/gm,
    "$1. $2",
  );
}

/** Segundo H1 DBGA tras Fase 0 → subtítulo en cursiva. */
export function repairDualDbgaTitles(text: string): string {
  if (!isDbgaShaped(text)) return text;
  const lines = text.split("\n");
  let seenFase0 = false;
  const out: string[] = [];
  for (const line of lines) {
    const t = line.trim();
    if (/^#\s+Fase 0\s*[—-]/i.test(t)) {
      seenFase0 = true;
      out.push(line);
      continue;
    }
    if (seenFase0 && /^#\s+Domain Benchmark/i.test(t)) {
      const subtitle = t.replace(/^#\s+/, "").trim();
      out.push("");
      out.push(`*${subtitle}*`);
      continue;
    }
    out.push(line);
  }
  return out.join("\n");
}

/** Promueve secciones numeradas sueltas (`7. Roles`, `4. Microservicios`). */
export function promoteBareDbgaSectionHeadings(text: string): string {
  if (!isDbgaShaped(text)) return text;
  const lines = text.split("\n");
  return lines
    .map((line) => {
      const t = line.trim();
      if (/^#{1,6}\s/.test(t)) return line;
      const top = t.match(BARE_DBGA_SECTION_RE);
      if (top) {
        const indent = line.match(/^(\s*)/)?.[1] ?? "";
        return `${indent}## ${top[1]!.trim()}`;
      }
      return line;
    })
    .join("\n");
}

/** `3.6 Módulo…` / `4.1 Definición…` sin `#`. */
export function promoteBareDbgaNumericHeadings(text: string): string {
  if (!isDbgaShaped(text)) return text;
  const lines = text.split("\n");
  return lines
    .map((line) => {
      const t = line.trim();
      if (/^#{1,6}\s/.test(t)) return line;
      const sub = t.match(BARE_DBGA_SUBSECTION_RE);
      if (!sub) return line;
      const indent = line.match(/^(\s*)/)?.[1] ?? "";
      const [, num, title] = sub;
      const major = num!.split(".")[0];
      const hashes = major === "4" ? "####" : "###";
      return `${indent}${hashes} ${num!.trim()} ${title!.trim()}`;
    })
    .join("\n");
}

/** `-**R5.1**` y viñetas con tab `•\tResponsabilidad:`. */
export function repairGluedDbgaBullets(text: string): string {
  return text
    .replace(/^(\s*)-\*\*([R]\d+\.\d+)\*\*/gm, "$1- **$2**")
    .replace(/^(\s*)-\*\*([R]\d+\.\d+)\*\*\s*-/gm, "$1- **$2** -")
    .replace(/^(\s*)-\*\*(Responsabilidad|Estado|Flujo):\*\*/gim, "$1- **$2:**")
    .replace(/^(\s*)•\t+/gm, "$1- ")
    .replace(/^(\s*)•\s+/gm, "$1- ");
}

/** Líneas de diagrama ASCII con prefijo `- ` erróneo (`- │`, `- ▼`). */
export function repairDiagramListArtifacts(text: string): string {
  return text
    .replace(/^- (\s*[│▼▲►◄─])/gm, "$1")
    .replace(/^- (\s*\[)/gm, "$1");
}

/** Elimina líneas de heading idénticas consecutivas. */
export function repairDuplicateAdjacentHeadings(text: string): string {
  const lines = text.split("\n");
  const out: string[] = [];
  for (const line of lines) {
    const t = line.trim();
    const prev = out[out.length - 1]?.trim() ?? "";
    if (t && t === prev && /^#{1,6}\s/.test(t)) continue;
    out.push(line);
  }
  return out.join("\n");
}

/** Cierra fences ``` vacíos tras subheadings. */
export function repairStrayFenceAfterSubheading(text: string): string {
  const lines = text.split("\n");
  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    const t = line.trim();
    out.push(line);
    if (/^#{3,6}\s+\d/.test(t)) {
      const next = (lines[i + 1] ?? "").trim();
      const next2 = (lines[i + 2] ?? "").trim();
      if (next === "```" && (next2 === "```" || next2 === "")) {
        i += next2 === "```" ? 2 : 1;
        continue;
      }
    }
    i += 1;
  }
  return out.join("\n");
}

/** Pipeline DBGA — solo aplica si el documento tiene forma DBGA/Fase 0. */
export function repairDbgaMarkdown(text: string): string {
  if (!text?.trim() || !isDbgaShaped(text)) return text ?? "";
  let out = text;
  out = repairDualDbgaTitles(out);
  out = repairStrayFenceAfterSubheading(out);
  out = repairDiagramListArtifacts(out);
  out = unwrapMarkdownInTextFences(out);
  out = repairStrayFenceAfterSubheading(out);
  out = unwrapMarkdownInTextFences(out);
  out = repairOrphanNumberHeadings(out);
  out = promoteBareDbgaSectionHeadings(out);
  out = promoteBareDbgaNumericHeadings(out);
  out = repairGluedDbgaBullets(out);
  out = repairPipeBulletPseudoTables(out);
  out = repairFlowStepPseudoTables(out);
  out = repairDuplicateAdjacentHeadings(out);
  return out;
}
