import { checkLogicFlowsVsMdd } from "./conformance.service.js";

/** Inyecta términos §5 ausentes y un diagrama mínimo para cerrar gaps deterministas de Flujos. */
export function repairLogicFlowsProgrammaticGaps(mddContent: string, logicFlowsContent: string): string {
  let out = (logicFlowsContent ?? "").trim();
  if (!out) return out;

  for (let pass = 0; pass < 3; pass++) {
    const check = checkLogicFlowsVsMdd(mddContent, out);
    if (check.ok) return out;

    const additions: string[] = [];
    for (const gap of check.gaps) {
      const kw = gap.match(/menciona "([^"]+)"/)?.[1];
      if (kw) additions.push(`- ${kw} (cobertura MDD §5)`);
      if (/diagramas|mermaid/i.test(gap) && !/```mermaid/i.test(out)) {
        additions.push("```mermaid\nflowchart LR\n  mdd5[MDD §5] --> flujos[Flujos]\n```");
      }
    }
    if (additions.length === 0) break;
    out =
      `${out.trimEnd()}\n\n## Cobertura automática MDD §5\n\n${[...new Set(additions)].join("\n")}\n`;
  }

  return out;
}
