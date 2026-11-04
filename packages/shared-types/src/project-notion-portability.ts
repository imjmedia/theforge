import { z } from "zod";
import type { ProjectType } from "./project.js";

/** Versión del bundle Markdown & CSV (compatible con convenciones Notion). */
export const NOTION_PORTABILITY_VERSION = "1.0.0";

export const NOTION_PORTABILITY_FORMAT = "theforge-notion-portability" as const;

export const notionExportOptionsSchema = z.object({
  includeIntegration: z.boolean().optional().default(true),
  includeSessions: z.boolean().optional().default(false),
});

export type NotionExportOptions = z.infer<typeof notionExportOptionsSchema>;

export const notionImportBodySchema = z.object({
  name: z.string().min(1).max(120).optional(),
  groupId: z.string().uuid().optional(),
  visibility: z.enum(["PRIVATE", "SHARED"]).optional().default("PRIVATE"),
  relinkPartnerExportId: z.string().length(32).optional(),
});

export type NotionImportBody = z.infer<typeof notionImportBodySchema>;

export const notionImportPairBodySchema = z.object({
  newProjectName: z.string().min(1).max(120).optional(),
  legacyProjectName: z.string().min(1).max(120).optional(),
  groupId: z.string().uuid().optional(),
  visibility: z.enum(["PRIVATE", "SHARED"]).optional().default("PRIVATE"),
});

export type NotionImportPairBody = z.infer<typeof notionImportPairBodySchema>;

export interface NotionPortabilityManifest {
  format: typeof NOTION_PORTABILITY_FORMAT;
  version: string;
  exportedAt: string;
  projectName: string;
  projectExportId: string;
  projectType: ProjectType;
  options: NotionExportOptions;
}

export interface NotionPortabilityIdMap {
  projectExportId: string;
  originalProjectId: string;
  linkedLegacyProjectExportId: string | null;
  linkedNewProjectExportId: string | null;
  stages: Array<{
    exportId: string;
    originalStageId: string;
    ordinal: number;
  }>;
}

export interface NotionIntegrationLinkFile {
  version: string;
  newProjectExportId: string;
  legacyProjectExportId: string;
}

export interface NotionStageDocEntry {
  field: string;
  label: string;
  filenamePrefix: string;
}

/** Documentos markdown exportados por etapa (nombre de página Notion). */
export const NOTION_STAGE_DOC_ENTRIES: readonly NotionStageDocEntry[] = [
  { field: "mddContent", label: "MDD", filenamePrefix: "MDD" },
  { field: "brdContent", label: "BRD", filenamePrefix: "BRD" },
  { field: "specContent", label: "Spec", filenamePrefix: "Spec" },
  { field: "architectureContent", label: "Architecture", filenamePrefix: "Architecture" },
  { field: "useCasesContent", label: "Use Cases", filenamePrefix: "Use Cases" },
  { field: "userStoriesContent", label: "User Stories", filenamePrefix: "User Stories" },
  { field: "blueprintContent", label: "Blueprint", filenamePrefix: "Blueprint" },
  { field: "tasksContent", label: "Tasks", filenamePrefix: "Tasks" },
  { field: "apiContractsContent", label: "API Contracts", filenamePrefix: "API Contracts" },
  { field: "logicFlowsContent", label: "Logic Flows", filenamePrefix: "Logic Flows" },
  { field: "infraContent", label: "Infra", filenamePrefix: "Infra" },
  { field: "uxUiGuideContent", label: "Design System", filenamePrefix: "Design System" },
  { field: "uiScreensContent", label: "Pantallas", filenamePrefix: "Pantallas" },
  { field: "phase0SummaryContent", label: "Phase 0", filenamePrefix: "Phase 0" },
  { field: "aemContent", label: "AEM", filenamePrefix: "AEM" },
  { field: "changeSpecContent", label: "Change Spec", filenamePrefix: "Change Spec" },
  { field: "agentGovernanceContent", label: "Agent Governance", filenamePrefix: "Agent Governance" },
] as const;

export const NOTION_PROJECT_DOC_ENTRIES: readonly NotionStageDocEntry[] = [
  { field: "dbgaContent", label: "Benchmark", filenamePrefix: "Benchmark" },
  { field: "phase0SummaryContent", label: "Phase 0 Deep Research", filenamePrefix: "Phase 0 Deep Research" },
] as const;

const STAGE_DOC_BY_PREFIX = new Map(
  NOTION_STAGE_DOC_ENTRIES.map((entry) => [entry.filenamePrefix.toLowerCase(), entry.field]),
);

/** Id estable de 32 hex (convención Notion): UUID sin guiones. */
export function notionExportId(uuid: string): string {
  return uuid.replace(/-/g, "").toLowerCase();
}

/** Segmento seguro para carpetas/archivos (Notion-like). */
export function notionSafeSegment(name: string, maxLen = 80): string {
  const trimmed = name.trim() || "Untitled";
  const cleaned = trimmed
    .replace(/[\\/:*?"<>|]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned.slice(0, maxLen);
}

/** Nombre de página `.md` al estilo Notion: `Título {exportId}.md`. */
export function notionPageBasename(title: string, exportId: string): string {
  return `${notionSafeSegment(title)} ${exportId.slice(0, 32)}.md`;
}

/** Carpeta de etapa: `Etapa N — Nombre {stageExportId}`. */
export function notionStageFolderName(ordinal: number, name: string | null | undefined, exportId: string): string {
  const label = name?.trim() ? `Etapa ${ordinal} — ${notionSafeSegment(name, 60)}` : `Etapa ${ordinal}`;
  return `${label} ${exportId.slice(0, 32)}`;
}

export function resolveStageDocFieldFromBasename(basename: string): string | null {
  const withoutExt = basename.replace(/\.md$/i, "");
  const idMatch = withoutExt.match(/\s([0-9a-f]{32})$/i);
  const titlePart = idMatch ? withoutExt.slice(0, idMatch.index).trim() : withoutExt.trim();
  return STAGE_DOC_BY_PREFIX.get(titlePart.toLowerCase()) ?? null;
}

export function escapeCsvCell(value: string | null | undefined): string {
  const raw = value ?? "";
  if (/[",\n\r]/.test(raw)) {
    return `"${raw.replace(/"/g, '""')}"`;
  }
  return raw;
}

export function serializeCsv(headers: string[], rows: string[][]): string {
  const lines = [
    headers.map(escapeCsvCell).join(","),
    ...rows.map((row) => row.map(escapeCsvCell).join(",")),
  ];
  return `${lines.join("\n")}\n`;
}

/** Parser CSV mínimo (RFC4180) para imports Notion. */
export function parseCsv(text: string): { headers: string[]; rows: string[][] } {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;

  const pushCell = () => {
    row.push(cell);
    cell = "";
  };
  const pushRow = () => {
    if (row.length > 0 || cell.length > 0) {
      pushCell();
      rows.push(row);
    }
    row = [];
  };

  const src = text.replace(/^\uFEFF/, "");
  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        cell += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      pushCell();
    } else if (ch === "\n") {
      pushRow();
    } else if (ch === "\r") {
      if (src[i + 1] === "\n") i += 1;
      pushRow();
    } else {
      cell += ch;
    }
  }
  if (cell.length > 0 || row.length > 0) pushRow();

  if (rows.length === 0) return { headers: [], rows: [] };
  const headers = rows[0] ?? [];
  return { headers, rows: rows.slice(1) };
}

export function csvRowToRecord(headers: string[], row: string[]): Record<string, string> {
  const record: Record<string, string> = {};
  headers.forEach((header, index) => {
    record[header] = row[index] ?? "";
  });
  return record;
}

export function buildNotionIndexHtml(projectTitle: string, links: Array<{ href: string; label: string }>): string {
  const escapeHtml = (value: string) =>
    value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const items = links
    .map((link) => `    <li><a href="${escapeHtml(link.href)}">${escapeHtml(link.label)}</a></li>`)
    .join("\n");
  const title = escapeHtml(projectTitle);
  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8" />
  <title>${title}</title>
</head>
<body>
  <h1>${title}</h1>
  <ul>
${items}
  </ul>
</body>
</html>
`;
}

export function buildProjectMetadataMarkdown(input: {
  name: string;
  projectType: string;
  complexity: string;
  visibility: string;
  hasUxTeam: boolean;
  theforgeProjectId: string | null;
  phase0Status: string | null;
  exportedAt: string;
}): string {
  return [
    `# ${input.name}`,
    "",
    "| Campo | Valor |",
    "| --- | --- |",
    `| Tipo | ${input.projectType} |`,
    `| Complejidad | ${input.complexity} |`,
    `| Visibilidad | ${input.visibility} |`,
    `| Equipo UX | ${input.hasUxTeam ? "Sí" : "No"} |`,
    `| theforgeProjectId | ${input.theforgeProjectId ?? "—"} |`,
    `| Phase 0 | ${input.phase0Status ?? "idle"} |`,
    `| Exportado | ${input.exportedAt} |`,
    "",
  ].join("\n");
}
