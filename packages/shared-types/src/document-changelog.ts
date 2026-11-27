/**
 * Sección estándar «Registro de cambios del documento» para artefactos del Workshop.
 */

export const DOCUMENT_CHANGELOG_HEADING = "## Registro de cambios del documento";

export const DOCUMENT_CHANGELOG_TABLE_HEADER =
  "| Versión | Fecha | Descripción del cambio |\n| --- | --- | --- |";

/** Encabezado del changelog; acepta numeración opcional («## 3. Registro…») del compilador PAG. */
const CHANGELOG_HEADING_RE =
  /^#{1,3}\s+(?:\d+\.\s+)?Registro de cambios del documento\s*$/im;

/** Fila de versión con 3 celdas (Versión|Fecha|Descripción) o 4 (con Autor). */
const VERSION_ROW_RE =
  /^\|\s*(\d+(?:\.\d+)?)\s*\|(?:[^|]*\|){2,3}\s*$/gm;

const SPANISH_MONTHS = [
  "Enero",
  "Febrero",
  "Marzo",
  "Abril",
  "Mayo",
  "Junio",
  "Julio",
  "Agosto",
  "Septiembre",
  "Octubre",
  "Noviembre",
  "Diciembre",
] as const;

/** Fecha legible para filas del changelog (ej. «Mayo 2026»). */
export function formatDocumentChangelogDate(date: Date = new Date()): string {
  return `${SPANISH_MONTHS[date.getMonth()]} ${date.getFullYear()}`;
}

export type DocumentChangelogEntry = {
  version: string;
  date: string;
  description: string;
};

export type EnsureDocumentChangelogOptions = {
  /** Texto de la fila 1.0 si la sección no existe (ej. «Creación inicial del DBGA»). */
  initialDescription?: string;
  /** Fecha de la fila inicial; por defecto mes/año actual. */
  initialDate?: string;
};

/** Instrucciones para prompts LLM — misma regla en todos los artefactos generados. */
export function getDocumentChangelogLlmInstructions(
  date: Date = new Date(),
): string {
  const currentDate = formatDocumentChangelogDate(date);
  return `# Registro de cambios (OBLIGATORIO en todo documento)

Al **final** del markdown (después del contenido principal y **antes** de cualquier delimitador \`---FIN_*---\` si aplica), incluye siempre:

${DOCUMENT_CHANGELOG_HEADING}

${DOCUMENT_CHANGELOG_TABLE_HEADER}

Reglas:
- **Creación:** primera versión \`1.0\` con fecha mes/año en español (usa exactamente «${currentDate}») y descripción breve del artefacto (ej. «Creación inicial del DBGA»).
- **Actualización:** conserva todas las filas anteriores y **añade una fila nueva** al final con versión incrementada (\`1.1\`, \`1.2\`, …; salto a \`2.0\` solo si reestructuras el documento de forma mayor).
- **Descripción:** una línea clara del cambio material (qué se añadió, movió o eliminó).
- **Nunca** elimines filas históricas ni dejes la sección vacía.
- **Fecha obligatoria fila 1.0:** \`${currentDate}\` (mes y año del sistema; no inventes otra fecha).`;
}

/** @deprecated Usa getDocumentChangelogLlmInstructions() para inyectar la fecha del sistema. */
export const DOCUMENT_CHANGELOG_LLM_INSTRUCTIONS =
  getDocumentChangelogLlmInstructions();

export function hasDocumentChangelogSection(content: string): boolean {
  return CHANGELOG_HEADING_RE.test(content.trim());
}

/** Markdown sin la sección «Registro de cambios del documento» (y su tabla). */
export function documentBodyWithoutChangelog(content: string): string {
  const trimmed = content.trimEnd();
  const match = CHANGELOG_HEADING_RE.exec(trimmed);
  if (!match || match.index === undefined) return trimmed.trim();
  return trimmed.slice(0, match.index).trim();
}

/** True cuando solo queda la tabla de changelog (o casi nada de cuerpo). */
export function isChangelogOnlyDocument(content: string, minBodyChars = 80): boolean {
  return documentBodyWithoutChangelog(content).length < minBodyChars;
}

/**
 * Acota el texto donde buscar filas de versión: la sección posterior al encabezado del
 * changelog (hasta el siguiente heading), para no confundir tablas ajenas (p. ej. Tasks con
 * `| 13 | Logout | 1 | Baja |`) con versiones. Sin encabezado se devuelve el documento completo.
 */
function changelogSectionForVersionScan(content: string): string {
  const heading = CHANGELOG_HEADING_RE.exec(content);
  if (!heading) return content;
  const after = content.slice(heading.index + heading[0].length);
  const next = /^#{1,6}\s/m.exec(after);
  return next ? after.slice(0, next.index) : after;
}

/** Última versión semver simple (major.minor) encontrada en la tabla del changelog, o null. */
export function parseLatestDocumentVersion(content: string): string | null {
  let latest: { major: number; minor: number; raw: string } | null = null;
  for (const match of changelogSectionForVersionScan(content).matchAll(VERSION_ROW_RE)) {
    const raw = match[1] ?? "";
    const parts = raw.split(".");
    const major = Number.parseInt(parts[0] ?? "0", 10);
    const minor = Number.parseInt(parts[1] ?? "0", 10);
    if (Number.isNaN(major) || Number.isNaN(minor)) continue;
    if (
      !latest ||
      major > latest.major ||
      (major === latest.major && minor > latest.minor)
    ) {
      latest = { major, minor, raw };
    }
  }
  return latest?.raw ?? null;
}

/** Incrementa patch (minor digit): 2.7 → 2.8, 1.0 → 1.1 */
export function bumpDocumentPatchVersion(version: string): string {
  const parts = version.split(".");
  const major = Number.parseInt(parts[0] ?? "1", 10);
  const minor = Number.parseInt(parts[1] ?? "0", 10);
  if (Number.isNaN(major) || Number.isNaN(minor)) return "1.0";
  return `${major}.${minor + 1}`;
}

/** Incrementa major y resetea minor: 1.9 → 2.0 */
export function bumpDocumentMinorVersion(version: string): string {
  const parts = version.split(".");
  const major = Number.parseInt(parts[0] ?? "1", 10);
  if (Number.isNaN(major)) return "2.0";
  return `${major + 1}.0`;
}

/** Formatea una fila; con `columns = 4` añade la celda Autor («—»). */
function formatChangelogRow(
  entry: DocumentChangelogEntry,
  columns: 3 | 4 = 3,
): string {
  return columns === 4
    ? `| ${entry.version} | ${entry.date} | — | ${entry.description} |`
    : `| ${entry.version} | ${entry.date} | ${entry.description} |`;
}

/** Fila separadora de tabla GFM (`| ---`, `|:-----|`, `|---|`). */
const CHANGELOG_TABLE_SEPARATOR_RE = /^\|\s*:?-{3,}/;

/** Cuenta las celdas de una línea de tabla markdown. */
function countTableCells(line: string): number {
  return line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").length;
}

function buildChangelogSection(rows: DocumentChangelogEntry[]): string {
  const body = rows.map((r) => formatChangelogRow(r)).join("\n");
  return `${DOCUMENT_CHANGELOG_HEADING}\n\n${DOCUMENT_CHANGELOG_TABLE_HEADER}\n${body}`;
}

function inferInitialDescription(content: string): string {
  const head = content.slice(0, 800).toLowerCase();
  if (head.includes("domain benchmark") || head.includes("dbga")) {
    return "Creación inicial del DBGA";
  }
  if (head.includes("business requirements") || head.includes("brd")) {
    return "Creación inicial del BRD";
  }
  if (head.includes("master design") || /\bmdd\b/.test(head)) {
    return "Creación inicial del MDD";
  }
  if (head.includes("blueprint")) return "Creación inicial del Blueprint";
  if (head.includes("spec") || head.includes("especificación")) {
    return "Creación inicial del Spec";
  }
  if (head.includes("guía ux") || head.includes("ux/ui") || head.includes("design.md")) {
    return "Creación inicial de la Guía UX/UI";
  }
  if (head.includes("contratos de api") || head.includes("api contract")) {
    return "Creación inicial de Contratos API";
  }
  if (head.includes("flujos de lógica") || head.includes("logic flow")) {
    return "Creación inicial de Flujos de lógica";
  }
  if (head.includes("historias de usuario") || head.includes("user stor")) {
    return "Creación inicial de Historias de usuario";
  }
  if (head.includes("casos de uso") || head.includes("use case")) {
    return "Creación inicial de Casos de uso";
  }
  if (head.includes("arquitectura del sistema") || head.includes("architecture")) {
    return "Creación inicial del documento de Arquitectura";
  }
  if (head.includes("infraestructura") || head.includes("docker")) {
    return "Creación inicial del documento de Infraestructura";
  }
  if (head.includes("tasks") || head.includes("backlog")) {
    return "Creación inicial del documento de Tasks";
  }
  if (head.includes("deep research") || head.includes("research report")) {
    return "Creación inicial del informe de Deep Research";
  }
  return "Creación inicial del documento";
}

/** Fila 1.0 de 3 o 4 celdas: captura el prefijo, la fecha y el resto de la fila. */
const INITIAL_VERSION_ROW_RE = /^(\|\s*1\.0\s*\|)[^|\n]+(\|.*)$/gm;

/** Corrige la columna Fecha de la fila 1.0 al mes/año del sistema (o el indicado). */
export function fixDocumentChangelogInitialDate(
  content: string,
  date: string = formatDocumentChangelogDate(),
): string {
  if (!hasDocumentChangelogSection(content)) return content;
  return content.replace(
    INITIAL_VERSION_ROW_RE,
    (_match, prefix: string, rest: string) => `${prefix} ${date} ${rest}`,
  );
}

/**
 * Garantiza que el markdown termina con la sección de changelog.
 * Si ya existe, corrige la fecha de la fila 1.0 al mes/año del sistema.
 */
export function ensureDocumentChangelog(
  content: string,
  options: EnsureDocumentChangelogOptions = {},
): string {
  const trimmed = content.trimEnd();
  const initialDate = options.initialDate ?? formatDocumentChangelogDate();
  if (!trimmed) return buildChangelogSection([
    {
      version: "1.0",
      date: initialDate,
      description: options.initialDescription ?? "Creación inicial del documento",
    },
  ]);

  if (hasDocumentChangelogSection(trimmed)) {
    return fixDocumentChangelogInitialDate(trimmed, initialDate);
  }

  const section = buildChangelogSection([
    {
      version: "1.0",
      date: initialDate,
      description:
        options.initialDescription ?? inferInitialDescription(trimmed),
    },
  ]);

  return `${trimmed}\n\n${section}`;
}

/** Añade una fila al final de la tabla de changelog existente. */
export function appendDocumentChangelogEntry(
  content: string,
  entry: DocumentChangelogEntry,
): string {
  const trimmed = content.trimEnd();
  if (!hasDocumentChangelogSection(trimmed)) {
    return ensureDocumentChangelog(trimmed, {
      initialDescription: entry.description,
      initialDate: entry.date,
    });
  }

  const headingMatch = CHANGELOG_HEADING_RE.exec(trimmed);
  if (!headingMatch || headingMatch.index === undefined) {
    return `${trimmed}\n\n${formatChangelogRow(entry)}`;
  }

  const before = trimmed.slice(0, headingMatch.index).trimEnd();
  const fromHeading = trimmed.slice(headingMatch.index);
  const lines = fromHeading.split("\n");
  const tableLines: string[] = [];
  let i = 0;
  for (; i < lines.length; i++) {
    tableLines.push(lines[i] ?? "");
    // Separador GFM: `| ---`, `|:---|` (compilador PAG), `|---|`, etc.
    if (CHANGELOG_TABLE_SEPARATOR_RE.test((lines[i] ?? "").trim())) break;
  }
  for (i++; i < lines.length; i++) {
    const line = lines[i] ?? "";
    if (line.trim() === "") break;
    if (line.trim().startsWith("|")) tableLines.push(line);
    else break;
  }
  // La cabecera es la primera línea de tabla; define cuántas celdas lleva la fila nueva.
  const headerLine = tableLines.find((l) => l.trim().startsWith("|")) ?? "";
  const columns = countTableCells(headerLine) >= 4 ? 4 : 3;
  tableLines.push(formatChangelogRow(entry, columns));
  const rest = lines.slice(i).join("\n").trim();
  const section = [tableLines.join("\n"), rest].filter(Boolean).join("\n\n");
  return before ? `${before}\n\n${section}` : section;
}
