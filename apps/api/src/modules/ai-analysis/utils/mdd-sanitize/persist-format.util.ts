import { repairGluedMarkdownHeadings } from "@theforge/shared-types";

function isValidContratosOrInfraSubheading(line: string): boolean {
  const t = line.replace(/^###\s+/, "").trim();
  if (/^(GET|POST|PUT|DELETE|PATCH)\s+\//i.test(t)) return true;
  if (/^7\.\d+/i.test(t)) return true;
  if (/^Manifest/i.test(t)) return true;
  if (/^Autenticación|^Autorización|^Aspectos|^Flujos|^Validaciones|^Casos\s+Borde/i.test(t)) return true;
  if (t.length <= 55 && !/[.=]/.test(t) && !/^(Endpoint|Lista|Crea|Obtiene|Configura|Valida|Consulta|Recibe|Stage)\b/i.test(t)) {
    return true;
  }
  return false;
}

export function demoteProseHeadingsInSectionBody(body: string): string {
  return body
    .split("\n")
    .map((line) => {
      if (/^#{3,6}\s+(#{1,2}\s+)/.test(line.trim())) {
        return line.trim().replace(/^#{3,6}\s+(#{1,2}\s+)/, "$1");
      }
      if (!/^###\s+/.test(line)) return line;
      if (isValidContratosOrInfraSubheading(line)) return line;
      const text = line.replace(/^###\s+/, "").trim();
      if (/=/.test(text)) return text;
      if (/\.\s*$/.test(text)) return text;
      if (/^Stage\s+\d+\s+-/i.test(text)) return text;
      if (/^(Endpoint|Lista|Crea|Obtiene|Configura|Valida|Consulta|Recibe)\b/i.test(text)) return text;
      if (text.length > 80) return text;
      return text;
    })
    .join("\n");
}

export function stripStrayBraceAfterJsonCodeBlocks(draft: string): string {
  if (!draft) return draft;
  return draft.replace(/(```json[\s\S]*?```)\s*\n\}\s*\n/g, "$1\n");
}

export function stripStrayParenAfterJsonCodeBlocks(draft: string): string {
  if (!draft) return draft;
  return draft.replace(/(```json[\s\S]*?```)\s*\)/g, "$1");
}

/** Elimina líneas `# ---` que el LLM usa como separador falso (no son headings válidos). */
export function stripHashDashSeparatorLines(draft: string): string {
  if (!draft?.trim()) return draft ?? "";
  return draft
    .split("\n")
    .filter((line) => !/^#\s+[-–—\s]{2,}\s*$/.test(line.trim()))
    .join("\n");
}

/** Une viñetas partidas en líneas distintas: `- \n\n **Escenario` → `- **Escenario`. */
export function repairSplitMarkdownBullets(draft: string): string {
  if (!draft?.trim()) return draft ?? "";
  let out = draft.replace(/^-\s*\n+\s+(\*\*)/gm, "- $1");
  out = out.replace(/^-\s*\n+\s+(\S)/gm, "- $1");
  out = out.replace(/^-\s*\n+\s*$/gm, "");
  return out;
}

/** Despega cierre de fence pegado al siguiente H2: ` ```## 4. Contratos` → salto real. */
export function repairGluedClosingFenceToHeading(draft: string): string {
  if (!draft?.trim()) return draft ?? "";
  return draft.replace(/```[ \t]*(\n)?(?=##\s+\d+\.)/g, "```\n\n");
}

/** Quita pares de backticks vacíos (` `` `) que rompen el render. */
export function stripLoneBacktickPairLines(draft: string): string {
  if (!draft?.trim()) return draft ?? "";
  return draft.replace(/^\s*``\s*$/gm, "").replace(/\n``\s*\n/g, "\n");
}

export function collapseInlineHorizontalRules(draft: string): string {
  let out = draft.replace(/(?:^|\n)\s*---(?:\s+---\s*)+(?=\s*(?:\n|$))/g, "\n---\n");
  out = out.replace(/\n\s*--\s*\n(?=\s*##\s+)/g, "\n---\n");
  out = out.replace(/\n\s*-\s*\n(?=\s*##\s+)/g, "\n");
  out = out.replace(/\n\s*--\s*$/gm, "");
  return collapseConsecutiveHorizontalRules(out);
}

export function closeUnclosedCodeFencesInDraft(draft: string): string {
  if (!draft?.trim()) return draft ?? "";
  const closeBeforeH2 = "(?=\\n---[\\s\\S]*?\\n##\\s|\\n##\\s+(?:UI\\/UX|\\d+\\.))";
  const langs = "json|sql|mermaid|TechnicalMetadata|dockerfile";
  return draft.replace(
    new RegExp(`(\\\`\\\`\\\`(?:${langs})\\s*\\n)([\\s\\S]*?)${closeBeforeH2}`, "gi"),
    (match, open: string, body: string) => {
      if (/\n```[ \t]*(?:\r?\n|$)/.test(body)) return match;
      return `${open}${body.trimEnd()}\n\`\`\`\n`;
    },
  );
}

export function stripEmptyBareCodeFences(draft: string): string {
  let result = stripLoneBacktickPairLines(draft).replace(/\n```[ \t]*\n\s*```[ \t]*\n/g, "\n");
  result = result.replace(/\n```[ \t]*\n(?=\s*---\s*\n|\s*##\s+|\s*###\s+(?:GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD)\s+)/g, (match, offset) => {
    const before = result.slice(0, offset);
    const fenceCount = (before.match(/```/g) ?? []).length;
    if (fenceCount % 2 === 1) return match;
    return "\n";
  });
  return result;
}

export function stripOrphanFenceWrappingProse(draft: string): string {
  return draft.replace(
    /(^#{2,4}\s+[^\n]+\n\n)```\s*\n([\s\S]*?)\n```(?=\n\n#{2,4}|\n\n---|\n*$)/gm,
    (_m, heading: string, prose: string) => {
      const trimmed = prose.trim();
      if (!trimmed) return _m;
      if (/^\s*(?:CREATE|import|FROM|SELECT|const |function |def |\{)/im.test(trimmed)) return _m;
      if (/^\{[\s\S]*"[\s\S]*\}/.test(trimmed)) return _m;
      return `${heading}${trimmed}\n`;
    },
  );
}

export function stripStrayParenBeforeH2(draft: string): string {
  return draft
    .replace(/\n\s*\)\s*\n+(---\s*\n)(\s*##\s+7\.)/g, "\n$1$2")
    .replace(/\n\s*\)\s*\n+(?=\s*##\s+)/g, "\n");
}

export function collapseConsecutiveHorizontalRules(draft: string): string {
  return draft.replace(/(\n---\s*\n)(\s*---\s*\n)*/g, "\n---\n");
}

export function ensureHorizontalRuleBeforeH2(draft: string): string {
  const lines = draft.split("\n");
  const result: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const isH2 = /^##\s+/.test(line);
    const prevLine = result[result.length - 1] ?? "";
    if (isH2 && prevLine.trim() !== "---") {
      // No insertar --- antes del primer ## si va justo tras el título # (opcional: siempre insertar)
      if (result.length > 0) result.push("---");
    }
    result.push(line);
  }
  return result.join("\n");
}

export function finalizeMddPersistFormatting(mddMarkdown: string): string {
  if (!mddMarkdown?.trim()) return mddMarkdown;
  let out = stripHashDashSeparatorLines(repairGluedMarkdownHeadings(mddMarkdown));
  out = repairGluedClosingFenceToHeading(out);
  out = repairSplitMarkdownBullets(out);
  out = collapseInlineHorizontalRules(out);
  out = ensureHorizontalRuleBeforeH2(out);
  out = collapseConsecutiveHorizontalRules(out);
  return out;
}
