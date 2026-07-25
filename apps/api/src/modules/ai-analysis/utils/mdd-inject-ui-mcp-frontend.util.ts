/**
 * @fileoverview Inyección de specs frontend desde MCP en el MDD.
 */

/** Etiqueta legible de la librería del MCP gráfico compatible activo. */
export function formatUiMcpLibraryLabel(meta: {
  libraryName: string | null;
  libraryVersion: string | null;
} | null | undefined): string | null {
  const name = meta?.libraryName?.trim();
  if (!name) return null;
  const ver = meta?.libraryVersion?.trim();
  return ver ? `${name} ${ver}` : name;
}

const SECTION2_HEADING = /^##\s*2\.\s*Arquitectura[^\n]*\n/im;
const FRONTEND_H3 = /^###\s*(?:2\.2\s*)?(?:Frontend|Arquitectura\s+Frontend)\s*$/im;
const UI_LIBRARY_LINE =
  /^(\s*(?:[-*]\s*)?(?:UI\s+Library|Librería\s+(?:de\s+Componentes|UI))\s*:\s*)(.+)$/im;

function alreadyContainsLabel(text: string, label: string): boolean {
  return text.toLowerCase().includes(label.toLowerCase());
}

/**
 * En §2 Frontend, añade la librería del MCP gráfico activo en la línea **UI Library**
 * (append ` + {label}` si ya existe; si no, crea la línea bajo Stack UI).
 */
export function injectUiMcpIntoMddFrontendSection(markdown: string, libraryLabel: string): string {
  const label = libraryLabel.trim();
  if (!label || !(markdown ?? "").trim()) return markdown;

  const section2Match = markdown.match(SECTION2_HEADING);
  if (!section2Match || section2Match.index === undefined) return markdown;

  const section2Start = section2Match.index + section2Match[0].length;
  const afterS2 = markdown.slice(section2Start);
  const nextH2 = afterS2.search(/\n##\s+/);
  const section2Body = nextH2 === -1 ? afterS2 : afterS2.slice(0, nextH2);
  const section2Tail = nextH2 === -1 ? "" : afterS2.slice(nextH2);

  const frontendMatch = section2Body.match(FRONTEND_H3);
  if (!frontendMatch || frontendMatch.index === undefined) {
    if (alreadyContainsLabel(section2Body, label)) return markdown;
    const injection =
      `\n\n### 2.2 Frontend\n\n**Stack UI:**\n- UI Library: ${label}\n`;
    const newSection2 = section2Body.trimEnd() + injection;
    return markdown.slice(0, section2Start) + newSection2 + section2Tail;
  }

  const feStart = frontendMatch.index;
  const feSlice = section2Body.slice(feStart);
  const afterTitle = feSlice.slice(frontendMatch[0].length);
  const nextH3 = afterTitle.search(/\n###\s+/);
  const feBlock = nextH3 === -1 ? feSlice : feSlice.slice(0, frontendMatch[0].length + nextH3);
  const feRest = nextH3 === -1 ? "" : feSlice.slice(feBlock.length);

  if (alreadyContainsLabel(feBlock, label)) return markdown;

  let newFeBlock = feBlock;
  const uiLibMatch = feBlock.match(UI_LIBRARY_LINE);
  if (uiLibMatch) {
    const prefix = uiLibMatch[1]!;
    const value = uiLibMatch[2]!.trim();
    const combined = `${value} + ${label}`;
    newFeBlock = feBlock.replace(UI_LIBRARY_LINE, `${prefix}${combined}`);
  } else if (/Stack\s+UI\s*:/i.test(feBlock)) {
    newFeBlock = `${feBlock.trimEnd()}\n    UI Library: ${label}\n`;
  } else {
    newFeBlock = `${feBlock.trimEnd()}\n\n**Stack UI:**\n- UI Library: ${label}\n`;
  }

  const newSection2Body =
    section2Body.slice(0, feStart) + newFeBlock + feRest;
  return markdown.slice(0, section2Start) + newSection2Body + section2Tail;
}

/** Bloque de contexto para el Arquitecto de Software (prompt MDD). */
export function buildUiMcpFrontendArchitectHint(libraryLabel: string): string {
  const label = libraryLabel.trim();
  if (!label) return "";
  return (
    `**MCP gráfico compatible activo:** ${label}. En la subsección **### 2.2 Frontend** (o ### Frontend), ` +
    `dentro de **Stack UI**, la línea **UI Library** DEBE incluir esta librería **además** del stack que definas ` +
    `(ej. \`UI Library: Tailwind CSS + Radix UI + ${label}\`). No omitas el MCP si está activo.`
  );
}
