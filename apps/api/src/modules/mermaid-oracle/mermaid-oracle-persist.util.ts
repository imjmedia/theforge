import {
  resolveMermaidBlocksInDocument,
  type MermaidParser,
} from "@theforge/shared-types/mermaid-oracle";
import type { MermaidRuntimeService } from "./mermaid-runtime.service.js";
import {
  prepareMddMarkdownForPersist,
} from "../ai-analysis/utils/mdd-sanitize/persist-pipeline.js";

/**
 * Persist con oráculo: formatea preservando fences mermaid y solo repara lo que el parser rechaza.
 */
export async function storeMddMarkdownForPersistWithOracle(
  mddMarkdown: string,
  runtime: MermaidRuntimeService,
): Promise<string> {
  const sync = prepareMddMarkdownForPersist(mddMarkdown, { preserveMermaid: true });
  return applyRuntimeMermaidOracle(sync, runtime.createParser());
}

export async function applyRuntimeMermaidOracle(
  markdown: string,
  parse: MermaidParser,
): Promise<string> {
  const { markdown: resolved } = await resolveMermaidBlocksInDocument(markdown, parse);
  return resolved;
}
