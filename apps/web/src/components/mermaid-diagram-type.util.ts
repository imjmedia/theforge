/**
 * Detects Mermaid diagram type from content and determines Excalidraw support.
 * Shared detection for MddViewer, MarkdownMermaid, and ExcalidrawDiagramBlock.
 */

export type MermaidDiagramType =
  | "flowchart"
  | "erDiagram"
  | "sequenceDiagram"
  | "classDiagram"
  | "stateDiagram"
  | "unsupported";

/** First line of a Mermaid diagram body (header / declaration). */
export function mermaidDiagramHeaderLine(content: string): string {
  return content.trim().split(/\r?\n/, 1)[0]?.trim() ?? "";
}

/**
 * True when trimmed content starts with recognizable Mermaid diagram syntax.
 * Does not treat `language-mermaid` alone as sufficient (LLM may mis-tag fences).
 *
 * Note: `graph` without direction is intentionally excluded — paths like
 * `graph-internal/…` can false-positive on word boundaries in prose.
 */
export const MERMAID_DIAGRAM_START =
  /^\s*(?:erDiagram(?:\s+|\n|$)|flowchart\b|graph\s+(?:TD|TB|LR|RL|BT)\b|sequenceDiagram(?:\s+|\n|$)|stateDiagram(?:-v2)?(?:\s+|\n|$)|classDiagram(?:\s+|\n|$)|pie(?:\s+|\n|$)|gantt(?:\s+|\n|$)|journey(?:\s+|\n|$)|gitGraph(?:\s+|\n|$)|mindmap(?:\s+|\n|$)|timeline(?:\s+|\n|$)|blockDiagram(?:\s+|\n|$)|quadrantChart(?:\s+|\n|$)|xychart(?:\s+|\n|$)|requirementDiagram(?:\s+|\n|$)|C4Context(?:\s+|\n|$)|C4Container(?:\s+|\n|$)|C4Component(?:\s+|\n|$)|C4Dynamic(?:\s+|\n|$)|C4Deployment(?:\s+|\n|$)|sankey-beta(?:\s+|\n|$)|block-beta(?:\s+|\n|$))/i;

/** Content-only Mermaid syntax check (no `language-mermaid` class). */
export function looksLikeMermaidSyntax(source: string): boolean {
  const trimmed = source.trim();
  if (!trimmed) return false;
  return MERMAID_DIAGRAM_START.test(trimmed);
}

/** Fenced block is Mermaid when class says so or body matches diagram syntax. */
export function isMermaidCodeBlock(source: string, className?: string): boolean {
  if (!source.trim()) return false;
  if (/\blanguage-mermaid\b/i.test(className ?? "")) return true;
  return looksLikeMermaidSyntax(source);
}

/**
 * Detects the Mermaid diagram type from raw content.
 * Flowchart: `flowchart` (any direction or default), or `graph TD|TB|LR|RL|BT`.
 */
export function detectMermaidDiagramType(content: string): MermaidDiagramType {
  const first = mermaidDiagramHeaderLine(content);
  if (/^flowchart\b/i.test(first)) return "flowchart";
  if (/^graph\s+(?:TD|TB|LR|RL|BT)\b/i.test(first)) return "flowchart";
  if (/^erDiagram\b/i.test(first)) return "erDiagram";
  if (/^sequenceDiagram\b/i.test(first)) return "sequenceDiagram";
  if (/^classDiagram\b/i.test(first)) return "classDiagram";
  if (/^stateDiagram(-v2)?\b/i.test(first)) return "stateDiagram";
  return "unsupported";
}

/** True when a flowchart body declares at least one `subgraph` block. */
export function flowchartHasSubgraphs(content: string): boolean {
  return /^\s*subgraph\b/im.test(content);
}

/**
 * Devuelve true si el tipo ofrece el toggle de Excalidraw. Es el mismo conjunto que se admitía antes de la
 * Fase 1 (Jorge solo aprobó "SVG por defecto", no reducir el alcance del toggle):
 * - flowchart: elementos nativos editables.
 * - erDiagram, sequenceDiagram, classDiagram: la librería los convierte (nativos o imagen raster).
 * Decisión pendiente en el gate: restringirlo a lo que la librería convierte a elementos nativos
 * (flowchart sin subgraph y sequence), porque ER/class suelen salir como imagen no editable.
 */
export function isExcalidrawSupported(type: MermaidDiagramType): boolean {
  return ["flowchart", "erDiagram", "sequenceDiagram", "classDiagram"].includes(type);
}

/**
 * Returns true if the diagram type converts to native Excalidraw elements (fully editable).
 * Flowchart y sequence producen elementos nativos.
 */
export function isNativeExcalidraw(type: MermaidDiagramType): boolean {
  return type === "flowchart" || type === "sequenceDiagram";
}

/**
 * Vista por defecto: siempre SVG de Mermaid (render fiel y con la config web). Excalidraw es un toggle
 * opcional, solo para los tipos que `isExcalidrawSupported` admite.
 */
export function defaultMermaidViewMode(): "svg" | "excalidraw" {
  return "svg";
}
