import type { StoredTasksJsonV2 } from "./hydrate-tasks-from-ariadne-pack.util.js";

export type ParseAriadneCursorTasksMarkdownResult =
  | { ok: true; payload: StoredTasksJsonV2 }
  | { ok: false; errors: string[] };

function trimLines(md: string): string[] {
  return md.replace(/\r\n/g, "\n").split("\n");
}

function parseScalarValue(raw: string): unknown {
  const v = raw.trim();
  if (v === "true") return true;
  if (v === "false") return false;
  if (/^-?\d+$/.test(v)) return Number(v);
  if (
    (v.startsWith('"') && v.endsWith('"')) ||
    (v.startsWith("'") && v.endsWith("'"))
  ) {
    return v.slice(1, -1);
  }
  return v;
}

/** Minimal YAML parser for Ariadne task front-matter blocks. */
function parseSimpleYaml(yaml: string): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const lines = yaml.split("\n");
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    const keyMatch = line.match(/^([a-zA-Z0-9_.-]+):\s*(.*)$/);
    if (!keyMatch) {
      i++;
      continue;
    }
    const key = keyMatch[1]!;
    const rest = keyMatch[2] ?? "";
    if (rest.trim() === "" || rest.trim() === "|" || rest.trim() === ">") {
      const nested: unknown[] = [];
      const nestedObj: Record<string, unknown> = {};
      let j = i + 1;
      let isArray = false;
      let isNestedObj = false;
      while (j < lines.length) {
        const nl = lines[j]!;
        if (/^\S/.test(nl) && nl.trim()) break;
        const arrMatch = nl.match(/^\s+-\s+(.*)$/);
        if (arrMatch) {
          isArray = true;
          nested.push(parseScalarValue(arrMatch[1] ?? ""));
          j++;
          continue;
        }
        const objMatch = nl.match(/^\s+([a-zA-Z0-9_.-]+):\s*(.*)$/);
        if (objMatch) {
          isNestedObj = true;
          nestedObj[objMatch[1]!] = parseScalarValue(objMatch[2] ?? "");
          j++;
          continue;
        }
        if (!nl.trim()) {
          j++;
          continue;
        }
        break;
      }
      if (isArray) out[key] = nested;
      else if (isNestedObj) out[key] = nestedObj;
      i = j;
      continue;
    }
    out[key] = parseScalarValue(rest);
    i++;
  }
  return out;
}

function readStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String).filter(Boolean);
  if (typeof value === "string" && value.trim()) return [value.trim()];
  return [];
}

function extractScopeInclude(fm: Record<string, unknown>): string[] {
  const scope = fm.scope;
  if (scope && typeof scope === "object") {
    const include = (scope as Record<string, unknown>).include;
    return readStringArray(include);
  }
  return readStringArray(fm.scope_include ?? fm.scopeInclude);
}

function extractDependsOn(fm: Record<string, unknown>): string[] {
  return readStringArray(fm.depends_on ?? fm.dependsOn ?? fm.dependencies);
}

function extractFiles(fm: Record<string, unknown>, scopeInclude: string[]): string[] {
  const direct = readStringArray(fm.files ?? fm.target_files ?? fm.targetFiles);
  if (direct.length) return direct;
  if (scopeInclude.length) return scopeInclude;
  return [];
}

function derivePhaseFromHeading(heading: string | null, section: string): string {
  if (heading) {
    const m = heading.match(/Fase\s+(\d+(?:\.\d+)?)/i);
    if (m) return m[1]!;
  }
  const sectionNorm = section.trim();
  if (/backend/i.test(sectionNorm)) return "backend";
  if (/frontend/i.test(sectionNorm)) return "frontend";
  return sectionNorm || "Integration";
}

/**
 * Parses Ariadne `# Tasks` markdown (YAML blocks + section headings) into tasksJson v2.
 * @see Ariadne cursor-tasks-document.util.ts buildTaskBlock
 */
export function parseAriadneCursorTasksMarkdown(
  markdown: string,
  meta?: {
    projectId?: string;
    changeDescription?: string;
    ariadneChangeId?: string;
    generatedAt?: string;
  },
): ParseAriadneCursorTasksMarkdownResult {
  const errors: string[] = [];
  const lines = trimLines(markdown);
  let currentSection = "Integration";
  let currentPhaseHeading: string | null = null;
  const tasks: Array<Record<string, unknown>> = [];
  const allFiles = new Set<string>();

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;

    const phaseMatch = line.match(/^###\s+(.+)$/);
    if (phaseMatch) {
      currentPhaseHeading = phaseMatch[1]!.trim();
      continue;
    }

    const sectionMatch = line.match(/^##\s+(.+)$/);
    if (sectionMatch) {
      currentSection = sectionMatch[1]!.trim();
      continue;
    }

    if (line.trim() !== "---") continue;

    const yamlLines: string[] = [];
    let j = i + 1;
    while (j < lines.length && lines[j]!.trim() !== "---") {
      yamlLines.push(lines[j]!);
      j++;
    }
    if (j >= lines.length) {
      errors.push(`Unclosed YAML block at line ${i + 1}`);
      break;
    }

    let fm: Record<string, unknown>;
    try {
      fm = parseSimpleYaml(yamlLines.join("\n"));
    } catch (e) {
      errors.push(`Invalid YAML at line ${i + 1}: ${e instanceof Error ? e.message : String(e)}`);
      i = j;
      continue;
    }

    const id = String(fm.id ?? "").trim();
    const title = String(fm.title ?? "").trim();
    const scopeInclude = extractScopeInclude(fm);
    const files = extractFiles(fm, scopeInclude);
    const dependsOn = extractDependsOn(fm);

    if (!id) errors.push(`Task at line ${i + 1} missing id`);
    if (!title) errors.push(`Task at line ${i + 1} missing title`);
    if (!files.length) errors.push(`Task ${id || "?"} missing files/scope.include`);

    if (id && title && files.length) {
      const phase = String(fm.phase ?? fm.section ?? "").trim() ||
        derivePhaseFromHeading(currentPhaseHeading, currentSection);
      for (const f of files) allFiles.add(f);
      tasks.push({
        id,
        title,
        description: String(fm.criterion ?? fm.description ?? "").trim(),
        status: String(fm.status ?? "pending"),
        targetFiles: files,
        files,
        symbols: readStringArray(fm.symbols),
        phase,
        criterion: typeof fm.criterion === "string" ? fm.criterion : undefined,
        section: String(fm.section ?? currentSection),
        checkpoint: "Handoff",
        changeType: String(fm.change_type ?? fm.changeType ?? "modify"),
        scopeInclude,
        scopeExclude: extractScopeInclude({ scope: { include: fm.scope_exclude } }),
        dependencies: dependsOn,
        dependsOn,
        parallel: fm.parallel === true,
        requirements: readStringArray(fm.requirements),
        constraints: readStringArray(fm.constraints),
        doneWhen: readStringArray(fm.done_when ?? fm.doneWhen),
        evidence: Array.isArray(fm.evidence) ? fm.evidence : [],
        source: "ariadne_cursor_tasks_markdown",
        inferenceRules: [],
        verification: {},
      });
    }

    i = j;
  }

  if (!tasks.length) {
    return { ok: false, errors: errors.length ? errors : ["no tasks parsed from markdown"] };
  }

  return {
    ok: true,
    payload: {
      version: "2.0",
      schemaVersion: "2",
      source: "ariadne",
      projectId: meta?.projectId,
      changeDescription: meta?.changeDescription,
      ariadneChangeId: meta?.ariadneChangeId,
      promotionScope: "integration_handoff",
      generatedAt: meta?.generatedAt,
      files: [...allFiles].map((path) => ({ path })),
      tasks,
    },
  };
}
