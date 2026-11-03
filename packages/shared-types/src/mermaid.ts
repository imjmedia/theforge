/**
 * @fileoverview **Experta en diagramas Mermaid** — única fuente de verdad para generar y normalizar
 * diagramas Mermaid en todo TheForge. Cubre todos los tipos de diagrama comunes.
 *
 * ## Reglas de normalización
 *
 * `normalizeMermaidDiagramBody` aplica en orden las reglas nombradas de `MERMAID_BODY_RULES`
 * (`listMermaidBodyRuleNames` las lista). Principio: un diagrama que el parser acepta no se toca;
 * cada regla solo repara una forma que Mermaid rechaza. Agrupadas:
 *
 * 1. Fences y markdown colado por el LLM: `fence-wrappers`, `markdown-prologue`, `markdown-leak`,
 *    `er-brd-markdown-leaks`, `orphan-list-prefix`.
 * 2. Cabeceras y preámbulo: `dedupe-header`, `er-ensure-header`, `sequence-ensure-header`,
 *    `split-preamble` / `restore-preamble` (front-matter y `%%{init}%%` no se reparan).
 * 3. Bloques: `block-balance` (`end` sobrantes o sin cerrar en subgraph y sequence), `par-ticipant`.
 * 4. erDiagram: `er-split-entity-blocks`, `er-duplicate-attr-types`, `er-cardinality-notation`,
 *    `er-pk-fk-commas` (`PK FK` sin coma pasa a `PK, FK`).
 * 5. flowchart: `subgraph-underscore`, `flowchart-node-id-spaces`, `flowchart-trailing-garbage`,
 *    `flowchart-multi-edge-split`, `flowchart-missing-target-ids` y comillas en etiquetas que
 *    Mermaid rechaza (`quote-flowchart-paren-labels`, `quote-flowchart-spaced-labels`,
 *    `quote-flowchart-edge-labels`).
 * 6. classDiagram y stateDiagram: `class-stereotype-split`, `class-keyword-case`, `state-keywords`.
 * 7. Texto y espacios: `literal-newline` (`\n` literal), `collapse-blank-lines`, `trim-body`.
 *
 * @copyright 2026 Jorge Correa
 * @license Apache-2.0
 */

// ─── Types ──────────────────────────────────────────────────────────────

export type MermaidDiagramType =
  | "flowchart"
  | "sequenceDiagram"
  | "classDiagram"
  | "erDiagram"
  | "stateDiagram"
  | "stateDiagram-v2"
  | "gantt"
  | "pie"
  | "gitGraph"
  | "quadrantChart"
  | "mindmap"
  | "timeline"
  | "xychart"
  | "block"
  | "packet";

export type FlowchartDirection = "TD" | "LR" | "BT" | "RL";

export interface FlowchartOptions {
  direction?: FlowchartDirection;
  nodes: FlowchartNode[];
  edges: FlowchartEdge[];
  subgraphs?: FlowchartSubgraph[];
}

export interface FlowchartNode {
  id: string;
  label: string;
  shape?: "box" | "rounded" | "circle" | "diamond" | "hexagon" | "parallelogram" | "stadium" | "trapezoid";
  style?: Record<string, string>;
}

export interface FlowchartEdge {
  from: string;
  to: string;
  label?: string;
  type?: "arrow" | "dotted" | "thick" | "both" | "open";
}

export interface FlowchartSubgraph {
  id: string;
  label: string;
  nodes: string[];
}

export interface SequenceOptions {
  title?: string;
  participants: string[];
  messages: SequenceMessage[];
  /** Notas (por el costado) */
  notes?: SequenceNote[];
}

export interface SequenceMessage {
  from: string;
  to: string;
  label: string;
  type?: "->" | "->>" | "-->" | "-->>" | "-x" | "--x" | "=>>" | "->>+" | "->>-" | "-->+" | "-->>-";
  /** Para alt/opt/loop/par */
  block?: { type: "alt" | "opt" | "loop" | "par" | "critical" | "break"; label: string };
}

export interface SequenceNote {
  position: "right of" | "left of" | "over";
  actor: string;
  text: string;
}

export interface ClassOptions {
  title?: string;
  classes: ClassDef[];
  relations: ClassRelation[];
}

export interface ClassDef {
  name: string;
  stereotype?: string;
  members: string[];
  methods: string[];
}

export interface ClassRelation {
  from: string;
  to: string;
  type: "inheritance" | "composition" | "aggregation" | "association" | "dependency" | "realization";
  label?: string;
  fromMultiplicity?: string;
  toMultiplicity?: string;
}

export interface EROptions {
  title?: string;
  entities: EREntity[];
  relations: ERRelation[];
}

export interface EREntity {
  name: string;
  attributes: ERAttribute[];
}

export interface ERAttribute {
  name: string;
  type: string;
  key?: boolean;
}

export interface ERRelation {
  from: string;
  to: string;
  type: "1:1" | "1:N" | "N:M";
  label?: string;
}

export type MermaidInput =
  | { type: "flowchart"; options: FlowchartOptions }
  | { type: "sequenceDiagram"; options: SequenceOptions }
  | { type: "classDiagram"; options: ClassOptions }
  | { type: "erDiagram"; options: EROptions }
  | { type: "gantt"; options: GanttOptions }
  | { type: "stateDiagram"; options: StateOptions }
  | { type: "pie"; options: PieOptions }
  | { type: "gitGraph"; options: GitGraphOptions };

// ─── Gantt ──────────────────────────────────────────────────────────────

export interface GanttOptions {
  title?: string;
  dateFormat?: string;
  axisFormat?: string;
  tasks: GanttTask[];
}

export interface GanttTask {
  id: string;
  label: string;
  start: string;
  end: string;
  dependsOn?: string;
}

// ─── State Diagram ──────────────────────────────────────────────────────

export interface StateOptions {
  title?: string;
  states: string[];
  transitions: StateTransition[];
  /** State con sub-estados */
  composites?: StateComposite[];
}

export interface StateTransition {
  from: string;
  to: string;
  label?: string;
}

export interface StateComposite {
  name: string;
  children: string[];
}

// ─── Pie ────────────────────────────────────────────────────────────────

export interface PieOptions {
  title?: string;
  slices: { label: string; value: number }[];
}

// ─── GitGraph ───────────────────────────────────────────────────────────

export interface GitGraphOptions {
  title?: string;
  commits: GitCommit[];
  branches?: GitBranch[];
}

export interface GitCommit {
  branch: string;
  label: string;
  type?: "commit" | "cherry-pick" | "tag";
}

export interface GitBranch {
  name: string;
  from?: string; // commit id or "main"
  order?: number;
}

// ─── Validation Helpers ────────────────────────────────────────────────


function cleanId(id: string): string {
  // Node IDs cannot have spaces. Replace with underscore.
  return id.replace(/\s+/g, "_").replace(/[^a-zA-Z0-9_]/g, "_");
}

function q(label: string): string {
  // Wrap in double quotes if it contains special chars
  if (/[^\w\sáéíóúñü-]/i.test(label) || /^[A-Z][a-z]/.test(label) && label.includes(" ")) {
    return `"${label.replace(/"/g, "#quot;")}"`;
  }
  if (/\s/.test(label) || /[^\w-]/.test(label)) {
    return `"${label.replace(/"/g, "#quot;")}"`;
  }
  return label;
}

function shapeWrap(nodeId: string, label: string, shape?: string): string {
  const id = cleanId(nodeId);
  switch (shape) {
    case "rounded":    return `${id}(${q(label)})`;
    case "circle":     return `${id}((${q(label)}))`;
    case "diamond":    return `${id}{${q(label)}}`;
    case "hexagon":    return `${id}{{${q(label)}}}`;
    case "parallelogram": return `${id}[/${q(label)}/]`;
    case "stadium":     return `${id}([${q(label)}])`;
    case "trapezoid":   return `${id}[/${q(label)}\\]`;
    case "box":
    default:           return `${id}[${q(label)}]`;
  }
}

const ARROW_MAP: Record<string, string> = {
  "->":    "-->",
  "->>":   "-->>",
  "-->":   "-->",
  "-->>":  "-->>",
  "-x":    "--x",
  "--x":   "--x",
  "=>>":   "=>>",
  "->>+":  "-->>+",
  "->>-":  "-->>-",
  "-->+":  "-->>+",
  "-->>-": "-->>-",
};

function arrow(a: string): string {
  return ARROW_MAP[a] ?? "-->>";
}

const ER_REL_MAP: Record<string, string> = {
  "1:1": "||--||",
  "1:N": "||--o{",
  "N:M": "}o--o{",
};

const CLASS_REL_MAP: Record<string, string> = {
  inheritance:  "<|--",
  composition:  "*--",
  aggregation:  "o--",
  association:  "-->",
  dependency:   "..>",
  realization:  "<|..",
};

// ─── Generators ─────────────────────────────────────────────────────────

function generateFlowchart(opts: FlowchartOptions): string[] {
  const lines: string[] = [];
  const dir = opts.direction ?? "TD";
  lines.push(`graph ${dir}`);

  // Subgraphs first
  if (opts.subgraphs) {
    for (const sg of opts.subgraphs) {
      lines.push(`  subgraph ${q(sg.label)}`);
      for (const nid of sg.nodes) {
        // Don't re-declare nodes in subgraph unless they have a shape
        const node = opts.nodes.find((n) => n.id === nid);
        if (node && node.shape) {
          lines.push(`    ${shapeWrap(nid, node.label, node.shape)}`);
        } else {
          // Just reference the node
          lines.push(`    ${cleanId(nid)}`);
        }
      }
      lines.push("  end");
    }
  }

  // Nodes (skip those already handled in subgraphs)
  const sgNodeIds = new Set(opts.subgraphs?.flatMap((sg) => sg.nodes) ?? []);
  for (const node of opts.nodes) {
    if (!sgNodeIds.has(node.id)) {
      lines.push(`  ${shapeWrap(node.id, node.label, node.shape)}`);
    }
  }

  // Edges
  for (const edge of opts.edges) {
    const arrowType = arrow(edge.type ?? "->>");
    const fromId = cleanId(edge.from);
    const toId = cleanId(edge.to);
    const label = edge.label ? `|${edge.label}|` : "";
    lines.push(`  ${fromId} ${arrowType}${label} ${toId}`);
  }

  return lines;
}

function generateSequence(opts: SequenceOptions): string[] {
  const lines: string[] = [];
  lines.push("sequenceDiagram");

  if (opts.title) lines.push(`  title ${q(opts.title)}`);

  for (const p of opts.participants) {
    lines.push(`  participant ${cleanId(p)} as ${q(p)}`);
  }

  if (opts.notes) {
    for (const note of opts.notes) {
      lines.push(`  Note ${note.position} ${cleanId(note.actor)}: ${note.text}`);
    }
  }

  for (const msg of opts.messages) {
    if (msg.block) {
      lines.push(`  ${msg.block.type} ${q(msg.block.label)}`);
    }
    const a = arrow(msg.type ?? "->>");
    lines.push(`  ${cleanId(msg.from)}${a}${cleanId(msg.to)}: ${q(msg.label)}`);
  }

  // Cerrar bloques abiertos
  const blockCount = opts.messages.filter((m) => m.block).length;
  for (let i = 0; i < blockCount; i++) {
    lines.push("  end");
  }

  return lines;
}

function generateClassDiagram(opts: ClassOptions): string[] {
  const lines: string[] = [];
  lines.push("classDiagram");

  if (opts.title) lines.push(`  title ${q(opts.title)}`);

  for (const cls of opts.classes) {
    const stereo = cls.stereotype ? ` <<${cls.stereotype}>>` : "";
    lines.push(`  class ${cleanId(cls.name)}${stereo}`);
    for (const m of cls.members) {
      lines.push(`  ${cleanId(cls.name)} : ${m}`);
    }
    for (const m of cls.methods) {
      lines.push(`  ${cleanId(cls.name)} : ${m}`);
    }
  }

  for (const rel of opts.relations) {
    const arrowType = CLASS_REL_MAP[rel.type] ?? "-->";
    const label = rel.label ? ` : ${rel.label}` : "";
    const fromCard = rel.fromMultiplicity ? ` "${rel.fromMultiplicity}"` : "";
    const toCard = rel.toMultiplicity ? ` "${rel.toMultiplicity}"` : "";
    lines.push(`  ${cleanId(rel.from)}${fromCard} ${arrowType}${toCard} ${cleanId(rel.to)}${label}`);
  }

  return lines;
}

function generateER(opts: EROptions): string[] {
  const lines: string[] = [];
  lines.push("erDiagram");

  for (const ent of opts.entities) {
    const attrs = ent.attributes.map((a) => {
      const pk = a.key ? " PK" : "";
      return `    ${a.type} ${a.name}${pk}`;
    });
    lines.push(`  ${cleanId(ent.name)} {`);
    lines.push(...attrs);
    lines.push("  }");
  }

  for (const rel of opts.relations) {
    const arrowType = ER_REL_MAP[rel.type] ?? "||--o{";
    const label = rel.label ? ` : ${rel.label}` : "";
    lines.push(`  ${cleanId(rel.from)} ${arrowType} ${cleanId(rel.to)}${label}`);
  }

  return lines;
}

function generateGantt(opts: GanttOptions): string[] {
  const lines: string[] = [];
  lines.push("gantt");
  lines.push("  dateFormat  " + (opts.dateFormat ?? "YYYY-MM-DD"));
  lines.push("  axisFormat  " + (opts.axisFormat ?? "%b %d"));
  if (opts.title) lines.push(`  title ${q(opts.title)}`);

  for (const task of opts.tasks) {
    const dep = task.dependsOn ? ` after ${cleanId(task.dependsOn)}` : "";
    lines.push(`  ${q(task.label)} : ${cleanId(task.id)}, ${task.start}, ${task.end}${dep}`);
  }

  return lines;
}

function generateState(opts: StateOptions): string[] {
  const lines: string[] = [];
  lines.push("stateDiagram-v2");

  if (opts.title) lines.push(`  title ${q(opts.title)}`);

  if (opts.composites) {
    for (const comp of opts.composites) {
      lines.push(`  state ${cleanId(comp.name)} {`);
      for (const child of comp.children) {
        lines.push(`    ${cleanId(child)}`);
      }
      lines.push("  }");
    }
  }

  for (const s of opts.states) {
    const isInComposite = opts.composites?.some((c) => c.children.includes(s));
    if (!isInComposite && !opts.composites?.some((c) => c.name === s)) {
      lines.push(`  ${cleanId(s)}`);
    }
  }

  for (const t of opts.transitions) {
    const label = t.label ? `: ${t.label}` : "";
    lines.push(`  ${cleanId(t.from)} --> ${cleanId(t.to)}${label}`);
  }

  return lines;
}

function generatePie(opts: PieOptions): string[] {
  const lines: string[] = [];
  lines.push("pie");
  if (opts.title) lines.push(`  title ${q(opts.title)}`);
  for (const slice of opts.slices) {
    lines.push(`  "${slice.label}" : ${slice.value}`);
  }
  return lines;
}

function generateGitGraph(opts: GitGraphOptions): string[] {
  const lines: string[] = [];
  lines.push("gitGraph");

  if (opts.branches) {
    for (const b of opts.branches) {
      lines.push(`  branch ${cleanId(b.name)}`);
    }
  }

  for (const c of opts.commits) {
    const prefix = c.type === "tag" ? "  tag" : c.type === "cherry-pick" ? "  cherry-pick" : "  commit";
    lines.push(`${prefix} id: ${q(c.label)}`);
    if (c.branch !== "main") {
      // checkout if needed
      lines.push(`  checkout ${cleanId(c.branch)}`);
      lines.push(`${prefix} id: ${q(c.label)}`);
    }
  }

  return lines;
}

// ─── Public API ─────────────────────────────────────────────────────────

const GENERATORS: Record<string, (opts: any) => string[]> = {
  flowchart: generateFlowchart,
  sequenceDiagram: generateSequence,
  classDiagram: generateClassDiagram,
  erDiagram: generateER,
  gantt: generateGantt,
  stateDiagram: generateState,
  stateDiagram_v2: generateState,
  pie: generatePie,
  gitGraph: generateGitGraph,
};

/**
 * Genera un diagrama Mermaid válido a partir de datos estructurados.
 *
 * @example
 * ```ts
 * const md = generateMermaid({
 *   type: "flowchart",
 *   options: {
 *     direction: "TD",
 *     nodes: [
 *       { id: "start", label: "Inicio", shape: "rounded" },
 *       { id: "end", label: "Fin", shape: "rounded" },
 *     ],
 *     edges: [
 *       { from: "start", to: "end", label: "Flujo" },
 *     ],
 *   },
 * });
 * ```
 */
export function generateMermaid(input: MermaidInput): string {
  const gen = GENERATORS[input.type];
  if (!gen) return `%% Unknown diagram type: ${input.type}`;
  const lines = gen((input as any).options);
  return "```mermaid\n" + lines.join("\n") + "\n```";
}

// ─── Validate & Fix ─────────────────────────────────────────────────────

/** Decode HTML entities sometimes persisted in stored markdown (breaks quoted subgraph titles). */
export function decodeMermaidHtmlEntities(text: string): string {
  return (text ?? "")
    .replace(/&quot;/g, '"')
    .replace(/&#34;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

/**
 * Apply a regex replacement only on segments outside double-quoted strings.
 * Prevents corrupting labels like `LLM["Servicio LLM (OpenRouter/TokenLab)"]`.
 */
function replaceOutsideDoubleQuotes(
  line: string,
  pattern: RegExp,
  replacer: (match: string, ...groups: string[]) => string,
): string {
  const parts = line.split(/("[^"]*")/g);
  return parts
    .map((part, index) => {
      if (index % 2 === 1) return part;
      return part.replace(pattern, replacer);
    })
    .join("");
}

/**
 * flowchart/graph: etiquetas de arista con comillas internas, paréntesis o llaves (`|dice "ok"|`,
 * `|valida (JWT)|`, `|GET /x/{id}|`) que Mermaid rechaza sin comillas. Solo se tocan esas: una etiqueta
 * con acentos o espacios que el parser ya acepta (`|Comunica vía|`) se preserva.
 * Example: `A -->|valida (JWT)| B` → `A -->|"valida (JWT)"| B`.
 */
export function quoteFlowchartEdgeLabels(content: string): string {
  if (!/^(flowchart|graph)\s/im.test((content ?? "").trim())) return content ?? "";
  const edgeArrow = "(<-->|<--->|--[-=>ox.]*>|==[-=>ox.]*>|-\\.->)";
  const edgeRe = new RegExp(
    `^(\\s*)([A-Za-z0-9_*][\\w*]*)\\s*${edgeArrow}\\s*\\|([^|\\n]+)\\|\\s*([A-Za-z0-9_*][\\w]*(?:\\[[^\\]]*\\]|\\([^\\)]*\\))?)`,
    "gm",
  );
  return content.replace(
    edgeRe,
    (match, indent: string, from: string, arrow: string, label: string, to: string) => {
      const trimmed = label.trim();
      if (!trimmed || /^"/.test(trimmed)) return match;
      if (/["(){}]/.test(trimmed) && /[^\x00-\x7F]|\s|\/|[{}:]/.test(trimmed)) {
        const cleaned = trimmed.replace(/"/g, "'").slice(0, MAX_MERMAID_LABEL_CHARS);
        return `${indent}${from} ${arrow}|"${cleaned}"| ${to}`;
      }
      return match;
    },
  );
}

/**
 * Strip fences/leaks and normalize diagram body for `mermaid.render` (no ``` wrappers).
 * Use in MarkdownMermaid / MddViewer before calling the renderer.
 */
export function prepareMermaidDiagramForRender(raw: string): string {
  const { diagram } = splitMermaidBodyAndTrailingProse(raw ?? "");
  let body = decodeMermaidHtmlEntities(stripMermaidFenceWrappers(diagram));
  if (/^erDiagram\b/im.test(body.trim())) {
    body = repairErDiagramBrdMarkdownLeaks(body);
  }
  body = stripMarkdownLeakFromMermaidDiagramBody(body);
  body = normalizeMermaidDiagramBody(body);
  return stripMermaidFenceWrappers(body).trim();
}

/**
 * Reparación determinista + preparación para render (bloque sin fences).
 * Usar en preview antes de `mermaid.render` / Excalidraw.
 */
export function resolveMermaidBlockForRender(raw: string): string {
  const stripped = stripMermaidFenceWrappers((raw ?? "").trim());
  if (!stripped) return "";
  const repaired = repairMermaidBlockBody(stripped);
  const candidate = repaired.trim() || stripped;
  return prepareMermaidDiagramForRender(candidate);
}

/**
 * Atributo de erDiagram cuyas claves (PK/FK/UK) van al final de la línea separadas solo por espacio:
 * grupos 1 (`tipo nombre `), 2 (las claves) y 3 (cola: espacios y comentario entre comillas, si lo hay).
 */
const ER_ATTRIBUTE_KEYS_WITHOUT_COMMA_RE =
  /^(\s*\S+\s+\S+\s+)((?:PK|FK|UK)(?:\s+(?:PK|FK|UK))+)(\s*(?:"[^"]*")?\s*)$/i;

/**
 * erDiagram: Mermaid acepta las claves de un atributo separadas por coma (`uuid user_id PK, FK`) y
 * rechaza dos claves separadas solo por espacio (`uuid id PK FK`). Normaliza comas tipográficas U+FF0C
 * a ASCII antes de evaluar. Solo se transforma la forma rechazada: dos o más claves PK|FK|UK
 * rechazada: dos o más claves PK|FK|UK consecutivas al final de una línea de atributo pasan a
 * `PK, FK` conservando el orden. Una línea con coma, o con una sola clave, no se toca, y el resto del
 * contenido tampoco; si no hay bloque `erDiagram`, se devuelve tal cual.
 */
export function repairErDiagramPkFkCommas(content: string): string {
  if (!content?.trim()) return content ?? "";
  if (!/^\s*erDiagram\b/im.test(content)) return content;
  return content
    .split("\n")
    .map((line) => {
      let lineNorm = line.replace(/\uFF0C/g, ",");
      lineNorm = lineNorm.replace(/\b(PK|FK|UK),(PK|FK|UK)\b/gi, "$1, $2");
      const match = lineNorm.match(ER_ATTRIBUTE_KEYS_WITHOUT_COMMA_RE);
      if (!match) return lineNorm;
      const [, head = "", keys = "", tail = ""] = match;
      return `${head}${keys.toUpperCase().split(/\s+/).join(", ")}${tail}`;
    })
    .join("\n");
}

/**
 * Fuente única de las cabeceras de diagrama de Mermaid 11 (`flowchart TD`, `sequenceDiagram`, …).
 * Las formas con sufijo (`-beta`, `-v2`) y los nombres propios del tipo van siempre; los nombres
 * genéricos (`block`, `packet`, `sankey`, `architecture`, `radar`, `treemap`) solo si ocupan la línea
 * entera para no confundir prosa ("block de código…") con una cabecera.
 */
const MERMAID_DIAGRAM_HEADER_LINE = new RegExp(
  "^(?:" +
    [
      "flowchart",
      "graph",
      "sequenceDiagram",
      "classDiagram",
      "stateDiagram(?:-v2)?",
      "erDiagram",
      "journey",
      "gantt",
      "pie",
      "quadrantChart",
      "requirementDiagram",
      "gitGraph",
      "C4Context",
      "C4Container",
      "C4Component",
      "C4Dynamic",
      "C4Deployment",
      "mindmap",
      "timeline",
      "zenuml",
      "kanban",
      "sankey-beta",
      "xychart-beta",
      "xychart",
      "block-beta",
      "blockDiagram",
      "packet-beta",
      "architecture-beta",
      "radar-beta",
      "treemap-beta",
    ].join("|") +
    ")\\b|^(?:sankey|block|packet|architecture|radar|treemap)\\s*$",
  "i",
);

/** True si la línea (sin fence) es la cabecera de un diagrama Mermaid 11 de cualquier tipo. */
export function isMermaidDiagramHeaderLine(line: string): boolean {
  return MERMAID_DIAGRAM_HEADER_LINE.test((line ?? "").trim());
}

/** Índice (en `lines`) de la línea de cierre del front-matter `---…---` inicial, o -1 si no hay. */
function mermaidFrontMatterEndIndex(lines: string[]): number {
  let i = 0;
  while (i < lines.length && !lines[i]!.trim()) i++;
  if (i >= lines.length || lines[i]!.trim() !== "---") return -1;
  for (let j = i + 1; j < lines.length; j++) {
    if (lines[j]!.trim() === "---") return j;
  }
  return -1;
}

/**
 * Separa el preámbulo de un diagrama (front-matter `---…---`, directivas `%%{init…}%%` y
 * comentarios `%%`) del resto. Es texto que Mermaid lee antes de la cabecera y que ninguna
 * reparación debe tocar.
 */
export function splitMermaidPreamble(text: string): { preamble: string; rest: string } {
  const lines = (text ?? "").split("\n");
  let idx = mermaidFrontMatterEndIndex(lines) + 1;
  while (idx < lines.length) {
    const t = lines[idx]!.trim();
    if (t && !t.startsWith("%%")) break;
    idx++;
  }
  if (idx >= lines.length) return { preamble: "", rest: (text ?? "").trim() };
  return {
    preamble: lines.slice(0, idx).join("\n").trim(),
    rest: lines.slice(idx).join("\n").trim(),
  };
}

/** True si la primera línea útil (tras front-matter y directivas) es una cabecera de diagrama. */
export function startsWithMermaidDiagramHeader(text: string): boolean {
  const first = splitMermaidPreamble(text).rest.split("\n", 1)[0] ?? "";
  return isMermaidDiagramHeaderLine(first);
}

/** Relación erDiagram con cardinalidades (`||--o{`, `}o--||`, `||..o{`…). */
const ER_RELATION_TOKEN_RE = /[|}][|o]\s*(?:--|\.\.)\s*[|o][|{]/;

/**
 * Si el cuerpo es un erDiagram sin cabecera (hay relaciones ER o bloques `Entidad {` con atributos),
 * antepone `erDiagram`. Si ya empieza por una cabecera de cualquier tipo, lo devuelve sin cambios:
 * `B{¿Válido?}` de un flowchart no es una entidad.
 */
export function ensureErDiagramHeader(content: string): string {
  const t = (content ?? "").trim();
  if (!t) return t;
  if (startsWithMermaidDiagramHeader(t)) return t;
  const { preamble, rest } = splitMermaidPreamble(t);
  if (ER_RELATION_TOKEN_RE.test(rest) || /^\s*\w[\w]*\s*\{\s*$/m.test(rest)) {
    return `${preamble ? `${preamble}\n` : ""}erDiagram\n\n${rest}`;
  }
  return t;
}

/**
 * Quita envoltorios ``` / ```mermaid (incl. anidados) del cuerpo antes de normalizar o renderizar.
 * Corrige bloques donde el LLM dejó el fence dentro del cuerpo del diagrama.
 */
export function stripMermaidFenceWrappers(raw: string): string {
  let t = (raw ?? "").trim();
  for (let i = 0; i < 5; i++) {
    const next = t
      .replace(/^```(?:mermaid)?[ \t]*\r?\n?/i, "")
      .replace(/\r?\n?```[ \t]*$/i, "")
      .trim();
    if (next === t) break;
    t = next;
  }
  return t
    .split("\n")
    .filter((line) => !/^```(?:mermaid)?[ \t]*$/i.test(line.trim()))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Repara cabeceras duplicadas o pegadas (`erDiagramerDiagram`, dos `erDiagram` consecutivos).
 */
export function dedupeMermaidDiagramHeader(raw: string): string {
  const lines = (raw ?? "").split("\n").map((line) =>
    line
      .replace(/^erDiagramerDiagram\b/i, "erDiagram")
      .replace(/^stateDiagram-v2stateDiagram-v2\b/i, "stateDiagram-v2")
      .replace(/^sequenceDiagramsequenceDiagram\b/i, "sequenceDiagram"),
  );
  let t = lines.join("\n").trim();
  if (!t) return t;
  t = t.replace(/^(erDiagram)\s*\n\s*\1\b/im, "$1");
  t = t.replace(/^(stateDiagram-v2)\s*\n\s*\1\b/im, "$1");
  t = t.replace(/^(stateDiagram)\s*\n\s*\1\b/im, "$1");
  t = t.replace(/^(sequenceDiagram)\s*\n\s*\1\b/im, "$1");
  return t.trim();
}

/**
 * El LLM vuelca `DEFAULT` de SQL como columna ficticia (`uuid default`, `uuid default FK`).
 * Mermaid erDiagram no admite el identificador `default` y el render falla → texto plano.
 */
export function stripErDiagramSqlDefaultArtifacts(content: string): string {
  if (!/^erDiagram\b/im.test((content ?? "").trim())) return content ?? "";
  return content
    .split("\n")
    .filter((line) => {
      const t = line.trim();
      if (!t) return true;
      if (t === "}" || /^\w[\w]*\s*\{$/.test(t)) return true;
      if (/^\w[\w]*\s+\|\|/.test(t) || /\|\|--/.test(t) || /:\s/.test(t)) return true;
      // Strip SQL artifacts: "uuid default PK", "SERIAL", "IDENTITY", bare "default" lines
      if (/^\w+\s+default(\s+(?:PK|FK|UK))*\s*$/i.test(t)) return false;
      if (/^\w+\s+(?:SERIAL|BIGSERIAL|IDENTITY|AUTO_INCREMENT)(\s+(?:PRIMARY\s+KEY|NOT\s+NULL|NULL|UNIQUE|DEFAULT))*\s*$/i.test(t)) return false;
      if (/^(?:PRIMARY\s+KEY|UNIQUE|CHECK|CONSTRAINT|INDEX|KEY)\b/i.test(t)) return false;
      if (/^CREATE\s+(?:TABLE|INDEX|UNIQUE\s+INDEX)\b/i.test(t)) return false;
      if (/^(?:ALTER|DROP|INSERT|SELECT|UPDATE|DELETE)\b/i.test(t)) return false;
      return true;
    })
    .join("\n");
}

/**
 * erDiagram BRD-style: el LLM emite atributos como viñetas `- string attr`, entidades como
 * `### ENTIDAD {` y relaciones como `### TENANT ||--o{ USUARIO`. Repara a sintaxis Mermaid plana.
 */
export function repairErDiagramBrdMarkdownLeaks(content: string): string {
  if (!/^erDiagram\b/im.test((content ?? "").trim())) return content ?? "";

  return content
    .split("\n")
    .map((line) => {
      const trimmed = line.trim();
      let s = line;

      // ### TENANT ||--o{ USUARIO : "posee"
      if (/^#{1,6}\s+/.test(trimmed) && MERMAID_ARROW_OR_ER_RE.test(trimmed)) {
        s = s.replace(/^(\s*)#{1,6}\s+/, "$1");
      }

      // ### ENTIDAD {
      const withoutHeading = trimmed.replace(/^#{1,6}\s+/, "");
      if (/^#{1,6}\s+/.test(trimmed) && /^[A-Za-z][\w\s]*\s*\{\s*$/.test(withoutHeading)) {
        s = s.replace(/^(\s*)#{1,6}\s+/, "$1");
      }

      // - string nombre / * datetime fecha (atributos dentro de bloques de entidad)
      if (MERMAID_LEAKED_LIST_PREFIX_RE.test(s)) {
        const core = sequenceLineCore(trimmed);
        if (
          /^[a-zA-Z_][\w]*\s+[a-zA-Z_][\w]*/.test(core) &&
          !MERMAID_ARROW_OR_ER_RE.test(core) &&
          !/(--+>|->>|--x)/.test(core)
        ) {
          s = s.replace(MERMAID_LEAKED_LIST_PREFIX_RE, "$1    ");
        }
      }

      return s;
    })
    .join("\n");
}

/** True when a line is valid erDiagram interior syntax (entity, attribute, or relationship). */
function isErDiagramInteriorSyntaxLine(trimmed: string): boolean {
  if (!trimmed) return false;
  const core = sequenceLineCore(trimmed);
  if (!core) return false;
  if (/^erDiagram\b/i.test(core)) return true;
  if (/^[A-Za-z][\w\s]*\s*\{\s*$/.test(core)) return true;
  if (/^\}\s*$/.test(core)) return true;
  if (
    /^[a-zA-Z_][\w]*\s+[a-zA-Z_][\w]*/.test(core) &&
    !MERMAID_ARROW_OR_ER_RE.test(core) &&
    !/(--+>|->>|--x)/.test(core)
  ) {
    return true;
  }
  if (MERMAID_ARROW_OR_ER_RE.test(core) && /[A-Za-z0-9_]/.test(core)) return true;
  return false;
}

/**
 * flowchart/graph: `C[NestJS API (Contenedor)]` → `C["NestJS API (Contenedor)"]`.
 * Preserva nodos cilíndricos `[("PostgreSQL · N tablas")]` — no convertir a `["("…")"]`.
 */
export function quoteFlowchartLabelsWithParens(content: string): string {
  if (!content?.trim()) return content ?? "";
  return content.replace(/\[([^\[\]"]*\([^()]*\)[^\[\]"]*)\]/g, (match, inner: string) => {
    const t = inner.trim();
    // Cylinder nodes: [(DB costos)] or [("PostgreSQL · N tablas")]
    if (/^\([^()]*\)$/.test(t)) return match;
    if (/^\(\s*"/.test(t) && /"\s*\)$/.test(t)) return match;
    // Cilindro con paréntesis anidados: `[(DB (principal))]` → se cita lo de dentro, conservando la forma.
    if (/^\(.*\)$/.test(t)) return `[("${t.slice(1, -1).trim()}")]`;
    // Trapezoides `[/ x (y) /]` y `[\ x (y) \]`: forma propia de Mermaid, no se convierten en rectángulo.
    if (/^[\/\\]/.test(t) && /[\/\\]$/.test(t)) return match;
    return `["${inner}"]`;
  });
}

/** flowchart/graph: el LLM deja `]text` al pegar fences (` ```text `) en nodos o al fusionar líneas. */
export function stripFlowchartTrailingTextGarbage(content: string): string {
  if (!/^(flowchart|graph)\s/im.test((content ?? "").trim())) return content ?? "";
  return content
    .split("\n")
    .flatMap((line) => {
      let s = line.replace(/\]text(?=\s*Gateway\b)/gi, "]\n");
      s = s.replace(/\]text\s*$/gi, "]");
      if (s.includes("\n")) {
        const [head, ...rest] = s.split("\n");
        return [head!, ...rest.filter((part) => part.trim())];
      }
      return [s];
    })
    .join("\n");
}

/** Operadores de arista de flowchart: si aparecen dentro de un corchete, es un nodo mal cerrado y no una etiqueta. */
const FLOWCHART_EDGE_OPERATOR_RE = /-->|---|-\.->|==>|<--|\s--[xo](?:\s|$)/;

/**
 * flowchart/graph: rectángulo `id[…]` cuyo contenido trae un `[` sin cerrar (`A[Inicio --> B[Fin]`) o
 * llaves (`API[GET /x/{id}]`), caracteres que Mermaid no admite sin comillas. Se cita el contenido.
 * Un rectángulo válido con espacios o acentos (`A[Módulo Tenants]`) se preserva tal cual.
 * No se cita si el contenido trae una flecha de arista (`-->`, `---`, `-.->`, `==>`, `--x`, `--o`, `<--`)
 * o si un `[` interior va seguido, en la misma línea, de más texto tras el `]` (`A[Texto [x] B`): citarlo
 * fusionaría varios nodos y aristas en una sola etiqueta.
 * Las formas `[[ ]]`, `[( )]`, `[/ /]` y `[\ \]` se dejan intactas (el contenido empieza por `[`, `(`, `/` o `\`).
 */
export function quoteFlowchartSpacedLabels(content: string): string {
  if (!/^(flowchart|graph)\s/im.test((content ?? "").trim())) return content ?? "";
  return content.replace(
    /(\b[A-Za-z0-9_*][\w]*)\[([^\]"]+)\]/g,
    (match, id: string, label: string, offset: number, whole: string) => {
      if (/^[\[(\/\\]/.test(label)) return match;
      if (!/[\[{}]/.test(label)) return match;
      if (FLOWCHART_EDGE_OPERATOR_RE.test(label)) return match;
      if (label.includes("[") && /^[ \t]+\S/.test(whole.slice(offset + match.length))) return match;
      if (!/\s/.test(label) && !/[^\x00-\x7F]/.test(label)) return match;
      const cleaned = label.replace(/"/g, "'").trim();
      return `${id}["${cleaned}"]`;
    },
  );
}

const ER_DIAGRAM_ATTR_TYPES =
  "uuid|string|int|bool|boolean|datetime|date|text|json|float|double";

/**
 * erDiagram: atributos con tipo duplicado (`string original_request string`) rompen el parser.
 */
export function repairErDiagramDuplicateAttributeTypes(content: string): string {
  if (!/^erDiagram\b/im.test((content ?? "").trim())) return content ?? "";
  const dupRe = new RegExp(
    `^(\\s*)(${ER_DIAGRAM_ATTR_TYPES})\\s+(\\w[\\w]*)\\s+(${ER_DIAGRAM_ATTR_TYPES})\\s*$`,
    "i",
  );
  return content
    .split("\n")
    .map((line) => {
      const m = line.match(dupRe);
      if (!m) return line;
      const indent = m[1] ?? "";
      const type1 = m[2];
      const name = m[3];
      const type2 = m[4];
      if (!type1 || !name || !type2) return line;
      if (type2.toLowerCase() === "string" && /request|description|script|message|payload/i.test(name)) {
        return `${indent}text ${name}`;
      }
      if (type1.toLowerCase() === type2.toLowerCase()) {
        return `${indent}${type1} ${name}`;
      }
      return `${indent}${type1} ${name}_${type2}`;
    })
    .join("\n");
}

/** erDiagram: cierra entidad y abre la siguiente en la misma línea (`} llm_configs {`). */
export function splitErDiagramEntityBlocksOnSameLine(content: string): string {
  if (!/^erDiagram\b/im.test((content ?? "").trim())) return content ?? "";
  return content.replace(/\}\s+(\w[\w]*)\s*\{/g, "}\n  $1 {");
}

const FLOWCHART_EDGE_ARROW_RE = /(?:--+(?:>|x|o)|==+>|-\.-+>|---)(?:\|[^|\n]+\|)?/;

function slugFromFlowchartLabel(label: string): string {
  const slug = label
    .replace(/[^A-Za-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 24);
  if (!slug) return "node";
  return /^[0-9]/.test(slug) ? `n_${slug}` : slug;
}

/** Fin de una flecha, de un `&` o de una etiqueta `|x|`: lo que sigue sigue siendo parte de la misma arista. */
const FLOWCHART_EDGE_CONTINUATION_TAIL_RE = /(?:--+(?:>|x|o)?|==+>?|-\.+-*>?|&|\|[^|\n]*\|)$/;

/**
 * flowchart/graph: el LLM a veces concatena varias aristas en una línea separadas solo por espacios
 * (`A --> B    C --> D`), lo que Mermaid 11 rechaza. Partimos antes del nodo origen de la siguiente,
 * SOLO si el espacio viene justo después de un nodo completo. Las cadenas (`A --> B --> C`) y los
 * grupos (`S5 & SEC --> M`) son válidos y no se tocan.
 */
export function splitFlowchartMultiEdgeLines(content: string): string {
  if (!/^(flowchart|graph)\s/im.test((content ?? "").trim())) return content ?? "";
  const splitRe =
    /\s+(?=[A-Za-z0-9_*][\w]*\s*(?:--+(?:>|x|o)|==+>|-\.-+>|---)(?:\|[^|\n]+\|)?)/g;

  return content
    .split("\n")
    .flatMap((line) => {
      const trimmed = line.trim();
      if (
        !trimmed ||
        /^(flowchart|graph)\s/i.test(trimmed) ||
        /^(subgraph|end|direction|style|classDef|class|linkStyle|click)\b/i.test(trimmed)
      ) {
        return [line];
      }
      const arrows = trimmed.match(new RegExp(FLOWCHART_EDGE_ARROW_RE.source, "g")) ?? [];
      if (arrows.length <= 1) return [line];
      const indent = line.match(/^(\s*)/)?.[1] ?? "";
      const parts: string[] = [];
      let last = 0;
      for (const m of trimmed.matchAll(splitRe)) {
        const at = m.index ?? 0;
        const before = trimmed.slice(last, at);
        // Sigue la misma arista: no es un corte (cadena `A --> B --> C`, grupo `A & B --> C`).
        if (!before.trim() || FLOWCHART_EDGE_CONTINUATION_TAIL_RE.test(trimmed.slice(0, at))) continue;
        parts.push(before);
        last = at + m[0].length;
      }
      parts.push(trimmed.slice(last));
      if (parts.length <= 1) return [line];
      return parts.map((part) => `${indent}${part.trim()}`);
    })
    .join("\n");
}

/**
 * flowchart/graph: repara destinos sin id (`G4 -->[(PostgreSQL 16)]` → `G4 --> PostgreSQL_16[(PostgreSQL 16)]`).
 */
export function repairFlowchartMissingTargetNodeIds(content: string): string {
  if (!/^(flowchart|graph)\s/im.test((content ?? "").trim())) return content ?? "";
  const edgeArrow = "(?:--+(?:>|x|o)|==+>|-\\.-+>|---)(?:\\|[^|\\n]+\\|)?";
  return content.replace(
    new RegExp(`(${edgeArrow})\\s*(\\[\\(([^)]*)\\)\\])`, "g"),
    (_match, arrow: string, _full: string, label: string) => {
      const id = slugFromFlowchartLabel(label);
      return `${arrow} ${id}[(${label})]`;
    },
  );
}

/**
 * Valida un diagrama Mermaid existente y devuelve errores encontrados.
 * No modifica el input — solo reporta qué arreglar.
 */
export function validateMermaid(raw: string): string[] {
  const errors: string[] = [];
  if (!raw) return ["Empty mermaid content"];

  // El front-matter y las directivas `%%{init}%%` preceden a la cabecera: no son el "primer tipo".
  const lines = splitMermaidPreamble(raw).rest.split("\n").filter((l) => l.trim());
  if (lines.length === 0) return ["Empty mermaid content"];

  const firstLine = lines[0]!.trim();

  // Detectar tipo
  const typeMatch = firstLine.match(MERMAID_DIAGRAM_HEADER_LINE);
  if (!typeMatch) {
    errors.push(`Unknown diagram type. First line: "${firstLine}". Must start with a valid mermaid type.`);
  }

  const mermaidType = typeMatch?.[0]?.trim();

  // Validaciones específicas por tipo
  if (mermaidType === "sequenceDiagram") {
    // Check for unclosed alt/opt/loop/par blocks
    const opens = lines.filter((l) => isSequenceCompositeBlockOpenLine(l.trim())).length;
    const closes = lines.filter((l) => /^\s*end\s*$/.test(l)).length;
    if (opens > closes) {
      errors.push(`Unclosed block: ${opens} openers but only ${closes} closers (need +${opens - closes} "end")`);
    }
    if (closes > opens) {
      errors.push(`Too many "end": ${closes} closers but only ${opens} openers`);
    }
  }

  if (mermaidType === "flowchart" || mermaidType?.startsWith("graph")) {
    // Check for subgraphs without end
    const subs = lines.filter((l) => /^\s*subgraph\s/.test(l)).length;
    const ends = lines.filter((l) => /^\s*end\s*$/.test(l)).length;
    if (subs > ends) {
      errors.push(`Unclosed subgraph: ${subs} subgraphs but ${ends} ends`);
    }
  }

  if (mermaidType === "classDiagram") {
    // Check for unclosed { } blocks in class/annotation
    let classDepth = 0;
    for (const l of lines) {
      if (/\b(class|annotation)\s+\w+\s*\{/.test(l)) classDepth++;
      if (/^\s*\}\s*$/.test(l)) classDepth = Math.max(0, classDepth - 1);
    }
    if (classDepth > 0) {
      errors.push(`Unclosed class/annotation block: ${classDepth} openers without matching "}"`);
    }
    // Check for lowercase keywords — Mermaid classDiagram uses lowercase `class`, `relationship`, etc.
    const lowerKw = lines.filter((l) => /^\s*(Class|Annotation|Namespace)\s/.test(l));
    if (lowerKw.length > 0) {
      errors.push(`Uppercase classDiagram keywords detected (${lowerKw.length} lines) — Mermaid requires lowercase keywords`);
    }
  }

  if (mermaidType === "stateDiagram" || mermaidType === "stateDiagram-v2") {
    // Check for direction keyword
    const hasDirection = lines.some((l) => /^\s*direction\s+(LR|TD|BT|RL)\s*$/i.test(l));
    if (!hasDirection) {
      // Not required but common — don't error, just note
    }
    // Check for invalid state transitions (missing -->)
  }

  // ID sin espacios (nodos flowchart; no aplicar a headers `subgraph ID["…"]`)
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i]!;
    if (mermaidType === "flowchart" || mermaidType?.startsWith("graph")) {
      if (/^\s*subgraph\s/i.test(l)) continue;
      const nodeIdMatch = l.match(/^\s*([A-Za-z]\w*\s+\w+)\[/);
      if (nodeIdMatch) {
        errors.push(`Line ${i + 1}: Node ID "${nodeIdMatch[1]}" contains spaces`);
      }
    }
  }

  return errors;
}

/** Prefijos markdown que el LLM suele anteponer a líneas Mermaid fugadas (incl. viñeta unicode •). */
const MERMAID_LEAKED_LIST_PREFIX_RE =
  /^(\s*)(?:#{1,6}\s+|[-*•\u2022\u2023\u25E6\u2043\u2219]\s+|\d+[.)]\s+)/;

/** Flechas flowchart/sequence o cardinalidad erDiagram en una línea. */
const MERMAID_ARROW_OR_ER_RE =
  /(-+>>|->>|--x|-x>|--+>|==+>|-\.-+>|---|\}\|\-{1,2}|\|\|\-{1,2}|\|\|\-\-o\{|\}o\-\-|\-\-o\{|\}o\-\-o\{|o\-\-o\{)/;

/** Tope de longitud de etiqueta Mermaid: alto a propósito (solo corta prosa desbocada). */
const MAX_MERMAID_LABEL_CHARS = 120;

/** Línea markdown fuera del fence que en realidad es sintaxis sequenceDiagram. */
function sequenceLineCore(trimmed: string): string {
  return trimmed
    .replace(/^(\s*)#{1,6}\s+/, "$1")
    .replace(/^(\s*)[-*•\u2022\u2023\u25E6\u2043\u2219]\s+/, "$1")
    .replace(/^(\s*)\d+[.)]\s+/, "$1")
    .trim();
}

export function isOrphanSequenceDiagramLine(trimmed: string): boolean {
  if (!trimmed) return false;
  if (/^```/.test(trimmed)) return false;
  if (/^#{1,2}\s+\d+\.\s/.test(trimmed)) return false;
  if (/^#{1,6}\s+\d+\.\d+\s/.test(trimmed)) return false;
  if (/^\|/.test(trimmed)) return false;
  if (/^---+\s*$/.test(trimmed)) return false;

  const core = sequenceLineCore(trimmed);
  if (!core) return false;
  if (/^sequenceDiagram\b/i.test(core)) return false;

  if (/^(participant|actor)\s/i.test(core)) return true;
  if (/^Note over\b/i.test(core)) return true;
  if (/^(alt|opt|loop|par|critical|break|rect|else|and|end)\b/i.test(core)) return true;
  if (/(-+>>|->>|--x|-x>)/.test(core)) return true;
  return false;
}

function normalizeOrphanSequenceDiagramLine(line: string): string {
  let s = line.replace(/^(\s*)#{1,6}\s+/, "$1");
  const trimmed = s.trim();
  if (
    MERMAID_LEAKED_LIST_PREFIX_RE.test(s) &&
    (MERMAID_ARROW_OR_ER_RE.test(s) ||
      isOrphanSequenceDiagramLine(trimmed) ||
      isOrphanFlowchartLine(trimmed) ||
      isOrphanErDiagramLine(trimmed) ||
      isOrphanStateDiagramLine(trimmed))
  ) {
    s = s.replace(MERMAID_LEAKED_LIST_PREFIX_RE, "$1    ");
  }
  return s;
}

/**
 * Línea markdown fuera del fence que en realidad es sintaxis flowchart/graph
 * (aristas `A --> B`, `A -->|label| B`, `subgraph`, `end`). Permite re-absorber aristas
 * que el LLM dejó tras cerrar el fence prematuramente (`### A -->|x| B`, `- A --> B`).
 */
export function isOrphanFlowchartLine(trimmed: string): boolean {
  if (!trimmed) return false;
  if (/^```/.test(trimmed)) return false;
  if (/^#{1,2}\s+\d+[.)]/.test(trimmed)) return false;
  if (/^#{1,6}\s+\d+\.\d+\s/.test(trimmed)) return false;
  if (/^\|/.test(trimmed)) return false;
  if (/^---+\s*$/.test(trimmed)) return false;

  const core = sequenceLineCore(trimmed);
  if (!core) return false;
  if (/^(flowchart|graph)\b/i.test(core)) return false;
  if (/^(subgraph|end|direction)\b/i.test(core)) return true;
  // Edge: a node token followed by a flowchart arrow (-->, ---, ==>, -.->), optionally with |label|.
  if (/^[A-Za-z0-9_]/.test(core) && /(--+>|==+>|-\.-+>|---)/.test(core)) return true;
  return false;
}

/**
 * Línea markdown fuera del fence que en realidad es sintaxis erDiagram
 * (bloque de entidad `ENTIDAD {` o relación `A }o--o{ B : "label"`).
 */
export function isOrphanErDiagramLine(trimmed: string): boolean {
  if (!trimmed) return false;
  if (/^```/.test(trimmed)) return false;
  if (/^#{1,2}\s+\d+[.)]/.test(trimmed)) return false;
  if (/^#{1,6}\s+\d+\.\d+\s/.test(trimmed)) return false;
  if (/^\|/.test(trimmed)) return false;
  if (/^---+\s*$/.test(trimmed)) return false;

  const core = sequenceLineCore(trimmed);
  if (!core) return false;
  if (/^erDiagram\b/i.test(core)) return false;
  if (/^[A-Za-z][\w\s]*\s*\{/.test(core)) return true;
  if (MERMAID_ARROW_OR_ER_RE.test(core) && /[A-Za-z0-9_]/.test(core)) return true;
  return false;
}

/**
 * Línea markdown fuera del fence que en realidad es sintaxis stateDiagram(-v2)
 * (`[*] --> Idle`, `Idle --> Calculando: evento`, transiciones con viñeta `-`).
 */
export function isOrphanStateDiagramLine(trimmed: string): boolean {
  if (!trimmed) return false;
  if (/^```/.test(trimmed)) return false;
  if (/^#{1,2}\s+\d+[.)]/.test(trimmed)) return false;
  if (/^#{1,6}\s+\d+\.\d+\s/.test(trimmed)) return false;
  if (/^\|/.test(trimmed)) return false;
  if (/^---+\s*$/.test(trimmed)) return false;
  // Encabezados markdown (#### Flujo N:) no son transiciones de estado.
  if (/^#{1,6}\s+/.test(trimmed) && !/(-->|--+)/.test(trimmed)) return false;

  const core = sequenceLineCore(trimmed);
  if (!core) return false;
  if (/^stateDiagram(?:-v2)?\b/i.test(core)) return false;
  if (/^\[\*\]/.test(core)) return true;
  if (/([\w[\]*]+)\s*-->/.test(core)) return true;
  if (/^(note|direction|state)\b/i.test(core)) return true;
  return false;
}

type UnfencedDiagramKind = "flowchart" | "erDiagram" | "sequenceDiagram" | "stateDiagram";

function parseUnfencedDiagramHeader(trimmed: string): UnfencedDiagramKind | null {
  const core = sequenceLineCore(trimmed);
  if (/^erDiagram\b/i.test(core)) return "erDiagram";
  if (/^sequenceDiagram\b/i.test(core)) return "sequenceDiagram";
  if (/^stateDiagram-v2\b/i.test(core)) return "stateDiagram";
  if (/^stateDiagram\b/i.test(core)) return "stateDiagram";
  if (/^(flowchart|graph)\b/i.test(core)) return "flowchart";
  return null;
}

function isUnfencedMermaidBlockTerminator(trimmed: string): boolean {
  if (!trimmed) return false;
  if (/^#{1,6}\s+/.test(trimmed)) {
    if (
      isOrphanSequenceDiagramLine(trimmed) ||
      isOrphanFlowchartLine(trimmed) ||
      isOrphanErDiagramLine(trimmed) ||
      isOrphanStateDiagramLine(trimmed)
    ) {
      return false;
    }
    return true;
  }
  if (/^\|/.test(trimmed)) return true;
  if (/^---+\s*$/.test(trimmed)) return true;
  return false;
}

function isUnfencedMermaidBodyLine(trimmed: string, kind: UnfencedDiagramKind): boolean {
  if (!trimmed) return false;
  if (
    isOrphanFlowchartLine(trimmed) ||
    isOrphanSequenceDiagramLine(trimmed) ||
    isOrphanErDiagramLine(trimmed) ||
    isOrphanStateDiagramLine(trimmed)
  ) {
    return true;
  }
  const core = sequenceLineCore(trimmed);
  if (!core) return false;

  if (kind === "flowchart") {
    if (/^[A-Za-z0-9_][\w]*(\[|\(|\{)/.test(core)) return true;
    if (/^[A-Za-z0-9_]/.test(core) && /[\]\)"']?\s*(--+>|==+>|-\.-+>)/.test(core)) return true;
  }
  if (kind === "erDiagram") {
    if (/^\}\s*$/.test(core)) return true;
    if (/^[a-zA-Z_][\w]*\s+[a-zA-Z_][\w]*/.test(core) && !/(--+>|->>|--x)/.test(core)) return true;
  }
  if (kind === "sequenceDiagram") {
    if (/^\s{2,}\S/.test(trimmed) && /(-+>>|->>|--x|-x>)/.test(trimmed)) return true;
    if (/^(alt|opt|loop|par|critical|break|else|and|end|rect)\b/i.test(core)) return true;
  }
  if (kind === "stateDiagram") {
    if (/^[\w[\]*\s-]+\s*-->/.test(core)) return true;
  }
  return false;
}

function collectUnfencedMermaidBlock(
  lines: string[],
  startIdx: number,
  kind: UnfencedDiagramKind,
): { endIdx: number; rawLines: string[] } {
  const rawLines = [lines[startIdx]!];
  let i = startIdx + 1;
  while (i < lines.length) {
    const trimmed = lines[i]!.trim();
    if (/^```/.test(trimmed)) break;
    if (i > startIdx && parseUnfencedDiagramHeader(trimmed)) break;
    if (isUnfencedMermaidBlockTerminator(trimmed)) break;
    if (!trimmed) {
      let k = i + 1;
      while (k < lines.length && !lines[k]!.trim()) k++;
      const next = k < lines.length ? lines[k]!.trim() : "";
      if (!next || isUnfencedMermaidBlockTerminator(next) || parseUnfencedDiagramHeader(next)) break;
    }
    if (!trimmed || isUnfencedMermaidBodyLine(trimmed, kind)) {
      rawLines.push(lines[i]!);
      i++;
      continue;
    }
    break;
  }
  return { endIdx: i, rawLines };
}

function normalizeUnfencedMermaidLine(line: string): string {
  const trimmed = line.trim();
  if (
    MERMAID_LEAKED_LIST_PREFIX_RE.test(line) &&
    (MERMAID_ARROW_OR_ER_RE.test(line) ||
      isOrphanSequenceDiagramLine(trimmed) ||
      isOrphanFlowchartLine(trimmed) ||
      isOrphanErDiagramLine(trimmed) ||
      isOrphanStateDiagramLine(trimmed))
  ) {
    return line.replace(MERMAID_LEAKED_LIST_PREFIX_RE, "$1    ");
  }
  return normalizeOrphanSequenceDiagramLine(line);
}

/**
 * Envuelve diagramas Mermaid volcados como markdown plano (sin fence ```mermaid).
 * Patrón recurrente del LLM: `flowchart LR` / `erDiagram` / `stateDiagram-v2` como texto,
 * aristas como listas `- A --> B`, relaciones ER como viñetas fuera de cualquier fence.
 */
export function repairUnfencedMermaidInDocument(document: string): string {
  if (!document?.trim()) return document ?? "";

  const lines = document.split("\n");
  const out: string[] = [];
  let i = 0;
  let inFence = false;

  while (i < lines.length) {
    const line = lines[i]!;
    const trimmed = line.trim();

    if (/^```/.test(trimmed)) {
      inFence = !inFence;
      out.push(line);
      i++;
      continue;
    }

    const kind = !inFence ? parseUnfencedDiagramHeader(trimmed) : null;
    if (kind) {
      const { endIdx, rawLines } = collectUnfencedMermaidBlock(lines, i, kind);
      const body = rawLines.map(normalizeUnfencedMermaidLine).join("\n").trim();
      const normalized = normalizeMermaidDiagramBody(body);
      if (normalized) {
        if (out.length > 0 && out[out.length - 1]!.trim() !== "") out.push("");
        out.push("```mermaid");
        out.push(normalized);
        out.push("```");
        if (endIdx < lines.length && lines[endIdx]?.trim()) out.push("");
      } else {
        out.push(...rawLines);
      }
      i = endIdx;
      continue;
    }

    out.push(line);
    i++;
  }

  return out.join("\n");
}

/**
 * Fusiona líneas sequenceDiagram rotas fuera del fence (### Foo->>Bar, viñetas con flechas)
 * en el bloque ```mermaid precedente.
 */
export function repairFragmentedSequenceMermaidInDocument(document: string): string {
  if (!document?.trim()) return document ?? "";

  const lines = document.split("\n");
  const out: string[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i]!;
    if (!/^```mermaid\s*$/i.test(line.trim())) {
      out.push(line);
      i++;
      continue;
    }

    out.push(line);
    i++;
    const bodyLines: string[] = [];
    while (i < lines.length && !/^```\s*$/.test(lines[i]!.trim())) {
      bodyLines.push(lines[i]!);
      i++;
    }

    if (i >= lines.length) {
      out.push(...bodyLines);
      break;
    }

    const bodyText = bodyLines.join("\n");
    const isSequence = /sequenceDiagram/i.test(bodyText);
    const isFlowchart = /^\s*(flowchart|graph)\b/im.test(bodyText);
    const isErDiagram = /^erDiagram\b/im.test(bodyText.trim());
    const isStateDiagram = /^stateDiagram(?:-v2)?\b/im.test(bodyText.trim());
    const orphanPred = isSequence
      ? isOrphanSequenceDiagramLine
      : isFlowchart
        ? isOrphanFlowchartLine
        : isErDiagram
          ? isOrphanErDiagramLine
          : isStateDiagram
            ? isOrphanStateDiagramLine
            : null;

    if (orphanPred) {
      i++;
      while (i < lines.length) {
        const trimmed = lines[i]!.trim();
        if (!trimmed) {
          let j = i + 1;
          while (j < lines.length && !lines[j]!.trim()) j++;
          if (j < lines.length && orphanPred(lines[j]!.trim())) {
            i++;
            continue;
          }
          break;
        }
        if (!orphanPred(trimmed)) break;
        bodyLines.push(normalizeOrphanSequenceDiagramLine(lines[i]!));
        i++;
      }
    } else {
      i++;
    }

    out.push(...bodyLines);
    out.push("```");
  }

  return out.join("\n");
}

/** Una línea (sin prefijo de lista/encabezado) parece sintaxis de continuación Mermaid. */
function isMermaidStatementCore(core: string): boolean {
  if (!core) return false;
  if (/^CREATE\s+(?:TABLE|INDEX|UNIQUE\s+INDEX)\b/i.test(core)) return false;
  if (/^(?:ALTER|DROP|INSERT|SELECT|UPDATE|DELETE|CONSTRAINT|REFERENCES)\b/i.test(core)) return false;
  if (/(-+>>|->>|--x|-x>)/.test(core)) return true;
  if (/(--+>|==+>|-\.-+>|---)/.test(core) && /^[A-Za-z0-9_]/.test(core)) return true;
  if (MERMAID_ARROW_OR_ER_RE.test(core) && /^[A-Za-z0-9_]/.test(core)) return true;
  if (/^[A-Za-z][\w\s]*\s*\{/.test(core)) return true;
  if (/^[\w[\]\s-]+\s*-->/.test(core)) return true;
  if (/^[\w[\]\s-]+\s*:\s*\S/.test(core) && /-->/.test(core)) return true;
  if (
    /^(participant|actor|Note\b|alt\b|opt\b|loop\b|par\b|critical\b|break\b|else\b|and\b|end\b|subgraph\b|direction\b|rect\b)/i.test(
      core,
    )
  ) {
    return true;
  }
  return false;
}

/**
 * Separa el cuerpo de un SEGUNDO fence en (continuación del diagrama anterior) + (resto que es
 * prosa de la sección siguiente). Causa: el LLM cierra el fence tras los `participant` y vuelca el
 * resto en otro bloque con lenguaje arbitrario (```dockerfile), un bloque que frecuentemente además
 * envuelve prosa que NO pertenece al diagrama. Tomamos solo el prefijo de líneas que son sintaxis
 * Mermaid y devolvemos el remanente para re-emitirlo como markdown.
 *
 * Devuelve null si el segundo fence no es continuación (arranca su propia declaración de diagrama,
 * o su primera línea con contenido no es sintaxis Mermaid): en ese caso son dos diagramas distintos.
 */
function splitMermaidContinuationPrefix(
  body: string,
): { continuation: string[]; remainder: string[] } | null {
  const lines = body.split("\n");

  let f = 0;
  while (f < lines.length && !lines[f]!.trim()) f++;
  if (f >= lines.length) return null;
  const first = lines[f]!.trim();
  if (
    /^(flowchart|graph|sequenceDiagram|erDiagram|classDiagram|stateDiagram(?:-v2)?|gantt|pie|gitGraph|mindmap|timeline|journey|quadrantChart|xychart)\b/i.test(
      first,
    )
  ) {
    return null;
  }
  if (/^CREATE\s+(?:TABLE|INDEX|UNIQUE\s+INDEX)\b/i.test(first)) return null;
  if (/^--\s/.test(first)) return null;

  const continuation: string[] = [];
  let hits = 0;
  let stop = -1;
  for (let idx = 0; idx < lines.length; idx++) {
    const t = lines[idx]!.trim();
    if (!t) {
      let j = idx + 1;
      while (j < lines.length && !lines[j]!.trim()) j++;
      if (j < lines.length && isMermaidStatementCore(sequenceLineCore(lines[j]!.trim()))) {
        continuation.push(lines[idx]!);
        continue;
      }
      stop = idx;
      break;
    }
    if (isMermaidStatementCore(sequenceLineCore(t))) {
      continuation.push(lines[idx]!);
      hits++;
      continue;
    }
    stop = idx;
    break;
  }

  if (hits < 1) return null;
  const remainder = stop >= 0 ? lines.slice(stop) : [];
  return { continuation, remainder };
}

/** Quita prefijo de lista/encabezado fugado (`- `, `* `, `• `, `### `) de una línea de continuación. */
function stripLeakedMermaidLinePrefix(line: string): string {
  return line.replace(MERMAID_LEAKED_LIST_PREFIX_RE, "$1    ").replace(/[ \t]+$/, "");
}

/**
 * Repara cierre erróneo ` ```mermaid ` en lugar de ` ``` ` (segundo bloque pegado al primero).
 * Típico en sequenceDiagram largos partidos por el LLM.
 */
export function repairMermaidFenceClosedWithMermaidTag(document: string): string {
  if (!document?.trim()) return document ?? "";

  const re = /```mermaid[ \t]*\n([\s\S]*?)```mermaid[ \t]*\n([\s\S]*?)```/gi;
  let prev: string | null = null;
  let cur = document;
  let guard = 0;
  while (prev !== cur && guard < 30) {
    prev = cur;
    cur = cur.replace(re, (match, b1: string, b2: string) => {
      // Dos bloques mermaid legítimos separados por otro fence (p. ej. ```dockerfile): no fusionar.
      if (/\n```[ \t]*(?:\n|$)/.test(b1)) return match;
      const t1 = b1.trim();
      const t2 = b2.trim();
      const sameSequence =
        /^sequenceDiagram\b/im.test(t1) && /^sequenceDiagram\b/im.test(t2);
      if (sameSequence) {
        const cont = t2.replace(/^sequenceDiagram\s*\n?/i, "").trim();
        const merged = `${t1}\n${cont}`.replace(/\n{3,}/g, "\n\n").trim();
        return `\`\`\`mermaid\n${merged}\n\`\`\``;
      }
      const sameFlowchart =
        /^(flowchart|graph)\b/im.test(t1) && /^(flowchart|graph)\b/im.test(t2);
      if (sameFlowchart) {
        const cont = t2.replace(/^(flowchart|graph)\s+(?:TD|LR|BT|RL|TB)\s*\n?/i, "").trim();
        const merged = `${t1}\n${cont}`.replace(/\n{3,}/g, "\n\n").trim();
        return `\`\`\`mermaid\n${merged}\n\`\`\``;
      }
      const sameErDiagram = /^erDiagram\b/im.test(t1) && /^erDiagram\b/im.test(t2);
      if (sameErDiagram) {
        const cont = t2.replace(/^erDiagram\s*\n?/i, "").trim();
        const merged = `${t1}\n${cont}`.replace(/\n{3,}/g, "\n\n").trim();
        return `\`\`\`mermaid\n${merged}\n\`\`\``;
      }
      const sameState =
        /^stateDiagram-v2\b/im.test(t1) && /^stateDiagram-v2\b/im.test(t2);
      if (sameState) {
        const cont = t2.replace(/^stateDiagram-v2\s*\n?/i, "").trim();
        const merged = `${t1}\n${cont}`.replace(/\n{3,}/g, "\n\n").trim();
        return `\`\`\`mermaid\n${merged}\n\`\`\``;
      }
      return `\`\`\`mermaid\n${t1}\n\`\`\`\n\n\`\`\`mermaid\n${t2}\n\`\`\``;
    });
    guard++;
  }
  return cur;
}

/**
 * Fusiona un fence ```mermaid seguido de OTRO fence (lenguaje arbitrario o vacío) cuyo cuerpo es
 * continuación del mismo diagrama. Causa típica: el LLM parte un sequenceDiagram/flowchart en dos
 * bloques y etiqueta el segundo como ```dockerfile / ```text. Itera para cadenas de >2 fences.
 */
export function mergeSplitMermaidContinuationFences(document: string): string {
  if (!document?.trim()) return document ?? "";
  const re =
    /```mermaid[ \t]*\n([\s\S]*?)\n?```[ \t]*\n+```[a-zA-Z0-9_+#.-]*[ \t]*\n([\s\S]*?)\n?```/;
  let prev: string | null = null;
  let cur = document;
  let guard = 0;
  while (prev !== cur && guard < 30) {
    prev = cur;
    cur = cur.replace(re, (match, b1: string, b2: string) => {
      const split = splitMermaidContinuationPrefix(b2);
      if (!split) return match;
      const cont = split.continuation
        .map(stripLeakedMermaidLinePrefix)
        .join("\n")
        .replace(/^\n+|\n+$/g, "");
      const merged = `${b1.replace(/[ \t\n]+$/, "")}\n${cont}`.replace(/\n{3,}/g, "\n\n");
      const fence = "```mermaid\n" + merged + "\n```";
      // El remanente era prosa atrapada dentro del wrapper: re-emitir como markdown normal.
      const rest = split.remainder.join("\n").replace(/^\n+/, "").replace(/\n+$/, "");
      return rest ? `${fence}\n\n${rest}` : fence;
    });
    guard++;
  }
  return cur;
}

/** Fusiona entidades erDiagram en un segundo fence ```text (Copiloto / Doris §3). */
export function mergeErDiagramTextContinuationFences(document: string): string {
  if (!document?.trim()) return document ?? "";
  return document.replace(
    /```mermaid[ \t]*\n(erDiagram[^\n]*)\n```[ \t]*\n+```text[ \t]*\n([\s\S]*?)```/gi,
    (_match, header: string, body: string) => {
      if (!/^\s*[A-Za-z_][\w]*\s*\{/m.test(body)) return _match;
      return `\`\`\`mermaid\n${header.trim()}\n${body.trim()}\n\`\`\``;
    },
  );
}

/** Encabezado de sección MDD/BRD (## 4. …) colado dentro de un fence sin cerrar. */
function isMermaidMdSectionHeadingLeak(trimmed: string): boolean {
  return /^#{1,2}\s+\d+\.\s+\S/.test(trimmed);
}

function mermaidMarkdownLeakLine(trimmed: string): boolean {
  if (!trimmed) return false;
  if (/^```/.test(trimmed)) return true;
  // Prosa markdown (p. ej. nota _Propuesta derivada…_ bajo el fence mal cerrado)
  if (
    /^_[^_\n]+(?:_.*)?$/.test(trimmed) &&
    !/^(flowchart|graph|erDiagram|sequenceDiagram)\b/i.test(trimmed) &&
    // `_start --> _end`, `_a[Label]`: un id de flowchart que empieza por `_` es sintaxis, no una nota en cursiva.
    !/^_\w*(?:[\[({]|\s*(?:-->|---|==>|-\.->|--[xo>]|&))/.test(trimmed)
  ) {
    return true;
  }
  if (/^#{1,6}\s/.test(trimmed)) {
    // MDD/BRD section headings (## 4. Contratos…) colados dentro del fence — siempre prosa.
    if (/^#{1,2}\s+\d+\.\s+\S/.test(trimmed)) return true;
    if (isOrphanSequenceDiagramLine(trimmed)) return false;
    return true;
  }
  if (/^\*\*TechnicalMetadata\*\*/i.test(trimmed)) return true;
  if (/^TechnicalMetadata\s*:?\s*$/i.test(trimmed)) return true;
  if (/^-\s*`/.test(trimmed)) return true;
  if (/^[-*]\s+\S/.test(trimmed)) {
    if (isOrphanSequenceDiagramLine(trimmed)) return false;
    if (!/^\s*[a-zA-Z0-9_]+\s*(-->|---)/.test(trimmed)) {
      return true;
    }
  }
  if (/^[-*]\s+Usuario\s*→/i.test(trimmed)) return true;
  if (/^[-*]\s+→\s+/i.test(trimmed)) return true;
  if (/^[-*]\s+\d+\.\s+\*\*/.test(trimmed)) return true;
  if (/^\*\*Comportamiento requerido/i.test(trimmed)) return true;
  return false;
}

/** True si el cuerpo de un fence ```mermaid empieza con sintaxis de diagrama reconocible. */
export function looksLikeMermaidDiagramBody(body: string): boolean {
  return startsWithMermaidDiagramBody(body);
}

function startsWithMermaidDiagramBody(body: string): boolean {
  return startsWithMermaidDiagramHeader((body ?? "").trim());
}

/**
 * Parte un fence ```mermaid sin cerrar: diagrama válido vs markdown del MDD colado (## 4., notas _…_, etc.).
 */
export function splitMermaidFenceBodyAtDocumentLeak(body: string): { diagram: string; remainder: string } {
  if (!body?.trim()) return { diagram: "", remainder: "" };

  const lines = body.split("\n");
  const diagramLines: string[] = [];
  const remainderLines: string[] = [];
  let seenDiagramStart = false;
  let inErDiagram = false;
  let inRemainder = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!inRemainder) {
      if (isMermaidDiagramHeaderLine(trimmed)) {
        seenDiagramStart = true;
        inErDiagram = /^erDiagram\b/i.test(trimmed);
      }
      if (seenDiagramStart && mermaidMarkdownLeakLine(trimmed)) {
        if (
          !isMermaidMdSectionHeadingLeak(trimmed) &&
          inErDiagram &&
          isErDiagramInteriorSyntaxLine(trimmed)
        ) {
          diagramLines.push(line);
          continue;
        }
        inRemainder = true;
        remainderLines.push(line);
        continue;
      }
      diagramLines.push(line);
    } else {
      remainderLines.push(line);
    }
  }

  return {
    diagram: diagramLines.join("\n").replace(/\n{3,}/g, "\n\n").trim(),
    remainder: remainderLines.join("\n").replace(/^\n+/, "").trim(),
  };
}

/**
 * Trunca cuerpo Mermaid cuando el LLM no cerró el fence y filtró markdown
 * (TechnicalMetadata, encabezados ##, fences ```, viñetas con backticks).
 */
export function stripMarkdownLeakFromMermaidDiagramBody(raw: string): string {
  if (!raw?.trim()) return raw ?? "";

  const lines = raw.split("\n");
  const out: string[] = [];
  let seenDiagramStart = false;
  let inErDiagram = false;

  for (const line of lines) {
    const trimmed = line.trim();

    if (/\*\*TechnicalMetadata\*\*/i.test(trimmed) || /```TechnicalMetadata/i.test(trimmed)) {
      const cut = trimmed.split(/\*\*TechnicalMetadata\*\*|```TechnicalMetadata/i)[0]?.trim();
      if (cut && !mermaidMarkdownLeakLine(cut)) out.push(cut);
      break;
    }

    if (isMermaidDiagramHeaderLine(trimmed)) {
      seenDiagramStart = true;
      inErDiagram = /^erDiagram\b/i.test(trimmed);
      out.push(line);
      continue;
    }

    if (seenDiagramStart && mermaidMarkdownLeakLine(trimmed)) {
      if (
        !isMermaidMdSectionHeadingLeak(trimmed) &&
        inErDiagram &&
        isErDiagramInteriorSyntaxLine(trimmed)
      ) {
        out.push(line);
        continue;
      }
      break;
    }

    out.push(line);
  }

  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

/** Separa diagrama Mermaid válido del markdown pegado dentro del mismo fence. */
export function splitMermaidBodyAndTrailingProse(inner: string): {
  diagram: string;
  trailing: string;
} {
  if (!inner?.trim()) return { diagram: "", trailing: "" };

  const lines = inner.split("\n");
  const diagramLines: string[] = [];
  const trailingLines: string[] = [];
  let seenDiagramStart = false;
  let inErDiagram = false;
  let inTrailing = false;

  for (const line of lines) {
    const trimmed = line.trim();

    if (/\*\*TechnicalMetadata\*\*/i.test(trimmed) || /```TechnicalMetadata/i.test(trimmed)) {
      inTrailing = true;
      trailingLines.push(line);
      continue;
    }

    if (isMermaidDiagramHeaderLine(trimmed)) {
      seenDiagramStart = true;
      inErDiagram = /^erDiagram\b/i.test(trimmed);
      diagramLines.push(line);
      continue;
    }

    if (seenDiagramStart && mermaidMarkdownLeakLine(trimmed)) {
      if (
        !isMermaidMdSectionHeadingLeak(trimmed) &&
        inErDiagram &&
        isErDiagramInteriorSyntaxLine(trimmed)
      ) {
        diagramLines.push(line);
        continue;
      }
      inTrailing = true;
    }

    if (inTrailing) trailingLines.push(line);
    else diagramLines.push(line);
  }

  return {
    diagram: stripMermaidFenceWrappers(
      diagramLines.join("\n").replace(/\n{3,}/g, "\n\n").trim(),
    ),
    trailing: trailingLines.join("\n").replace(/\n{3,}/g, "\n\n").trim(),
  };
}

/** Apertura de bloque compuesto en sequenceDiagram — no `participant` ni typo `par ticipant`. */
function isSequenceCompositeBlockOpenLine(trimmed: string): boolean {
  if (/^\s*(participant|actor)\b/i.test(trimmed)) return false;
  if (/^\s*par\s+ticipant\b/i.test(trimmed)) return false;
  return /^\s*(alt|opt|loop|par|critical|break|rect)\b/i.test(trimmed);
}

/**
 * Normaliza syntax de sequenceDiagram: corrige keywords mal escritas,
 * Participants sin ID, paréntesis rotos, y labels con formato incorrecto.
 * Consolidado de MddViewer.normalizeMermaidSequenceSyntax para uso SSOT.
 */
export function normalizeSequenceDiagramSyntax(body: string): string {
  const lines = body.split("\n");
  const result: string[] = [];
  const participantIds = new Set<string>();

  for (const rawLine of lines) {
    let line = rawLine;

    // Normalize keyword casing (must match exactly, not prefix)
    line = line.replace(/^(\s*)participant\s+(?=\w)/i, "$1participant ");
    line = line.replace(/^(\s*)activate\s+/i, "$1activate ");
    line = line.replace(/^(\s*)deactivate\s+/i, "$1deactivate ");
    // `Note over X` y `note over X` son válidos: no se cambia la capitalización (la reparación de
    // `**Nota:**` emite `Note over` y reescribirlo en otra pasada rompía la idempotencia).
    line = line.replace(/^(\s*)loop\s+/i, "$1loop ");
    // La palabra clave exige separador (`(?=\s|$)`): `AltaService->>Optimizador` es un id, no `alt aService`.
    line = line.replace(/^(\s*)alt(?=\s|$)\s*/i, "$1alt ");
    line = line.replace(/^(\s*)else(?=\s|$)\s*/i, "$1else ");
    line = line.replace(/^(\s*)opt(?=\s|$)\s*/i, "$1opt ");
    if (
      /^(\s*)par\b/i.test(line) &&
      !/^(\s*)participant\b/i.test(line) &&
      !/^(\s*)par\s+ticipant\b/i.test(line)
    ) {
      // `par\s*` (no `par\b`): idempotente, `par A a B` no gana un espacio por pasada.
      line = line.replace(/^(\s*)par(?=\s|$)\s*/i, "$1par ");
    }
    line = line.replace(/^(\s*)critical(?=\s|$)\s*/i, "$1critical ");
    line = line.replace(/^(\s*)break(?=\s|$)\s*/i, "$1break ");
    line = line.replace(/^(\s*)end\s*$/, "$1end");
    line = line.replace(/^(\s*)end\s*$/, "$1end");

    // Track participant IDs
    const participantMatch = line.match(/^(\s*)participant\s+(\w+)/i);
    if (participantMatch) {
      participantIds.add(participantMatch[2]!);
    }

    // `participant Servicio Facturación` es válido (nombre con espacios): no se reescribe a
    // `participant Servicio: "Facturación"`, que el parser rechaza.

    // Quote note labels missing quotes
    if (/^(\s*)note\s+(left|right|top|bottom)\s+of\s+\w+\s*:\s*[^"]+$/i.test(line)) {
      line = line.replace(
        /^(\s*)note\s+(left|right|top|bottom)\s+of\s+(\w+)\s*:\s*(.+)$/i,
        (_m: string, indent: string, dir: string, id: string, text: string) =>
          `${indent}${_m.trim().slice(0, 4)} ${dir} of ${id}: "${text.trim()}"`,
      );
    }

    // Fix unquoted parenthesis labels: A -> B(msg) → A -> B("msg")
    // Match: arrow + target + (content without quotes)
    if (/[->]+.*\(/.test(line) && !/"\(/.test(line) && !/\(".*"\)/.test(line)) {
      line = line.replace(
        /([->]+\s*\w+)\s*\(([^")][^)]*)\)/g,
        (_m: string, prefix: string, label: string) => `${prefix}("${label.trim()}")`,
      );
    }

    // Quote unquoted brackets in labels: A -> B[msg] → A -> B["msg"]
    if (/[->]+.*\[/.test(line) && !/"\[/.test(line) && !/\[".*"\]/.test(line)) {
      line = line.replace(
        /([->]+\s*\w+)\s*\[([^"])[^\]]*\]/g,
        (_m: string, prefix: string, label: string) => `${prefix}["${label.trim()}"]`,
      );
    }

    result.push(line);
  }

  return result.join("\n");
}

/**
 * Normaliza un diagrama Mermaid existente — corrige errores comunes:
 * - IDs con espacios → reemplazados por underscore
 * - Bloques sequence sin cerrar → agrega `end`
 * - Subgraphs sin cerrar → agrega `end`
 * - Quotes inconsistentes → normaliza a double quotes
 * - Líneas en blanco excesivas → compacta
 */
/**
 * Antepone `sequenceDiagram` si el LLM omitió la cabecera pero hay participant/actor.
 * No actúa si la primera línea útil ya es la cabecera de cualquier tipo de diagrama.
 */
function ensureSequenceDiagramHeader(content: string): string {
  const t = (content ?? "").trim();
  if (!t || startsWithMermaidDiagramHeader(t)) return content ?? "";
  const { preamble, rest } = splitMermaidPreamble(t);
  if (/^(participant|actor)\s/im.test(rest)) {
    return `${preamble ? `${preamble}\n` : ""}sequenceDiagram\n${rest}`;
  }
  return content ?? "";
}

// ─── Comment stripping (sopaco/mermaid-fixer concept) ────────────────────
/**
 * Strip `%%` comment lines — they confuse the Mermaid parser when LLMs embed explanations.
 * Las directivas `%%{init: …}%%` NO son comentarios (configuran el render) y se conservan.
 */
export function stripMermaidComments(body: string): string {
  if (!body?.trim()) return body ?? "";
  return body
    .split("\n")
    .filter((line) => {
      const t = line.trim();
      // Preserve empty lines for diagram spacing; strip only actual %% comment lines
      return !t.startsWith("%%") || t.startsWith("%%{");
    })
    .join("\n");
}

// ─── Node ID sanitization (sopaco/mermaid-fixer concept) ─────────────────
/**
 * Sanitize flowchart node IDs to only contain `[a-zA-Z0-9_]` (must not start with digit).
 * Strips `()[]{}`, `:`, `,`, `+`, `=` from node IDs.
 * Example: `A[Text(id)]` → `A[Text_id]` (the paren in ID is wrong; `id` was meant as label).
 */
export function sanitizeFlowchartNodeIds(content: string): string {
  if (!/^(flowchart|graph)\s/im.test((content ?? "").trim())) return content ?? "";
  const FLOWCHART_KEYWORDS = new Set([
    "flowchart", "graph", "subgraph", "end", "linkStyle", "click",
    "style", "classDef", "class", "callback", "icon", "deploy",
    "TD", "TB", "LR", "RL", "BT", "direction",
  ]);
  return content.replace(
    /(?:^\s*|-->\s*|,\s*)([A-Za-z0-9_][\w-]*)(?=[\s\[{(])/gm,
    (_match: string, rawId: string) => {
      if (FLOWCHART_KEYWORDS.has(rawId)) return _match;
      let sanitized = rawId
        .replace(/[^A-Za-z0-9_]/g, "_")    // strip invalid chars
        .replace(/_{2,}/g, "_")              // collapse underscores
        .replace(/^_+|_+$/g, "");            // trim leading/trailing underscores
      // Prefix with _ if starts with digit (must happen AFTER trimming)
      if (/^\d/.test(sanitized)) sanitized = `_${sanitized}`;
      if (!sanitized || sanitized === rawId) return _match;
      return _match.replace(rawId, sanitized);
    },
  );
}

// ─── Chinese/Unicode label quoting (sopaco/mermaid-fixer concept) ─────────
/**
 * Quote flowchart labels containing non-ASCII characters (Chinese, Japanese, etc.).
 * Mermaid strict mode requires double-quoted labels for Unicode text.
 * `A -- 是 --> B` → `A -- "是" --> B`
 * `A[用户管理]` → `A["用户管理"]`
 */
export function quoteFlowchartChineseLabels(content: string): string {
  if (!/^(flowchart|graph)\s/im.test((content ?? "").trim())) return content ?? "";
  // Quote node labels containing non-ASCII that aren't already quoted
  let result = content.replace(
    /(\[(?!\")([^"\]]*[\u4e00-\u9fff\u3040-\u309f\u30a0-\u30ff\uac00-\ud7af][^\]]*)\])/g,
    (_m: string, _full: string, inner: string) => `["${inner.trim()}"]`,
  );
  // Quote edge labels containing non-ASCII that aren't already quoted
  result = result.replace(
    /\|(?!")([^"|]*[\u4e00-\u9fff\u3040-\u309f\u30a0-\u30ff\uac00-\ud7af][^"|]*)\|/g,
    (_m: string, inner: string) => `|"${inner.trim()}"|`,
  );
  return result;
}

// ─── Sequence activate/deactivate pairing ────────────────────────────────
/**
 * Pair orphaned `activate`/`deactivate` statements.
 * LLMs often emit `activate B` without matching `deactivate B`.
 * Strategy: pair sequential activate→deactivate for same actor, close unclosed blocks.
 */
export function normalizeSequenceActivation(body: string): string {
  if (!/^sequenceDiagram\b/im.test(body.trim())) return body;
  const lines = body.split("\n");
  const out: string[] = [];
  const stack: string[] = []; // track which actors are currently activated

  for (const line of lines) {
    const trimmed = line.trim();
    const activateMatch = trimmed.match(/^activate\s+(\S+)/i);
    const deactivateMatch = trimmed.match(/^deactivate\s+(\S+)/i);

    if (activateMatch) {
      const actor = activateMatch[1]!;
      // Avoid double-activate: skip if already activated
      if (stack.includes(actor)) continue;
      stack.push(actor);
      out.push(line);
    } else if (deactivateMatch) {
      const actor = deactivateMatch[1]!;
      // If not in stack, skip (orphan deactivate)
      const idx = stack.indexOf(actor);
      if (idx === -1) continue;
      stack.splice(idx, 1);
      out.push(line);
    } else {
      out.push(line);
    }
  }

  // Close any remaining activations (reverse order)
  for (let i = stack.length - 1; i >= 0; i--) {
    // Find the last line before the end of the diagram to insert deactivate
    const lastContentIdx = out.length - 1;
    out.splice(lastContentIdx, 0, `deactivate ${stack[i]}`);
  }

  return out.join("\n");
}

// ─── ER cardinality normalization ────────────────────────────────────────
/**
 * Normalize ER diagram cardinality notation.
 * Common LLM mistakes: `|o--|` (should be `}|--o{`), missing braces, inverted pipes.
 * Standard patterns: `||--o{`, `}o--||`, `||--||`, `}o--o{`.
 *
 * IMPORTANT: This function only matches RELATIONSHIP lines (entity1 -- entity2),
 * NOT entity definition lines (which contain `{` or `}` braces for attributes).
 */
/** Relación erDiagram válida: lado izquierdo `||`/`|o`/`}|`/`}o`, `--`, lado derecho `||`/`o|`/`|{`/`o{`. */
const VALID_ER_RELATION_RE = /^(?:\|\||\|o|\}\||\}o)--(?:\|\||o\||\|\{|o\{)$/;

export function normalizeErCardinalityNotation(body: string): string {
  if (!/^erDiagram\b/im.test(body.trim())) return body;
  return body.replace(
    /^(\s*\w+\s+)([\|\}][\|\}o*]\s*--\s*[\|\}o*][\|\{o*])(\s+\w+)/gm,
    (_match: string, prefix: string, rel: string, suffix: string) => {
      // Skip lines that are entity definitions (contain { or } braces for attributes)
      if (/[{}]/.test(prefix) || /[{}]/.test(suffix)) return _match;
      // Notación que el parser ya acepta (`|o--o{`, `}|--|{`, `|o--||`…): no se reescribe.
      // Cambiarla (p. ej. `|o--o{` → `||--o{`) altera la cardinalidad del modelo.
      if (VALID_ER_RELATION_RE.test(rel)) return _match;
      // Normalize the relationship notation
      let norm = rel
        .replace(/\s+/g, "")  // strip spaces inside notation
        .replace(/\|\|/g, "||")
        .replace(/\}\}/g, "}}")
        .replace(/\{/g, "{")
        .replace(/\}/g, "}");
      // Validate pattern: (}{|)*--(}{|)* — must be one of the valid combos
      const validPatterns = new Set([
        "||--||", "||--|{", "||--o{", "||--}o", "||--}}",
        "|{--||", "|{--|{", "|{--o{", "|{--}o", "|{--}}",
        "o{--||", "o{--|{", "o{--o{", "o{--}o", "o{--}}",
        "}o--||", "}o--|{", "}o--o{", "}o--}o", "}o--}}",
        "}}--||", "}}--|{", "}}--o{", "}}--}o", "}}--}}",
        "}|--||", "}|--|{", "}|--o{", "}|--}o", "}|--}}",
      ]);
      // Check if normalized form is valid; if not, fall back to ||--o{ (most common)
      if (!validPatterns.has(norm)) norm = "||--o{";
      return `${prefix}${norm}${suffix}`;
    },
  );
}

// ─── Class diagram visibility normalization ──────────────────────────────
/**
 * Normalize class diagram member visibility: add `+` prefix to members/methods
 * that don't have explicit visibility (`+`, `-`, `#`, `~`).
 * LLMs often emit `getAge()` instead of `+getAge()`.
 */
export function normalizeClassDiagramVisibility(body: string): string {
  if (!/^classDiagram\b/im.test(body.trim())) return body;
  return body.replace(
    /^(\s+)([a-zA-Z_]\w*(?:\s+\w+)?(?:\([^)]*\))?)\s*$/gm,
    (_match: string, indent: string, member: string) => {
      // Skip lines that already have visibility prefix
      if (/^\s*[+#\-~]/.test(member)) return _match;
      // Skip lines that are class/namespace/relationship/annotation declarations
      if (/^\s*(class|namespace|relationship|annotation|<<|linkStyle|click|style|classDef)\b/i.test(member)) return _match;
      // Skip lines with arrows (relationships)
      if (/-->|-->|<\|--|\*--|o--/.test(member)) return _match;
      // Skip block openers/closers
      if (/\{\s*$/.test(_match) || /^\s*\}\s*$/.test(_match)) return _match;
      // Add `+` (public) visibility prefix
      return `${indent}+${member}`;
    },
  );
}

// ─── Self-edge detection and guard ───────────────────────────────────────
/**
 * Detect and remove self-referencing edges (`A --> A`) which can cause infinite loops
 * in Mermaid rendering. Returns the line with self-edges commented out.
 */
export function guardFlowchartSelfEdges(content: string): string {
  if (!/^(flowchart|graph)\s/im.test((content ?? "").trim())) return content ?? "";
  return content.replace(
    /^(\s*)(\w[\w]*)\s*(--+(?:>|x|o)|==+>|-\.-+>|-{3,})\s*\2\s*$/gm,
    (_match: string, indent: string, id: string) => `${indent}%% self-edge removed: ${id} --> ${id}`,
  );
}

// ─── Structured error classification (sopaco/mermaid-fixer concept) ──────
export type MermaidErrorCategory =
  | "syntax"      // General syntax errors (unclosed blocks, bad arrows)
  | "node"        // Node definition errors (bad IDs, invalid shapes)
  | "edge"        // Edge/arrow errors (invalid connectors, missing targets)
  | "structure"   // Structural errors (unclosed subgraphs/blocks, orphan end)
  | "style"       // Style/classDef errors
  | "content"     // Content errors (prose leaking, markdown artifacts)
  | "empty"       // Empty diagram
  | "unknown";    // Unclassified

export interface MermaidClassifiedError {
  category: MermaidErrorCategory;
  message: string;
  line?: number;
}

/**
 * Classify Mermaid validation errors into structured categories.
 * Based on sopaco/mermaid-fixer's `MermaidErrorType` classification.
 */
export function classifyMermaidErrors(raw: string): MermaidClassifiedError[] {
  const source = stripMermaidFenceWrappers((raw ?? "").trim());
  if (!source.trim()) return [{ category: "empty", message: "Empty diagram body" }];

  const errors: MermaidClassifiedError[] = [];
  const lines = source.split("\n");
  const header = lines[0]?.trim() ?? "";

  // Detect diagram type
  const isFlowchart = /^(flowchart|graph)\s/i.test(header);
  const isSequence = /^sequenceDiagram\b/i.test(header);
  const isClass = /^classDiagram\b/i.test(header);

  // Empty check
  if (lines.filter((l) => l.trim()).length < 2) {
    errors.push({ category: "empty", message: "Diagram has fewer than 2 non-empty lines" });
    return errors;
  }

  // ── Structure errors (unclosed blocks) ──────────────────────────────
  if (isFlowchart || isSequence) {
    let subgraphDepth = 0;
    let blockDepth = 0;
    for (let i = 0; i < lines.length; i++) {
      const t = lines[i]!.trim();
      if (isFlowchart && /^\s*subgraph\b/.test(t)) subgraphDepth++;
      if (isSequence && isSequenceCompositeBlockOpenLine(t)) blockDepth++;
      if (/^\s*end\s*$/.test(t)) {
        if (subgraphDepth > 0) subgraphDepth--;
        else if (blockDepth > 0) blockDepth--;
        else errors.push({ category: "structure", message: "Orphan `end` without matching block", line: i + 1 });
      }
    }
    if (subgraphDepth > 0) errors.push({ category: "structure", message: `Unclosed subgraph: ${subgraphDepth} openers without matching end` });
    if (blockDepth > 0) errors.push({ category: "structure", message: `Unclosed sequence block: ${blockDepth} openers without matching end` });
  }

  if (isClass) {
    let classDepth = 0;
    for (let i = 0; i < lines.length; i++) {
      const t = lines[i]!.trim();
      if (/\b(class|annotation)\s+\w+\s*\{/.test(t)) classDepth++;
      if (/^\s*\}\s*$/.test(t)) classDepth = Math.max(0, classDepth - 1);
    }
    if (classDepth > 0) errors.push({ category: "structure", message: `Unclosed class/annotation block: ${classDepth} openers without "}"` });
  }

  // ── Node errors ─────────────────────────────────────────────────────
  if (isFlowchart) {
    for (let i = 0; i < lines.length; i++) {
      const t = lines[i]!.trim();
      // Node IDs with invalid characters
      const idMatch = t.match(/^\s*([A-Za-z0-9_][\w]*\s+\w+)\[/);
      if (idMatch && /\s/.test(idMatch[1]!.split(/\s+/)[0]!)) {
        errors.push({ category: "node", message: `Node ID with spaces: "${idMatch[1]}"`, line: i + 1 });
      }
      // Node shapes with unquoted labels containing special chars
      if (/\[[^\"]*[{}()|][^\"]*\]/.test(t) && !/\[\"[^\"]*\"\]/.test(t)) {
        errors.push({ category: "node", message: `Unquoted label with special chars`, line: i + 1 });
      }
    }
  }

  // ── Edge errors ─────────────────────────────────────────────────────
  if (isFlowchart) {
    for (let i = 0; i < lines.length; i++) {
      const t = lines[i]!.trim();
      // Multiple edges on one line
      const arrows = t.match(/(--+(?:>|x|o)|==+>|-{3,})/g) ?? [];
      if (arrows.length > 1) {
        errors.push({ category: "edge", message: `Multiple arrows on one line (${arrows.length})`, line: i + 1 });
      }
    }
  }

  if (isSequence) {
    for (let i = 0; i < lines.length; i++) {
      const t = lines[i]!.trim();
      // Invalid arrow syntax
      if (/^[\w-]+\s+[^(]+\s+[\w-]+\s*$/i.test(t) && !/^participant|^actor|^Note|^alt|^opt|^loop|^par|^critical|^break|^rect|^else|^end/i.test(t)) {
        if (/->|-x|--x|-->>/.test(t)) {
          errors.push({ category: "edge", message: `Possible invalid sequence arrow syntax`, line: i + 1 });
        }
      }
    }
  }

  // ── Content errors (prose leaking) ──────────────────────────────────
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i]!.trim();
    if (/^\*\*[A-Z]/.test(t) || /^El usuario|^Al cargar|^Tras retorno/i.test(t)) {
      errors.push({ category: "content", message: `Prose leaking into diagram at line ${i + 1}`, line: i + 1 });
    }
  }

  // ── Syntax errors (participant keyword split) ───────────────────────
  if (isSequence && /\bpar\s+ticipant\b/i.test(source)) {
    errors.push({ category: "syntax", message: "Split participant keyword (par ticipant)" });
  }

  // ── Style errors ────────────────────────────────────────────────────
  if (isFlowchart) {
    for (let i = 0; i < lines.length; i++) {
      const t = lines[i]!.trim();
      if (/^classDef\b/.test(t) && !/^classDef\s+\w+\s+/.test(t)) {
        errors.push({ category: "style", message: "Malformed classDef declaration", line: i + 1 });
      }
    }
  }

  return errors;
}

/**
 * Quita líneas de prólogo markdown (headings `### …`, viñetas, texto) que el LLM coloca
 * ANTES del primer tipo de diagrama válido dentro de un fence ```mermaid.
 * Típico: `### Flujo: integración de nuevo MCP a skills\nflowchart TD`.
 * Preserva el diagrama a partir del primer header tipo Mermaid válido; si no encuentra
 * ninguno devuelve el cuerpo intacto (lo deja para validateMermaid lo rechace con un mensaje útil).
 */
export function stripLeadingMarkdownPrologueFromMermaid(raw: string): string {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) return trimmed;
  const lines = trimmed.split("\n");
  // El front-matter `---…---` inicial pertenece al diagrama: se conserva y la búsqueda de cabecera
  // empieza después. Las directivas `%%{…}%%` que queden entre la prosa y la cabecera también.
  const start = mermaidFrontMatterEndIndex(lines) + 1;
  for (let i = start; i < lines.length; i++) {
    if (isMermaidDiagramHeaderLine(lines[i]!)) {
      const skipped = lines.slice(start, i);
      if (skipped.every((l) => !l.trim() || l.trim().startsWith("%%"))) return trimmed;
      const directives = skipped.filter((l) => l.trim().startsWith("%%{"));
      return [...lines.slice(0, start), ...directives, ...lines.slice(i)].join("\n").trim();
    }
  }
  return trimmed;
}

// ─── Registro de reglas de `normalizeMermaidDiagramBody` ─────────────────
// Cada paso del pipeline es una entrada con nombre estable. El orden del array ES el orden de
// ejecución: el comportamiento por defecto es idéntico al de la versión anterior (monolítica).
// Las reglas `structural` forman el armazón (preámbulo, cabecera, trim, colapso de líneas) y no se
// pueden deshabilitar. Las reglas `line` se ejecutan por línea en una sola pasada; las consecutivas
// del array forman un grupo.

/** Estado compartido por las reglas de una misma normalización. */
interface MermaidBodyRuleContext {
  /** Front-matter y directivas `%%{init}%%`: se quitan antes de las reparaciones y se reponen al final. */
  preamble: string;
  /** Tipo de diagrama, fijado tras las reparaciones de cabecera (antes de las reglas por tipo). */
  isErDiagram: boolean;
  isSequence: boolean;
  isFlowchart: boolean;
  isClassDiagram: boolean;
  isStateDiagram: boolean;
  /** Bloques abiertos en la pasada por líneas (subgraph en flowchart, alt/opt/loop… en sequence). */
  openBlocks: { flowchart: number; sequence: number };
  /** La regla que deja el cuerpo vacío lo marca: el resultado es "" (sin preámbulo). */
  halted: boolean;
}

/**
 * Resultado de una regla por línea:
 * - `string`: la línea reescrita; siguen las demás reglas de la línea.
 * - `null`: la línea se descarta.
 * - `{ lines }`: se emiten esas líneas tal cual y no se aplican más reglas a la línea original.
 */
type MermaidLineRuleResult = string | null | { lines: string[] };

interface MermaidLineRule {
  applyLine: (line: string, ctx: MermaidBodyRuleContext) => MermaidLineRuleResult;
  /** Líneas añadidas tras el bucle (sin pasar por las reglas por línea). */
  finish?: (ctx: MermaidBodyRuleContext) => string[];
}

interface MermaidBodyRule {
  name: string;
  /** Armazón del pipeline: siempre se aplica y no aparece en `listMermaidBodyRuleNames`. */
  structural?: boolean;
  /** Si está presente, la regla solo se aplica cuando devuelve true. */
  when?: (ctx: MermaidBodyRuleContext) => boolean;
  /** Regla sobre el cuerpo completo. */
  apply?: (body: string, ctx: MermaidBodyRuleContext) => string;
  /** Regla por línea (ver `MermaidLineRuleResult`). */
  line?: MermaidLineRule;
}

/** Línea de cabecera de flowchart/graph: no recibe reparaciones por línea. */
const isGraphOrFlowchartHeaderLine = (trimmed: string): boolean => /^(graph|flowchart)\s/i.test(trimmed);

const MERMAID_BODY_RULES: readonly MermaidBodyRule[] = [
  // ── Preparación del texto ──────────────────────────────────────────────
  { name: "fence-wrappers", apply: (body) => stripMermaidFenceWrappers(body) },
  { name: "par-ticipant", apply: (body) => body.replace(/\bpar\s+ticipant\b/gi, "participant") },
  // Quita markdown/prosa colados por el LLM ANTES del tipo de diagrama.
  { name: "markdown-prologue", apply: (body) => stripLeadingMarkdownPrologueFromMermaid(body) },
  {
    name: "split-preamble",
    structural: true,
    apply: (body, ctx) => {
      const { preamble, rest } = splitMermaidPreamble(body);
      ctx.preamble = preamble;
      return rest;
    },
  },
  { name: "sequence-ensure-header", apply: (body) => ensureSequenceDiagramHeader(body) },
  {
    name: "er-brd-markdown-leaks",
    apply: (body) => (/^erDiagram\b/im.test(body.trim()) ? repairErDiagramBrdMarkdownLeaks(body) : body),
  },
  { name: "markdown-leak", apply: (body) => stripMarkdownLeakFromMermaidDiagramBody(body) },
  {
    name: "empty-body-guard",
    structural: true,
    apply: (body, ctx) => {
      if (!body?.trim()) ctx.halted = true;
      return body;
    },
  },
  { name: "dedupe-header", apply: (body) => dedupeMermaidDiagramHeader(body) },
  { name: "er-pk-fk-commas", apply: (body) => repairErDiagramPkFkCommas(body) },
  { name: "er-ensure-header", apply: (body) => ensureErDiagramHeader(body) },
  {
    name: "detect-diagram-kind",
    structural: true,
    apply: (body, ctx) => {
      const s = body.trim();
      ctx.isErDiagram = /^erDiagram\b/i.test(s);
      ctx.isSequence = /^sequenceDiagram\b/im.test(s) || /^(participant|actor)\s/im.test(s);
      ctx.isFlowchart = /^flowchart\b/im.test(s) || /^graph\s+(?:TD|TB|LR|RL|BT)\b/im.test(s);
      ctx.isClassDiagram = /^classDiagram\b/im.test(s);
      ctx.isStateDiagram = /^stateDiagram(?:-v2)?\b/im.test(s);
      return body;
    },
  },

  // ── Reparaciones por tipo: erDiagram ───────────────────────────────────
  { name: "er-split-entity-blocks", when: (ctx) => ctx.isErDiagram, apply: (body) => splitErDiagramEntityBlocksOnSameLine(body) },
  { name: "er-duplicate-attr-types", when: (ctx) => ctx.isErDiagram, apply: (body) => repairErDiagramDuplicateAttributeTypes(body) },
  { name: "er-cardinality-notation", when: (ctx) => ctx.isErDiagram, apply: (body) => normalizeErCardinalityNotation(body) },

  // ── Reparaciones por tipo: sequenceDiagram (sobre el cuerpo completo) ──

  // ── Pasada por líneas ──────────────────────────────────────────────────
  { name: "trim-body", structural: true, apply: (body) => body.trim() },
  {
    name: "orphan-list-prefix",
    line: {
      applyLine: (line) => {
        const trimmed = line.trim();
        if (
          MERMAID_LEAKED_LIST_PREFIX_RE.test(trimmed) &&
          (isOrphanSequenceDiagramLine(trimmed) ||
            isOrphanFlowchartLine(trimmed) ||
            isOrphanErDiagramLine(trimmed) ||
            isOrphanStateDiagramLine(trimmed))
        ) {
          return normalizeOrphanSequenceDiagramLine(line);
        }
        return line;
      },
    },
  },
  {
    name: "subgraph-underscore",
    line: {
      applyLine: (line) =>
        line
          .replace(/^(\s*)subgraph_(\w+)(?=\s*["[(])/i, "$1subgraph $2")
          .replace(/^(\s*)subgraph_(\w+)\s*$/i, "$1subgraph $2"),
    },
  },
  {
    name: "header-passthrough",
    structural: true,
    line: {
      applyLine: (line) => (isGraphOrFlowchartHeaderLine(line.trim()) ? { lines: [line] } : line),
    },
  },
  {
    // Cuenta bloques abiertos y descarta los `end` sobrantes. Añade al final los `end` que falten.
    name: "block-balance",
    line: {
      applyLine: (line, ctx) => {
        const trimmed = line.trim();
        if (ctx.isFlowchart && /^\s*subgraph\s/.test(trimmed)) ctx.openBlocks.flowchart++;
        if (ctx.isSequence && isSequenceCompositeBlockOpenLine(trimmed)) ctx.openBlocks.sequence++;
        if (ctx.isSequence && /^\s*end\s*$/.test(trimmed)) {
          if (ctx.openBlocks.sequence === 0) return null;
          ctx.openBlocks.sequence = Math.max(0, ctx.openBlocks.sequence - 1);
          return { lines: [line] };
        }
        if (ctx.isFlowchart && /^\s*end\s*$/.test(trimmed)) {
          if (ctx.openBlocks.flowchart === 0) return null;
          ctx.openBlocks.flowchart = Math.max(0, ctx.openBlocks.flowchart - 1);
          return { lines: [line] };
        }
        return line;
      },
      finish: (ctx) => {
        const closing: string[] = [];
        const unclosedFlowchart = ctx.isFlowchart ? ctx.openBlocks.flowchart : 0;
        const unclosedSequence = ctx.isSequence ? ctx.openBlocks.sequence : 0;
        for (let i = 0; i < unclosedFlowchart; i++) closing.push("  end");
        for (let i = 0; i < unclosedSequence; i++) closing.push("  end");
        return closing;
      },
    },
  },
  {
    // `[Stereotype]` de classDiagram: `Foo <<x>>` pasa a dos líneas.
    name: "class-stereotype-split",
    when: (ctx) => ctx.isClassDiagram,
    line: {
      applyLine: (line) => {
        const m = line.trim().match(/^(\w[\w]*)\s+<<(.+)>>\s*$/);
        return m ? { lines: [`  ${m[1]}`, `  <<${m[2]}>>`] } : line;
      },
    },
  },
  {
    // `Class Foo` (mayúscula) lo rechaza el parser: se pasa a minúscula. Nunca se elimina la palabra
    // `class`: `class Animal {` es sintaxis válida y sin ella el bloque deja de parsear.
    name: "class-keyword-case",
    when: (ctx) => ctx.isClassDiagram,
    line: { applyLine: (line) => line.replace(/^(\s*)Class(\s+)/, "$1class$2") },
  },
  {
    name: "state-keywords",
    when: (ctx) => ctx.isStateDiagram,
    line: {
      applyLine: (line) =>
        line
          .replace(/^(\s*)note\s+(left|right|top|bottom)\s+of\s+/i, (_m, indent: string, dir: string) => `${indent}note ${dir} of `)
          .replace(/^(\s*)direction\s+(LR|TD|BT|RL)\b/i, (_m, indent: string, dir: string) => `${indent}direction ${dir}`),
    },
  },
  {
    // Id de nodo con espacios (`My Node[Etiqueta]`) → `My_Node[Etiqueta]`: solo donde Mermaid espera un id.
    name: "flowchart-node-id-spaces",
    when: (ctx) => ctx.isFlowchart,
    line: {
      applyLine: (line) => {
        if (/^\s*(subgraph|state|class|namespace|direction)\b/i.test(line)) return line;
        return replaceOutsideDoubleQuotes(
          line,
          /(^\s*|(?:--+>|==+>|-\.-+>|---|&)\s*(?:\|[^|\n]*\|\s*)?)(\w+)\s+(\w+)(\[|\()/g,
          (_match, anchor, p1, p2, p3) => `${anchor}${cleanId(p1)}_${cleanId(p2)}${p3}`,
        );
      },
    },
  },
  {
    name: "literal-newline",
    line: { applyLine: (line) => line.replace(/\\n/g, " ") },
  },

  // ── Cierre de la pasada por líneas ─────────────────────────────────────
  {
    name: "collapse-blank-lines",
    structural: true,
    apply: (body) => body.replace(/\n{3,}/g, "\n\n").trim(),
  },

  // ── Reparaciones posteriores de flowchart (sobre el cuerpo ya unido) ───
  { name: "flowchart-trailing-garbage", when: (ctx) => ctx.isFlowchart, apply: (body) => stripFlowchartTrailingTextGarbage(body) },
  { name: "flowchart-multi-edge-split", when: (ctx) => ctx.isFlowchart, apply: (body) => splitFlowchartMultiEdgeLines(body) },
  { name: "flowchart-missing-target-ids", when: (ctx) => ctx.isFlowchart, apply: (body) => repairFlowchartMissingTargetNodeIds(body) },
  { name: "quote-flowchart-paren-labels", when: (ctx) => ctx.isFlowchart, apply: (body) => quoteFlowchartLabelsWithParens(body) },
  { name: "quote-flowchart-spaced-labels", when: (ctx) => ctx.isFlowchart, apply: (body) => quoteFlowchartSpacedLabels(body) },
  { name: "quote-flowchart-edge-labels", when: (ctx) => ctx.isFlowchart, apply: (body) => quoteFlowchartEdgeLabels(body) },

  {
    name: "restore-preamble",
    structural: true,
    apply: (body, ctx) => (ctx.preamble ? `${ctx.preamble}\n${body}` : body),
  },
];

/** Nombres de las reglas de reparación del pipeline de `normalizeMermaidDiagramBody`, en orden de ejecución. */
export function listMermaidBodyRuleNames(): string[] {
  return MERMAID_BODY_RULES.filter((rule) => !rule.structural).map((rule) => rule.name);
}

function isMermaidBodyRuleActive(
  rule: MermaidBodyRule,
  ctx: MermaidBodyRuleContext,
  disabledRules: ReadonlySet<string> | undefined,
): boolean {
  if (!rule.structural && disabledRules?.has(rule.name)) return false;
  return !rule.when || rule.when(ctx);
}

/** Aplica un grupo de reglas por línea en una sola pasada, en orden, respetando `MermaidLineRuleResult`. */
function runMermaidLineRules(body: string, rules: readonly MermaidBodyRule[], ctx: MermaidBodyRuleContext): string {
  const out: string[] = [];
  for (const line of body.split("\n")) {
    let current = line;
    let emitted: string[] | null = null;
    for (const rule of rules) {
      const result = rule.line!.applyLine(current, ctx);
      if (result === null) {
        emitted = [];
        break;
      }
      if (typeof result === "string") {
        current = result;
        continue;
      }
      emitted = result.lines;
      break;
    }
    if (emitted) out.push(...emitted);
    else out.push(current);
  }
  for (const rule of rules) {
    if (rule.line!.finish) out.push(...rule.line!.finish(ctx));
  }
  return out.join("\n");
}

function runMermaidBodyRules(raw: string, disabledRules: ReadonlySet<string> | undefined): string {
  const ctx: MermaidBodyRuleContext = {
    preamble: "",
    isErDiagram: false,
    isSequence: false,
    isFlowchart: false,
    isClassDiagram: false,
    isStateDiagram: false,
    openBlocks: { flowchart: 0, sequence: 0 },
    halted: false,
  };
  let body = raw;
  let i = 0;
  while (i < MERMAID_BODY_RULES.length) {
    const rule = MERMAID_BODY_RULES[i]!;
    if (rule.line) {
      const group: MermaidBodyRule[] = [];
      while (i < MERMAID_BODY_RULES.length && MERMAID_BODY_RULES[i]!.line) {
        const lineRule = MERMAID_BODY_RULES[i]!;
        i++;
        if (isMermaidBodyRuleActive(lineRule, ctx, disabledRules)) group.push(lineRule);
      }
      body = runMermaidLineRules(body, group, ctx);
      continue;
    }
    i++;
    if (!rule.apply || !isMermaidBodyRuleActive(rule, ctx, disabledRules)) continue;
    body = rule.apply(body, ctx);
    if (ctx.halted) return "";
  }
  return body;
}

/**
 * Normaliza el cuerpo de un diagrama Mermaid (sin fences) aplicando las reglas del registro en orden.
 * `options.disabledRules` salta reglas por nombre (ver `listMermaidBodyRuleNames`); las estructurales
 * no se pueden deshabilitar. Sin opciones, la salida es la de siempre.
 */
export function normalizeMermaidDiagramBody(
  raw: string,
  options?: { disabledRules?: ReadonlySet<string> },
): string {
  return runMermaidBodyRules(raw, options?.disabledRules);
}

/** Un solo bloque ```mermaid … ``` (entrada puede incluir fences). */
export function normalizeMermaid(raw: string): string {
  if (!raw?.trim()) return raw ?? "";
  const text = raw
    .replace(/^```mermaid\s*\n?/i, "")
    .replace(/\n?```\s*$/i, "")
    .trim();
  const body = normalizeMermaidDiagramBody(text);
  if (!body) return raw;
  return `\`\`\`mermaid\n${body}\n\`\`\``;
}

/** Normaliza cada bloque mermaid del documento sin tocar el resto del markdown. */
export function normalizeMermaidInDocument(document: string): string {
  if (!document?.trim()) return document ?? "";
  // 0x) Palabras sueltas "text" y "mermaid" antes del fence (LLM artifacts).
  let merged = document.replace(
    /\n\s*text\s*\n\s*mermaid\s*\n\s*```mermaid/gi,
    "\n```mermaid",
  );
  // 0xx) Bloques ```text que contienen sintaxis mermaid (flowchart/sequenceDiagram -->).
  merged = merged.replace(
    /```text\n([\s\S]*?)```/gi,
    (_full: string, inner: string) => {
      const hasMermaidSyntax = /(?:flowchart|graph|sequenceDiagram|erDiagram|stateDiagram)\b/i.test(inner)
        && /(?:-->|-->>|--|-->|==>|---)/i.test(inner);
      if (!hasMermaidSyntax) return _full;
      return "```mermaid\n" + inner.trim() + "\n```";
    },
  );
  // 0a) Doble apertura ```mermaid seguida de ```mermaid (LLM / pipeline).
  merged = merged.replace(/```mermaid\s*\n+\s*```mermaid/gi, "```mermaid");
  // 0) Cierre erróneo ```mermaid en lugar de ``` (debe ir antes de unfenced repair).
  merged = repairMermaidFenceClosedWithMermaidTag(merged);
  // 0b) Diagramas volcados sin fence ```mermaid (texto plano + listas markdown).
  merged = repairUnfencedMermaidInDocument(merged);
  // 1) Fusiona diagramas partidos en un 2.º fence con lenguaje arbitrario (```dockerfile, ```text…).
  merged = mergeSplitMermaidContinuationFences(merged);
  merged = mergeErDiagramTextContinuationFences(merged);
  // 2) Re-absorbe líneas (sequence/flowchart) que quedaron fuera tras un cierre prematuro del fence.
  merged = repairFragmentedSequenceMermaidInDocument(merged);
  return merged.replace(/```mermaid\s*\n([\s\S]*?)```/gi, (_block, inner: string) => {
    const { diagram: rawDiagram, trailing } = splitMermaidBodyAndTrailingProse(inner);
    const body = normalizeMermaidDiagramBody(rawDiagram);
    if (!body) return trailing ? `${trailing}\n` : "```mermaid\n```";
    // Nunca se degrada un fence a prosa: aunque la cabecera no se reconozca (tipo nuevo de Mermaid,
    // cuerpo dudoso), el fence se conserva y decide el parser real. Quitar el fence perdía diagramas
    // válidos (C4, sankey, block, architecture, packet).
    const fence = `\`\`\`mermaid\n${body}\n\`\`\``;
    return trailing ? `${fence}\n\n${trailing}` : fence;
  });
}

export type MermaidFixStrategy = "repair" | "regenerate";

/** Reparación determinista de un bloque Mermaid (cuerpo sin fences). */
export function repairMermaidBlockBody(raw: string): string {
  const body = stripMermaidFenceWrappers((raw ?? "").trim());
  if (!body) return "";
  return normalizeMermaidDiagramBody(body);
}

/**
 * Decide si basta reparación local o hace falta regenerar con LLM.
 * Usado por el botón «Reparar» / «Regenerar» del visor.
 *
 * Enhanced with structured error classification (sopaco/mermaid-fixer concept).
 * Errors are now categorized into: syntax, node, edge, structure, style, content, empty.
 */
export function assessMermaidFixStrategy(raw: string): {
  strategy: MermaidFixStrategy;
  reasons: string[];
  repairedPreview: string;
  classifiedErrors: MermaidClassifiedError[];
} {
  const source = stripMermaidFenceWrappers((raw ?? "").trim());
  const reasons: string[] = [];

  if (!source) {
    return { strategy: "regenerate", reasons: ["empty"], repairedPreview: "", classifiedErrors: [{ category: "empty", message: "Empty diagram body" }] };
  }

  if (/\bpar\s+ticipant\b/i.test(source)) reasons.push("participant_keyword_split");
  if (/```\s*text/i.test(raw)) reasons.push("split_across_fences");

  if (/sequenceDiagram/i.test(source)) {
    const opens = source
      .split("\n")
      .filter((l) => isSequenceCompositeBlockOpenLine(l.trim())).length;
    const closes = (source.match(/^\s*end\s*$/gim) ?? []).length;
    if (closes > opens) reasons.push("orphan_end_lines");
  }

  const looksTruncated =
    /sequenceDiagram/i.test(source) &&
    /(->>|-->>)/.test(source) &&
    !/(ValidateLicenseResponse|Plugin cargado|Activar features|License válida)/i.test(source) &&
    /Plugin->>Web|onPluginInit|payment_intent/i.test(source);
  if (looksTruncated) reasons.push("truncated_flow");

  const repairedPreview = repairMermaidBlockBody(source);
  const errors = validateMermaid(repairedPreview);
  const classifiedErrors = classifyMermaidErrors(source);

  // Si la reparación local deja el diagrama válido, no forzar regeneración LLM.
  if (errors.length === 0 && repairedPreview.trim()) {
    return {
      strategy: "repair",
      reasons: reasons.length ? reasons : ["valid_after_repair"],
      repairedPreview,
      classifiedErrors,
    };
  }

  const forceRegenerate =
    reasons.includes("split_across_fences") ||
    reasons.includes("truncated_flow") ||
    (reasons.includes("orphan_end_lines") && reasons.includes("participant_keyword_split"));

  // Structured classification boost: structure/syntax errors are harder to repair
  const structureErrors = classifiedErrors.filter((e) => e.category === "structure").length;
  const syntaxErrors = classifiedErrors.filter((e) => e.category === "syntax").length;
  const contentErrors = classifiedErrors.filter((e) => e.category === "content").length;

  const needsRegenerate =
    forceRegenerate ||
    (reasons.includes("orphan_end_lines") && errors.length > 0) ||
    (reasons.includes("participant_keyword_split") && errors.length > 1) ||
    errors.length > 3 ||
    structureErrors >= 2 ||  // Multiple structural issues → regenerate
    (syntaxErrors >= 1 && structureErrors >= 1) ||  // Syntax + structure → regenerate
    contentErrors >= 3;  // Heavy prose contamination → regenerate

  return {
    strategy: needsRegenerate ? "regenerate" : "repair",
    reasons: [...reasons, ...errors.slice(0, 3)],
    repairedPreview,
    classifiedErrors,
  };
}

// ─── Markdown → Flowchart wrapping ──────────────────────────────────────
/**
 * Convert markdown section structure (headings, bullet lists) into a valid
 * Mermaid flowchart. Headings become nodes, nesting creates edges.
 * Useful when the orchestrator receives raw markdown and needs a diagram.
 *
 * @param body  Markdown text with `#`/`##` headings and optional `- ` bullets.
 * @param direction  Flowchart direction (default: `TD`).
 * @returns A complete `flowchart TD` block.
 */
export function wrapMarkdownWithFlowchart(
  body: string,
  direction: string = "TD",
): string {
  const lines = body.split("\n");
  const nodes: Array<{ id: string; label: string; level: number }> = [];
  const edges: Array<{ from: string; to: string; label?: string }> = [];
  const validDir = /^(TD|TB|LR|RL|BT)$/i.test(direction)
    ? direction.toUpperCase()
    : "TD";

  for (const line of lines) {
    const headingMatch = line.match(/^(#{1,6})\s+(.+)/);
    if (headingMatch) {
      const level = headingMatch[1]!.length;
      const label = headingMatch[2]!.trim();
      const id = `N${nodes.length + 1}`;
      nodes.push({ id, label, level });
      continue;
    }
    const bulletMatch = line.match(/^(\s*)[-*]\s+(.+)/);
    if (bulletMatch) {
      const label = bulletMatch[2]!.trim();
      const id = `N${nodes.length + 1}`;
      const parentLevel = bulletMatch[1]!.length >= 2 ? 2 : 1;
      nodes.push({ id, label, level: parentLevel });
    }
  }

  if (nodes.length === 0) return "flowchart TD\n  EmptyDoc[\"(empty document)\"]";

  // Build edges: each node connects to its nearest preceding node of lower level
  const stack: typeof nodes = [];
  for (const node of nodes) {
    while (stack.length > 0 && stack[stack.length - 1]!.level >= node.level) {
      stack.pop();
    }
    if (stack.length > 0) {
      edges.push({ from: stack[stack.length - 1]!.id, to: node.id });
    }
    stack.push(node);
  }

  const nodeDefs = nodes.map(
    (n) => `  ${n.id}["${n.label.replace(/"/g, "'")}"]`,
  );
  const edgeDefs = edges.map(
    (e) => `  ${e.from} --> ${e.to}`,
  );

  return `flowchart ${validDir}\n${[...nodeDefs, ...edgeDefs].join("\n")}`;
}

// ─── Sequence activation ordering ───────────────────────────────────────
// ─── Sequence arrow repair ──────────────────────────────────────────────
// ─── Quick renderability check ──────────────────────────────────────────
/**
 * Lightweight structural validation that checks whether a Mermaid diagram
 * body is likely to render without crashing the Mermaid parser.
 *
 * Does NOT check every Mermaid syntax rule — just the top render-breaking
 * issues.  For deeper analysis, use `assessMermaidFixStrategy`.
 *
 * @returns `{ valid: true }` or `{ valid: false, errors: [...] }`.
 */
export function validateMermaidRenderable(body: string): {
  valid: boolean;
  errors: string[];
} {
  const errors: string[] = [];
  const trimmed = (body ?? "").trim();

  if (!trimmed) {
    return { valid: false, errors: ["empty_body"] };
  }

  // Check for diagram type header
  const hasHeader = /^(flowchart|graph|sequenceDiagram|classDiagram|erDiagram|stateDiagram|stateDiagram-v2|gantt|pie|gitGraph)\b/i.test(trimmed);
  if (!hasHeader) {
    errors.push("missing_diagram_header");
  }

  // Count opening/closing fences inside body (should be 0 if raw body)
  const fences = (trimmed.match(/```/g) ?? []).length;
  if (fences > 0) {
    errors.push("contains_fences_strip_first");
  }

  // Sequence: check alt/opt/loop blocks are closed
  const seqKeywords = trimmed.match(
    /^\s*(alt|opt|loop|break|par|rect|critical)\b/gim,
  );
  const seqEnds = trimmed.match(/^\s*end\b/gim);
  if (seqKeywords && seqKeywords.length > (seqEnds?.length ?? 0)) {
    errors.push(`unclosed_sequence_block_open=${seqKeywords.length}_close=${seqEnds?.length ?? 0}`);
  }

  // Flowchart: check subgraph/end balance
  const subgraphs = trimmed.match(/^\s*subgraph\b/gim);
  const flowEnds = trimmed.match(/^\s*end\b/gim);
  if (subgraphs && subgraphs.length > (flowEnds?.length ?? 0)) {
    errors.push(`unclosed_subgraph_open=${subgraphs.length}_close=${flowEnds?.length ?? 0}`);
  }

  // ER: check braces balance in entity definitions
  const erEntities = trimmed.match(/^\s*\w+\s*\{/gim);
  if (erEntities) {
    const openBraces = (trimmed.match(/\{/g) ?? []).length;
    const closeBraces = (trimmed.match(/\}/g) ?? []).length;
    if (openBraces !== closeBraces) {
      errors.push(`unbalanced_braces_open=${openBraces}_close=${closeBraces}`);
    }
  }

  // Node ID with space before `[` (Mermaid parser crash)
  if (/^[A-Za-z0-9_]+\s+\[/m.test(trimmed)) {
    errors.push("node_id_space_before_bracket");
  }

  // Check for completely empty diagram body (only header, no content)
  if (hasHeader) {
    const afterHeader = trimmed.replace(
      /^(flowchart|graph|sequenceDiagram|classDiagram|erDiagram|stateDiagram|stateDiagram-v2|gantt|pie|gitGraph)\b[^\n]*\n?/i,
      "",
    ).trim();
    if (!afterHeader) {
      errors.push("empty_diagram_body");
    }
  }

  return { valid: errors.length === 0, errors };
}
