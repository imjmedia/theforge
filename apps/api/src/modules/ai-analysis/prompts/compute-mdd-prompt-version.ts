import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const PROMPTS_DIR = join(__dirname, ".");
/** En build Nest: assets en dist/modules/ai-analysis/prompts (8 niveles hasta dist). */
const PROMPTS_DIR_DIST = join(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "..",
  "..",
  "..",
  "..",
  "modules",
  "ai-analysis",
  "prompts",
);

const PROMPT_SUBDIRS = ["mdd", "benchmark"] as const;

function resolvePromptsRoot(): string {
  if (existsSync(join(PROMPTS_DIR, "mdd"))) return PROMPTS_DIR;
  if (existsSync(join(PROMPTS_DIR_DIST, "mdd"))) return PROMPTS_DIR_DIST;
  return PROMPTS_DIR;
}

/** Rutas relativas `mdd/foo.md` y `benchmark/bar.md`, ordenadas lexicográficamente. */
function listMddPromptMarkdownRelPaths(): string[] {
  const root = resolvePromptsRoot();
  const relPaths: string[] = [];
  for (const sub of PROMPT_SUBDIRS) {
    const dir = join(root, sub);
    if (!existsSync(dir)) continue;
    for (const name of readdirSync(dir).filter((f) => f.endsWith(".md")).sort()) {
      relPaths.push(`${sub}/${name}`);
    }
  }
  return relPaths.sort();
}

/**
 * SHA-256 hex del contenido de `prompts/mdd/*.md` y `prompts/benchmark/*.md`
 * (paths relativos ordenados + contenido UTF-8).
 */
export function computeMddPromptVersion(): string {
  const root = resolvePromptsRoot();
  const hash = createHash("sha256");
  for (const rel of listMddPromptMarkdownRelPaths()) {
    hash.update(rel);
    hash.update("\0");
    hash.update(readFileSync(join(root, rel), "utf8"));
    hash.update("\0");
  }
  return hash.digest("hex");
}

/** Calculado al cargar el módulo; cambia automáticamente al editar cualquier prompt MDD/benchmark. */
export const MDD_PROMPT_VERSION = computeMddPromptVersion();
