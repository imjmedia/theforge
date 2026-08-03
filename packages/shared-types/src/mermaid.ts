/**
 * @fileoverview **Experta en diagramas Mermaid** — única fuente de verdad para generar y normalizar
 * diagramas Mermaid en todo TheForge. Cubre todos los tipos de diagrama comunes.
 *
 * ## Reglas de normalización
 *
 * 1. Node IDs sin espacios (reemplazar con guiones o underscores).
 * 2. Quotes consistentes (double quotes para labels con espacios/símbolos).
 * 3. Bloques alt/end siempre cerrados en sequence diagrams.
 * 4. Participants siempre declarados en sequence diagrams.
 * 5. Arrows con sintaxis correcta (->> vs -->> vs -x vs --x).
 * 6. Subgraph siempre con `end`.
 * 7. Sin líneas en blanco dentro de bloques que no las soporten.
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
 * flowchart/graph: quote edge labels with spaces, accents, or `/{}:` so Mermaid 11 parses reliably.
 * Example: `A -->|Comunica vía| B` → `A -->|"Comunica vía"| B`.
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
      if (/[^\x00-\x7F]|\s|\/|[{}:]/.test(trimmed)) {
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

/** Comas tipográficas → ASCII antes de reparar anotaciones PK/FK. */
function normalizeMermaidCommas(text: string): string {
  return text.replace(/[\uFF0C\u201A\uFE50\uFE51\u3001]/g, ",");
}

/**
 * erDiagram: Mermaid admite un solo marcador PK o FK por atributo.
 * `uuid user_id PK, FK` y `uuid id PK FK` rompen el parser; si la columna es PK+FK, conservamos PK.
 */
export function repairErDiagramPkFkCommas(content: string): string {
  if (!content?.trim()) return content ?? "";
  const normalized = normalizeMermaidCommas(content);
  return normalized
    .replace(/\bPK\s*,\s*FK\b/gi, "PK")
    .replace(/\bFK\s*,\s*PK\b/gi, "PK")
    .replace(/\bPK\s+FK\b/gi, "PK")
    .replace(/\bFK\s+PK\b/gi, "PK");
}

/** Si el cuerpo parece erDiagram pero falta la declaración inicial, la antepone. */
export function ensureErDiagramHeader(content: string): string {
  const t = (content ?? "").trim();
  if (!t) return t;
  if (/^erDiagram\b/i.test(t)) return t;
  if (/^\s*\w[\w]*\s*\{/m.test(t)) return `erDiagram\n\n${t}`;
  return t;
}

/** Regex de cabecera de diagrama en la primera columna de una línea (sin fence). */
const MERMAID_DIAGRAM_HEADER_LINE =
  /^(erDiagram|flowchart|graph|sequenceDiagram|stateDiagram(?:-v2)?|classDiagram|gantt|pie|gitGraph|mindmap|timeline|journey|quadrantChart|xychart-beta|xychart|block-beta|blockDiagram|packet-beta|sankey-beta|architecture-beta|requirementDiagram|C4Context|C4Container|C4Component|C4Dynamic|C4Deployment)\b/i;

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

/** Tipos PostgreSQL → tipos Mermaid seguros en erDiagram. */
export function normalizeErDiagramPgTypes(content: string): string {
  return content
    // PostgreSQL types → Mermaid-friendly types
    .replace(/\btimestamptz(?:\s+with\s+time\s+zone)?\b/gi, "datetime")
    .replace(/\btimestamp(?:\s+without\s+time\s+zone)?\b/gi, "datetime")
    .replace(/\binet\b/gi, "string")
    .replace(/\bjsonb?\b/gi, "json")
    .replace(/\bboolean\b/gi, "bool")
    .replace(/\bserial\b/gi, "int")
    .replace(/\bbigserial\b/gi, "int")
    .replace(/\bdouble\s+precision\b/gi, "float")
    .replace(/\breal\b/gi, "float")
    .replace(/\bbytea\b/gi, "string")
    .replace(/\bnumeric(?:\s*\([^)]*\))?\b/gi, "int")
    .replace(/\bcharacter\s+varying(?:\s*\([^)]*\))?\b/gi, "string")
    .replace(/\bcharacter(?:\s*\([^)]*\))?\b/gi, "string")
    // uuid is valid Mermaid and semantically meaningful — preserve it
    .replace(/\btext\b/gi, "string")
    .replace(/\barray\b/gi, "string")
    .replace(/\bsmallint\b/gi, "int")
    .replace(/\bbigint\b/gi, "int")
    // PK/FK normalization (keep only one marker)
    .replace(/\bPK\s*,\s*FK\b/gi, "PK")
    .replace(/\bFK\s*,\s*PK\b/gi, "PK")
    .replace(/\bPK\s+FK\b/gi, "PK")
    .replace(/\bFK\s+PK\b/gi, "PK");
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

/** flowchart/graph: labels con espacios o acentos sin comillas (`A[Módulo Tenants]`). */
export function quoteFlowchartSpacedLabels(content: string): string {
  if (!/^(flowchart|graph)\s/im.test((content ?? "").trim())) return content ?? "";
  return content.replace(
    /(\b[A-Za-z0-9_*][\w]*)\[([^\]"]+)\]/g,
    (match, id: string, label: string) => {
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
      const [, indent, type1, name, type2] = m;
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

/**
 * flowchart/graph: el LLM a veces concatena varias aristas en una línea (`A --> B    C --> D`).
 * Mermaid 11 solo admite una arista por línea; partimos antes del nodo origen de la siguiente.
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
      const parts = trimmed.split(splitRe).filter(Boolean);
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

export function erDiagramHasPkFkComma(content: string): boolean {
  const repaired = repairErDiagramPkFkCommas(content);
  return /\bPK\s*,\s*FK\b|\bFK\s*,\s*PK\b/i.test(repaired);
}

/**
 * Valida un diagrama Mermaid existente y devuelve errores encontrados.
 * No modifica el input — solo reporta qué arreglar.
 */
export function validateMermaid(raw: string): string[] {
  const errors: string[] = [];
  if (!raw) return ["Empty mermaid content"];

  const lines = raw.split("\n").filter((l) => l.trim());
  if (lines.length === 0) return ["Empty mermaid content"];

  const firstLine = lines[0]!.trim();

  // Detectar tipo
  const typeMatch = firstLine.match(/^(graph|flowchart|sequenceDiagram|classDiagram|erDiagram|stateDiagram|stateDiagram-v2|gantt|pie|gitGraph|quadrantChart|mindmap|timeline|xychart-beta|xychart|block-beta|block|packet-beta|sankey-beta|architecture-beta|requirementDiagram|C4Context|C4Container|C4Component|C4Dynamic|C4Deployment)/i);
  if (!typeMatch) {
    errors.push(`Unknown diagram type. First line: "${firstLine}". Must start with a valid mermaid type.`);
  }

  const mermaidType = typeMatch?.[1];

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

function stripSequenceMessageMarkdown(text: string): string {
  return text.replace(/\*\*/g, "").replace(/\s+/g, " ").trim();
}

function formatSequenceArrowMessage(
  indent: string,
  from: string,
  arrow: string,
  to: string,
  message: string,
): string {
  const cleaned = message.replace(/"/g, "'").slice(0, MAX_MERMAID_LABEL_CHARS);
  if (/[{}]/.test(cleaned) || /\?\w+=/.test(cleaned) || /[()]/.test(cleaned)) {
    return `${indent}${from}${arrow}${to}: "${cleaned}"`;
  }
  return `${indent}${from}${arrow}${to}: ${cleaned}`;
}

/**
 * Repara líneas sequenceDiagram: quita markdown `**` fugado en mensajes y parte
 * `Respuesta**Nota:** prosa` en flecha + `Note over`.
 */
function repairSequenceDiagramLine(line: string): string[] {
  const trimmed = line.trim();
  if (/^Note over\b/i.test(trimmed)) {
    return [
      line.replace(/^(Note over\s+[\w,\s]+:\s*)(?!")(.+)$/i, (_m, prefix: string, msg: string) => {
        const t = stripSequenceMessageMarkdown(msg);
        if (!t) return line;
        if (/[{}]/.test(t)) {
          return `${prefix}"${t.replace(/"/g, "'").slice(0, MAX_MERMAID_LABEL_CHARS)}"`;
        }
        return `${prefix}${t.slice(0, MAX_MERMAID_LABEL_CHARS)}`;
      }),
    ];
  }

  const m = trimmed.match(
    /^(\s*)([\w-]+)\s*(-+>>|->>|-->>|--x|-x>|--+>|==+>)\s*([\w-]+)\s*:\s*(.+)$/,
  );
  if (!m) return [line];

  const [, indent = "", from, arrow, to, rawMsg = ""] = m;
  const message = rawMsg.trim();
  if (!message || !from || !arrow || !to) return [line];
  if (/^"/.test(message)) return [line];

  const embeddedNote = message.match(/^(.+?)\*\*(?:Nota|Note)\s*:\*\*\s*(.+)$/i);
  if (embeddedNote) {
    const main = stripSequenceMessageMarkdown(embeddedNote[1]!);
    const noteText = stripSequenceMessageMarkdown(embeddedNote[2]!);
    const out: string[] = [];
    if (main) out.push(formatSequenceArrowMessage(indent, from, arrow, to, main));
    if (noteText) {
      out.push(`${indent}Note over ${to}: ${noteText.slice(0, MAX_MERMAID_LABEL_CHARS)}`);
    }
    return out.length ? out : [line];
  }

  const genericBoldLabel = message.match(/^(.+?)\*\*([^*:\n]{2,80}):\*\*\s*(.+)$/);
  if (genericBoldLabel) {
    const main = stripSequenceMessageMarkdown(genericBoldLabel[1]!);
    const noteText = stripSequenceMessageMarkdown(genericBoldLabel[3]!);
    const out: string[] = [];
    if (main) out.push(formatSequenceArrowMessage(indent, from, arrow, to, main));
    if (noteText) {
      out.push(`${indent}Note over ${to}: ${noteText.slice(0, MAX_MERMAID_LABEL_CHARS)}`);
    }
    return out.length ? out : [line];
  }

  if (/\*\*/.test(message)) {
    return [formatSequenceArrowMessage(indent, from, arrow, to, stripSequenceMessageMarkdown(message))];
  }

  if (/[{}]/.test(message) || /\?\w+=/.test(message)) {
    return [formatSequenceArrowMessage(indent, from, arrow, to, message)];
  }

  return [line];
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
  if (/^_[^_\n]+(?:_.*)?$/.test(trimmed) && !/^(flowchart|graph|erDiagram|sequenceDiagram)\b/i.test(trimmed)) {
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
  if (/^[-*]\s+(El usuario|Al cargar|Tras retorno|Logout:)/i.test(trimmed)) return true;
  if (/^\*\*Comportamiento requerido/i.test(trimmed)) return true;
  if (
    /^\[(?:high_security|external_api|multi_tenant|cicd_pipeline|real_time|advanced_monitoring)\]/i.test(
      trimmed,
    )
  ) {
    return true;
  }
  return false;
}

const MERMAID_BODY_START =
  /^\s*(erDiagram|flowchart|graph|sequenceDiagram|stateDiagram(?:-v2)?|classDiagram|gantt|pie|gitGraph|mindmap|timeline|journey|quadrantChart|xychart|blockDiagram|requirementDiagram)\b/i;

/** True si el cuerpo de un fence ```mermaid empieza con sintaxis de diagrama reconocible. */
export function looksLikeMermaidDiagramBody(body: string): boolean {
  return MERMAID_BODY_START.test((body ?? "").trim());
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
      if (MERMAID_BODY_START.test(trimmed)) {
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

    if (MERMAID_DIAGRAM_HEADER_LINE.test(trimmed)) {
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

    if (MERMAID_DIAGRAM_HEADER_LINE.test(trimmed)) {
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
    line = line.replace(/^(\s*)note\s+/i, "$1note ");
    line = line.replace(/^(\s*)loop\s+/i, "$1loop ");
    line = line.replace(/^(\s*)alt\s*/i, "$1alt ");
    line = line.replace(/^(\s*)else\s*/i, "$1else ");
    line = line.replace(/^(\s*)opt\s*/i, "$1opt ");
    if (
      /^(\s*)par\b/i.test(line) &&
      !/^(\s*)participant\b/i.test(line) &&
      !/^(\s*)par\s+ticipant\b/i.test(line)
    ) {
      line = line.replace(/^(\s*)par\b/i, "$1par ");
    }
    line = line.replace(/^(\s*)critical\s*/i, "$1critical ");
    line = line.replace(/^(\s*)break\s*/i, "$1break ");
    line = line.replace(/^(\s*)end\s*$/, "$1end");
    line = line.replace(/^(\s*)end\s*$/, "$1end");

    // Track participant IDs
    const participantMatch = line.match(/^(\s*)participant\s+(\w+)/i);
    if (participantMatch) {
      participantIds.add(participantMatch[2]!);
    }

    // Quote participant labels missing quotes: participant Bob -> participant "Bob"
    // But only if there's no quote yet and the label is not a bare ID
    if (/^(\s*)participant\s+\w+\s+[A-Z][a-z]/.test(line) && !/"/.test(line)) {
      line = line.replace(
        /^(\s*)participant\s+(\w+)\s+(.+)$/,
        "$1participant $2: \"$3\"",
      );
    }

    // Quote note labels missing quotes
    if (/^(\s*)note\s+(left|right|top|bottom)\s+of\s+\w+\s*:\s*[^"]+$/.test(line)) {
      line = line.replace(
        /^(\s*)note\s+(left|right|top|bottom)\s+of\s+(\w+)\s*:\s*(.+)$/,
        (_m: string, indent: string, dir: string, id: string, text: string) =>
          `${indent}note ${dir} of ${id}: "${text.trim()}"`,
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
/** Normaliza solo el cuerpo del diagrama (sin fences). */
/** Mermaid v11 prefers `flowchart`; `graph` is legacy alias — normalize header for reliable render. */
function normalizeGraphKeywordToFlowchart(content: string): string {
  return (content ?? "")
    .replace(/^(\s*)graph(\s+(?:TD|LR|BT|RL|TB)\b)/im, "$1flowchart$2")
    .replace(/^(\s*)graph(\s*)$/im, "$1flowchart TD");
}

/** Antepone `sequenceDiagram` si el LLM omitió la cabecera pero hay participant/actor. */
function ensureSequenceDiagramHeader(content: string): string {
  const t = (content ?? "").trim();
  if (!t || /^sequenceDiagram\b/im.test(t)) return content ?? "";
  if (/^(participant|actor)\s/im.test(t)) return `sequenceDiagram\n${t}`;
  return content ?? "";
}

// ─── Comment stripping (sopaco/mermaid-fixer concept) ────────────────────
/** Strip `%%` comment lines — they confuse the Mermaid parser when LLMs embed explanations. */
export function stripMermaidComments(body: string): string {
  if (!body?.trim()) return body ?? "";
  return body
    .split("\n")
    .filter((line) => {
      const t = line.trim();
      // Preserve empty lines for diagram spacing; strip only actual %% comment lines
      return !t.startsWith("%%");
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
export function normalizeErCardinalityNotation(body: string): string {
  if (!/^erDiagram\b/im.test(body.trim())) return body;
  return body.replace(
    /^(\s*\w+\s+)([\|\}][\|\}o*]\s*--\s*[\|\}o*][\|\{o*])(\s+\w+)/gm,
    (_match: string, prefix: string, rel: string, suffix: string) => {
      // Skip lines that are entity definitions (contain { or } braces for attributes)
      if (/[{}]/.test(prefix) || /[{}]/.test(suffix)) return _match;
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
  for (let i = 0; i < lines.length; i++) {
    if (MERMAID_DIAGRAM_HEADER_LINE.test(lines[i]!.trim())) {
      return lines.slice(i).join("\n").trim();
    }
  }
  return trimmed;
}

export function normalizeMermaidDiagramBody(raw: string): string {
  let stripped = stripMermaidFenceWrappers(raw);
  // Strip %% comment lines early — they confuse downstream repairs
  stripped = stripMermaidComments(stripped);
  stripped = stripped.replace(/\bpar\s+ticipant\b/gi, "participant");
  // Strip markdown headings/prose colados por el LLM ANTES del tipo de diagrama.
  // Típico: ```mermaid\n### Flujo: integración de...\nflowchart TD\n```
  stripped = stripLeadingMarkdownPrologueFromMermaid(stripped);
  stripped = normalizeGraphKeywordToFlowchart(stripped);
  stripped = ensureSequenceDiagramHeader(stripped);
  if (/^erDiagram\b/im.test(stripped.trim())) {
    stripped = repairErDiagramBrdMarkdownLeaks(stripped);
  }
  stripped = stripMarkdownLeakFromMermaidDiagramBody(stripped);
  if (!stripped?.trim()) return "";
  stripped = dedupeMermaidDiagramHeader(stripped);
  stripped = repairErDiagramPkFkCommas(stripped);
  stripped = ensureErDiagramHeader(stripped);
  const isErDiagram = /^erDiagram\b/i.test(stripped.trim());
  const isSequence =
    /^sequenceDiagram\b/im.test(stripped.trim()) || /^(participant|actor)\s/im.test(stripped.trim());
  const isFlowchart =
    /^flowchart\b/im.test(stripped.trim()) ||
    /^graph\s+(?:TD|TB|LR|RL|BT)\b/im.test(stripped.trim());
  const isClassDiagram = /^classDiagram\b/im.test(stripped.trim());
  const isStateDiagram = /^stateDiagram(?:-v2)?\b/im.test(stripped.trim());
  if (isErDiagram) {
    stripped = splitErDiagramEntityBlocksOnSameLine(stripped);
    stripped = stripErDiagramSqlDefaultArtifacts(stripped);
    stripped = normalizeErDiagramPgTypes(stripped);
    stripped = repairErDiagramDuplicateAttributeTypes(stripped);
    stripped = normalizeErCardinalityNotation(stripped);
  }
  if (isSequence) {
    stripped = normalizeSequenceDiagramSyntax(stripped);
    stripped = repairSequenceArrowParties(stripped);
    stripped = normalizeSequenceActivation(stripped);
    stripped = normalizeSequenceActivationOrder(stripped);
  }

  const lines = stripped.trim().split("\n");
  const out: string[] = [];

  // Separate counters per diagram type — never conflate flowchart subgraph ends
  // with sequence alt/opt/loop ends or classDiagram { } blocks.
  let flowchartSubgraphDepth = 0;
  let sequenceBlockDepth = 0;

  for (let i = 0; i < lines.length; i++) {
    let line = lines[i]!;
    const trimmed = line.trim();

    if (
      MERMAID_LEAKED_LIST_PREFIX_RE.test(trimmed) &&
      (isOrphanSequenceDiagramLine(trimmed) ||
        isOrphanFlowchartLine(trimmed) ||
        isOrphanErDiagramLine(trimmed) ||
        isOrphanStateDiagramLine(trimmed))
    ) {
      line = normalizeOrphanSequenceDiagramLine(line);
    }

    // Auto-repair subgraph corruption: `subgraph_ID["…"]` → `subgraph ID["…"]`
    line = line.replace(/^(\s*)subgraph_(\w+)(?=\s*["[(])/i, "$1subgraph $2");

    // Also fix `subgraph_` without a following bracket (corrupted label)
    line = line.replace(/^(\s*)subgraph_(\w+)\s*$/i, "$1subgraph $2");

    if (/^(graph|flowchart)\s/i.test(trimmed)) {
      out.push(line);
      continue;
    }

    // ── Flowchart subgraph tracking ──────────────────────────────────
    if (isFlowchart && /^\s*subgraph\s/.test(trimmed)) flowchartSubgraphDepth++;

    // ── Sequence block tracking (alt/opt/loop/par/critical/break) ────
    if (isSequence && isSequenceCompositeBlockOpenLine(trimmed)) sequenceBlockDepth++;
    if (isSequence && /^\s*else\b/.test(trimmed)) { /* else is part of alt — don't count */ }
    if (isSequence && /^\s*end\s*$/.test(trimmed)) {
      if (sequenceBlockDepth === 0) continue;
      sequenceBlockDepth = Math.max(0, sequenceBlockDepth - 1);
      out.push(line);
      continue;
    }
    if (isFlowchart && /^\s*end\s*$/.test(trimmed)) {
      if (flowchartSubgraphDepth === 0) continue;
      flowchartSubgraphDepth = Math.max(0, flowchartSubgraphDepth - 1);
      out.push(line);
      continue;
    }

    // ── classDiagram: fix unclosed `{` blocks ────────────────────────
    if (isClassDiagram) {
      // Fix common classDiagram issues: lowercase keywords
      line = line.replace(/^\s*(Class)\s+/i, "  ");
      // Ensure `<<stereotypes>>` are on their own line after class name
      const stereotypeMatch = trimmed.match(/^(\w[\w]*)\s+<<(.+)>>\s*$/);
      if (stereotypeMatch) {
        out.push(`  ${stereotypeMatch[1]}`);
        out.push(`  <<${stereotypeMatch[2]}>>`);
        continue;
      }
    }

    // ── stateDiagram: normalize keywords ─────────────────────────────
    if (isStateDiagram) {
      // stateDiagram-v2 uses `state` keyword for composite states
      line = line.replace(/^(\s*)note\s+(left|right|top|bottom)\s+of\s+/i, (_m, indent: string, dir: string) => `${indent}note ${dir} of `);
      // Normalize direction
      line = line.replace(/^(\s*)direction\s+(LR|TD|BT|RL)\b/i, (_m, indent: string, dir: string) => `${indent}direction ${dir}`);
    }

    // ── Node IDs with spaces → underscore (flowchart only) ───────────
    if (
      isFlowchart &&
      !/^\s*(subgraph|state|class|namespace|direction)\b/i.test(line)
    ) {
      line = replaceOutsideDoubleQuotes(line, /(\w+)\s+(\w+)(\[|\()/g, (_match, p1, p2, p3) => {
        return `${cleanId(p1)}_${cleanId(p2)}${p3}`;
      });
    }

    // Replace literal `\n` with space (Mermaid uses `<br/>` for line breaks)
    line = line.replace(/\\n/g, " ");
    // Normaliza `<br>` / `<br >` suelto (SVG inválido) → `<br/>`; no toca `<br/>`.
    line = line.replace(/<br\s*>/gi, "<br/>");

    if (isFlowchart || (!isErDiagram && !isSequence && !isClassDiagram && !isStateDiagram)) {
      // Quote node labels with special chars / <br/>: `A[x<br/>y: z]` → `A["x<br/>y: z"]`
      line = line.replace(
        /(\[|\()(?!["(])([^"\]\)]*(?:[{}:?<]|<br\s*\/?>)[^"\]\)]*)(\]|\))/g,
        (_m, open: string, label: string, close: string) => `${open}"${label.trim()}"${close}`,
      );
      // Diamond decisions: `E{Token?<br/>x < y}` → `E{"Token?<br/>x < y"}`
      line = line.replace(
        /(\{)(?!")([^{}"]*(?:[?:<]|<br\s*\/?>)[^{}"]*)(\})/g,
        (_m, open: string, label: string, close: string) => `${open}"${label.trim()}"${close}`,
      );
      // Quote edge labels with braces / specials: `|/{id}|` → `|"/{id}"|`
      line = line.replace(
        /\|(?!")([^"|]*(?:[{}:?<]|<br\s*\/?>)[^"|]*)\|/g,
        (_m, label: string) => `|"${label.trim()}"|`,
      );
    }

    // Clean markdown `**` inside quoted labels; compact whitespace
    line = line.replace(/"([^"]*)"/g, (_m, label: string) => {
      const cleaned = label.replace(/\*\*/g, "").replace(/\s+/g, " ").trim().slice(0, MAX_MERMAID_LABEL_CHARS);
      return `"${cleaned}"`;
    });

    // ── Sequence diagram: apply per-line repairs ─────────────────────
    if (isSequence) {
      const repaired = repairSequenceDiagramLine(line);
      for (const seqLine of repaired) out.push(seqLine);
      continue;
    }

    out.push(line);
  }

  // Auto-close unclosed blocks (only for the active diagram type)
  const unclosedFlowchart = isFlowchart ? flowchartSubgraphDepth : 0;
  const unclosedSequence = isSequence ? sequenceBlockDepth : 0;
  for (let i = 0; i < unclosedFlowchart; i++) out.push("  end");
  for (let i = 0; i < unclosedSequence; i++) out.push("  end");

  let result = out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  if (isFlowchart) {
    result = stripFlowchartTrailingTextGarbage(result);
    result = splitFlowchartMultiEdgeLines(result);
    result = repairFlowchartMissingTargetNodeIds(result);
    result = sanitizeFlowchartNodeIds(result);
    result = quoteFlowchartLabelsWithParens(result);
    result = quoteFlowchartSpacedLabels(result);
    result = quoteFlowchartEdgeLabels(result);
    result = quoteFlowchartChineseLabels(result);
    result = guardFlowchartSelfEdges(result);
  }
  if (isClassDiagram) {
    result = normalizeClassDiagramVisibility(result);
  }
  return result;
}

/** Diagrama lineal s0→s1→s2 al volcar JSON del webhook (no es un flujo legible). */
export function looksLikeJsonFlattenFlowchart(body: string): boolean {
  const t = body.trim();
  if (!/^flowchart\s+TD/i.test(t)) return false;
  const lines = t.split("\n").map((l) => l.trim()).filter(Boolean);
  const slugNodes = lines.filter((l) => /^s\d+\s*\(/.test(l)).length;
  if (slugNodes >= 8) return true;
  const emptySlug = lines.some((l) => /^s\d+\s*\(\s*["']?\s*["']?\s*\)/.test(l));
  const jsonFieldHits = (
    t.match(
      /\b(?:event|timestamp|tenant_id|estado_id|audiencia|geolocalizacion|siglas|nombre|data|status|entity|action)\s*—/gi,
    ) ?? []
  ).length;
  const fieldCommaLabels = lines.filter((l) =>
    /^s\d+\([^)]*—[^)]*,\s*["']?\)/.test(l),
  ).length;
  if (emptySlug && slugNodes >= 3 && jsonFieldHits >= 1) return true;
  if (slugNodes >= 3 && jsonFieldHits >= 2) return true;
  if (slugNodes >= 2 && fieldCommaLabels >= 2) return true;
  return false;
}

export function webhookSyncFlowchartBody(): string {
  return `flowchart TD
  evt["Evento en sistema origen"]
  recv["Recibir evento"]
  val["Validar payload e identificador de tenant"]
  upsert["Persistir o actualizar registro espejo"]
  rsp["Confirmar recepción al emisor"]
  evt --> recv
  recv --> val
  val --> upsert
  upsert --> rsp`;
}

export function repairFlattenedWebhookFlowchart(body: string): string | null {
  if (!looksLikeJsonFlattenFlowchart(body)) return null;
  return webhookSyncFlowchartBody();
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
    const body =
      repairFlattenedWebhookFlowchart(rawDiagram) ?? normalizeMermaidDiagramBody(rawDiagram);
    if (!body) return trailing ? `${trailing}\n` : "```mermaid\n```";
    // Si tras normalizar el body no contiene ningún tipo de diagrama Mermaid válido,
    // el LLM metió prosa/headings dentro del fence. Lo convertimos a markdown regular.
    if (!looksLikeMermaidDiagramBody(body)) {
      const asProse = body.replace(/^```mermaid\s*\n?/i, "").replace(/\n?```\s*$/i, "").trim();
      return trailing ? `${asProse}\n\n${trailing}` : asProse;
    }
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
/**
 * Enforce LIFO (last-in, first-out) ordering of activate/deactivate
 * statements in a sequence diagram.  If activate B appears between
 * activate A and deactivate A, the function reorders so that B is
 * deactivated before A, which is the only valid nesting for Mermaid.
 *
 * This is a DIFFERENT concern from `normalizeSequenceActivation` (which
 * pairs orphaned activate/deactivate).  This function keeps all existing
 * statements but reorders them to satisfy LIFO nesting.
 */
export function normalizeSequenceActivationOrder(content: string): string {
  if (!/^sequenceDiagram\b/im.test(content.trim())) return content;
  const lines = content.split("\n");
  const out: string[] = [];
  // Each entry: { actor, activateLine, deactivateLine? }
  const pending: Array<{ actor: string; activateLine: string; deactivateLine?: string }> = [];

  for (const line of lines) {
    const trimmed = line.trim();
    const actMatch = trimmed.match(/^activate\s+(\S+)/i);
    const deactMatch = trimmed.match(/^deactivate\s+(\S+)/i);

    if (actMatch) {
      const actor = actMatch[1]!;
      // Check if this actor is already activated — skip duplicate
      if (pending.some((p) => p.actor === actor)) continue;
      pending.push({ actor, activateLine: line });
    } else if (deactMatch) {
      const actor = deactMatch[1]!;
      const idx = pending.findIndex((p) => p.actor === actor);
      if (idx === -1) continue; // orphan deactivate — drop
      // For LIFO: the most recently activated should deactivate first.
      // If actor is not last in pending, we still emit it (Mermaid handles nesting).
      pending[idx]!.deactivateLine = line;
    } else {
      out.push(line);
    }
  }

  // Emit activate/deactivate pairs in LIFO order (reverse of pending)
  // First emit activations in order, then deactivate in reverse
  for (const p of pending) {
    out.push(p.activateLine);
  }
  for (let i = pending.length - 1; i >= 0; i--) {
    const p = pending[i]!;
    if (p.deactivateLine) {
      out.push(p.deactivateLine);
    } else {
      out.push(`deactivate ${p.actor}`);
    }
  }

  return out.join("\n");
}

// ─── Sequence arrow repair ──────────────────────────────────────────────
/**
 * Fix malformed arrow syntax in sequence diagrams.
 * Common LLM errors:
 *   - Wrong arrow type: `A --> B`  → `A->>B` (solid, open-arrow is default)
 *   - Spaces inside arrow: `A ->> B` → `A->>B`
 *   - Arrow to undeclared participant: silently dropped or participant auto-added
 *
 * Normalises arrow spacing (no spaces around arrow token) and maps
 * legacy `-->` (dashed) to the correct `->>` (solid) for non-response arrows.
 */
export function repairSequenceArrowParties(content: string): string {
  if (!/^sequenceDiagram\b/im.test(content.trim())) return content;

  const participants = new Set<string>();
  for (const m of content.matchAll(/^\s*(?:participant|actor)\s+(\S+)/gim)) {
    participants.add(m[1]!.replace(/:$/, ""));
  }

  const sequenceArrowLine =
    /^(\s*)(\w+)\s+(-{1,2}[>xX]{0,2}>?)\s+(\w+)\s*:\s*(.*)$/;

  let result = content.replace(
    sequenceArrowLine,
    (_m: string, indent: string, from: string, arrow: string, to: string, msg: string) => {
      const normArrow = arrow === "-->" || arrow === "--" ? "->>" : arrow.replace(/\s+/g, "");
      return `${indent}${from}${normArrow}${to}: ${msg}`;
    },
  );

  const usedParticipants = new Set<string>();
  for (const line of result.split("\n")) {
    const m = line.trim().match(/^(\w+)\s*(->>|-->>|-->|->)\s*(\w+)\s*:/);
    if (m) {
      usedParticipants.add(m[1]!);
      usedParticipants.add(m[3]!);
    }
  }

  const missing = [...usedParticipants].filter(
    (p) =>
      !participants.has(p) &&
      !/^(Note|participant|activate|deactivate|alt|else|end|opt|loop|break|par|rect|critical|sequenceDiagram)$/i.test(
        p,
      ),
  );
  if (missing.length > 0) {
    const lines = result.split("\n");
    const insertIdx = lines.findIndex((l) => /^\s*sequenceDiagram\b/i.test(l.trim()));
    const decls = missing.map((p) => `    participant ${p}`);
    lines.splice(insertIdx + 1, 0, ...decls);
    result = lines.join("\n");
  }

  return result;
}

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
