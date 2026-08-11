/**
 * Despega encabezados markdown pegados a prosa u otros headings (§1 MDD, BRD, handoff).
 * SSOT compartido entre `formatDocumentMarkdown` (Workshop /formatear), `mdd-sanitize` y `MddViewer`.
 */

const MDD_TOP_SECTION_TITLE =
  /^(?:Contexto|Arquitectura y Stack|Modelo de Datos|Contratos de API|Lógica y Edge Cases|Seguridad|Integración y DevOps|Testing|UI\/UX|Manifest)\b/i;

/** `1. Contexto y Alcance ### Propósito` (sin `##`) → H2 + ### en líneas separadas. */
function fixBareNumberedSectionGluedSubheadings(draft: string): string {
  return draft.replace(/^(\d+\.\s+[^\n#]+?)\s+(#{2,4}\s+)/gm, "## $1\n\n$2");
}

/** Promueve `1. Contexto y Alcance` suelto a `## 1. Contexto y Alcance`. */
function promoteBareNumberedMddSectionLine(draft: string): string {
  return draft.replace(/^(?!\s*#)(\d+\.\s+[^\n#]+)$/gm, (line) => {
    const title = line.trim().replace(/^\d+\.\s+/, "");
    if (!MDD_TOP_SECTION_TITLE.test(title)) return line;
    return `## ${line.trim()}`;
  });
}

/** Normaliza `### 1. Contexto` → `## 1. Contexto` (secciones canónicas del MDD). */
function normalizeMddTopLevelSectionHeadings(draft: string): string {
  return draft.replace(
    /^#{1,6}\s+(\d+\.\s+(?:Contexto|Arquitectura y Stack|Modelo de Datos|Contratos de API|Lógica y Edge Cases|Seguridad|Integración y DevOps|Testing|UI\/UX|Manifest)[^\n]*)$/gim,
    "## $1",
  );
}

/** Despega `## 3. Foo### 3.1 Bar` o `## 3. Foo### SQL` → H2 + ### en líneas separadas. */
function fixGluedSubsectionHeadings(draft: string): string {
  return draft
    .replace(/^(##\s+\d+\.\s+[^\n#]+?)\s*(#{1,3}\s+\S+)/gm, "$1\n\n$2")
    .replace(/^(#{3,4}\s+[^\n#]+?)\s*(#{3,4}\s+\S+)/gm, "$1\n\n$2")
    .replace(/^\s+(#{3,4}\s+)/gm, "$1");
}

/** Asegura espacio tras `#` en headings (`###Foo` → `### Foo`). */
function normalizeMarkdownHeadingHashSpacing(draft: string): string {
  return draft.replace(/^(#{1,6})([^\s#\n])/gm, "$1 $2");
}

/** Parte subtítulos ### / #### incrustados en prosa (típico del Clarifier/Architect en §1). */
function fixInlineMarkdownSubheadings(draft: string): string {
  return draft
    .replace(
      /([^\n#])(\s+#{3,4}\s+(?=[A-Za-zÁÉÍÓÚÑ0-9]))/g,
      (_m, before: string, heading: string) => `${before}\n\n${heading.trim()}`,
    )
    .replace(/([.!?])\s+(#{3,4}\s+)/g, "$1\n\n$2")
    .replace(/([)\]])\s+(#{2,4}\s+)/g, "$1\n\n$2")
    .replace(
      /([a-záéíóúñA-ZÁÉÍÓÚÑ0-9])\s+(#{2,4}\s+(?=[A-ZÁÉÍÓÚÑ]))/g,
      "$1\n\n$2",
    );
}

/** Separa corridas de etiquetas en negrita en la misma línea (escenarios UAT, riesgos). */
function splitInlineBoldLabelRuns(draft: string): string {
  return draft
    .replace(/(\*\*[^*\n]+\*\*)\s+(\*\*[^*\n]+\*\*)/g, "$1\n\n$2")
    .replace(/([^\n#])(\s+\*\*(?:Escenario|Riesgo)\s+\d+)/gi, "$1\n\n$2");
}

/** Despega cuerpo en **negrita** pegado a la línea de un encabezado. */
function fixGluedHeadingBoldBody(draft: string): string {
  return draft.replace(/^(#{2,6}\s+[^\n*]+?)\s+(\*\*[^\n]+)$/gm, "$1\n\n$2");
}

/** Despega H2/H3 de fences (ej. `## 3. Modelo de Datos```sql`). */
function fixGluedHeadingToCodeFence(draft: string): string {
  return draft.replace(
    /^(#{1,6}\s+[^\n`]+?)```(sql|json|mermaid|TechnicalMetadata)\b/gim,
    "$1\n\n```$2",
  );
}

/**
 * Quita sufijo `mermaid` pegado al título (LLM: `Superadminmermaid`, `…asíncronas)mermaid`).
 * No toca títulos legítimos con espacio o «(Mermaid)» antes del token.
 */
function fixGluedHeadingMermaidSuffix(draft: string): string {
  return draft.replace(/^(#{1,6}\s+.*[^\s(])mermaid\s*$/gim, "$1");
}

/** Línea de título suelta (sin #) con sufijo mermaid antes de un fence ```mermaid. */
function fixGluedPlainTitleMermaidSuffix(draft: string): string {
  return draft.replace(/^([^\n#`][^\n]*[^\s(])mermaid\s*\n(\s*```mermaid)/gim, "$1\n\n$2");
}

/** `### Título > cita` o `## Foo > bar` → heading + blockquote en líneas separadas. */
function splitHeadingFromGluedBlockquote(draft: string): string {
  return draft
    .split("\n")
    .map((line) => {
      const match = line.match(/^(\s*(?:#{1,6}\s+.+?))\s+>\s+(.+)$/);
      if (!match) return line;
      return `${match[1]}\n\n> ${match[2]!.trim()}`;
    })
    .join("\n");
}

/** Despega prosa pegada al título en la misma línea (`### Título Este sistema…`). */
function splitHeadingTitleFromInlineProse(draft: string): string {
  const numberedTitle =
    /^(\d+\.\d+(?:\.\d+)?\s+(?:Propósito|Problema(?:\s+de\s+negocio)?|Objetivos(?:\s+comerciales)?|Alcance(?:\s+y\s+[Ff]ronteras)?|Visión|Contexto|Requisitos(?:\s+funcionales)?|Fronteras|Monetización|Arquitectura(?:\s+técnica)?|Backend|Frontend|Base de datos|Seguridad|Infraestructura)(?:\s+(?:del|de la|de)\s+\w+)?)(?:\s+)(.+)$/u;

  return draft
    .split("\n")
    .map((line) => {
      const trimmed = line.trim();
      if (!/^#{2,4}\s+/.test(trimmed)) return line;
      const m = trimmed.match(/^(#{2,4}\s+)(.+)$/);
      if (!m) return line;
      const [, prefix, rest = ""] = m;
      const indent = line.match(/^(\s*)/)?.[1] ?? "";

      const numbered = rest.match(numberedTitle);
      if (numbered && numbered[1]!.trim().length >= 5 && numbered[2]!.trim().length >= 12) {
        const prose = numbered[2]!.trim();
        if (/^[A-ZÁÉÍÓÚÑ0-9]/.test(prose)) {
          return `${indent}${prefix}${numbered[1]!.trim()}\n\n${indent}${prose}`;
        }
      }

      const body = rest.match(
        /^(.+?)\s+((?:Este|Esta|El|La|Los|Las|Un|Una|Desarrolladores|Jarvis|[A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,3}\s+es)\b[\s\S].*)$/u,
      );
      if (!body || body[1]!.trim().length < 8) return line;
      return `${indent}${prefix}${body[1]!.trim()}\n\n${indent}${body[2]!.trim()}`;
    })
    .join("\n");
}

/** Reparación genérica de headings pegados (iteración a punto fijo). */
/** Convierte viñetas `*` iniciales a `-` para homogeneizar listas (Fase 0 / DBGA). */
export function homogenizeMarkdownBulletMarkers(draft: string): string {
  return draft.replace(/^(\s*)\*\s+/gm, "$1- ");
}

/** `### ## 6. Seguridad` / `#### ## Integración` → conserva solo el heading interno canónico. */
export function repairStackedMarkdownHeadingMarkers(draft: string): string {
  if (!draft?.trim()) return draft ?? "";
  return draft
    .replace(/^#{3,6}\s+(#{1,2}\s+\d+\.\s+[^\n]+)$/gm, "$1")
    .replace(/^#{3,6}\s+(#{1,2}\s+(?:Integración|Infraestructura|Seguridad|Contexto|Manifest)\b[^\n]*)$/gim, "$1")
    .replace(/^#{3,6}\s+(#{1,2}\s+[^\n]+)$/gm, "$1");
}

export function repairGluedMarkdownHeadings(draft: string): string {
  if (!draft?.trim()) return draft ?? "";
  let out = repairStackedMarkdownHeadingMarkers(draft);
  out = fixBareNumberedSectionGluedSubheadings(out);
  out = fixGluedHeadingMermaidSuffix(out);
  out = fixGluedPlainTitleMermaidSuffix(out);
  out = fixGluedHeadingToCodeFence(out);
  let prev = "";
  while (prev !== out) {
    prev = out;
    out = fixGluedSubsectionHeadings(out);
    out = fixInlineMarkdownSubheadings(out);
    out = fixBareNumberedSectionGluedSubheadings(out);
  }
  out = normalizeMarkdownHeadingHashSpacing(out);
  out = promoteBareNumberedMddSectionLine(out);
  out = normalizeMddTopLevelSectionHeadings(out);
  out = fixGluedHeadingBoldBody(out);
  out = splitInlineBoldLabelRuns(out);
  out = out.replace(/^(##\s+\d+\.\s+[^\n#]+?)\s+(#{2,4}\s+)/gm, "$1\n\n$2");
  out = splitHeadingTitleFromInlineProse(out);
  out = splitHeadingFromGluedBlockquote(out);
  return out.replace(/\n{3,}/g, "\n\n");
}
