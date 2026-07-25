import type { MDDStateType } from "../state/index.js";
import { mergeMddStructured } from "../utils/mdd-merge-structured.js";
import { injectProposedComponentDiagramIntoSection2 } from "../utils/mdd-component-diagram.util.js";
import {
  injectMddDiagrams,
  regenerateErDiagramFromSql,
  suggestMddDiagrams,
  sqlToErDiagramContent,
  wrapErDiagramAsMermaidFence,
  injectErDiagramBlockIntoDraft,
} from "../utils/mdd-diagram-suggestions.js";
import { getMddDraftSummary, logMddNodeOutput } from "../utils/mdd-sanitize.js";
import { guardTailSectionsForPersist } from "../utils/mdd-section-preserve.util.js";

const LOG = (msg: string, ...args: unknown[]) => console.log(`[MDD:DiagramInjector] ${msg}`, ...args);

function finalizeDiagramInjection(
  originalDraft: string,
  workingDraft: string,
  logLabel: string,
): Partial<MDDStateType> | null {
  const withComponentDiagram = injectProposedComponentDiagramIntoSection2(workingDraft);
  const finalDraft = guardTailSectionsForPersist(originalDraft, withComponentDiagram, "DiagramInjector").markdown;
  if (finalDraft === originalDraft) return null;
  const sum = getMddDraftSummary(finalDraft);
  LOG("%s draftLen=%s section2=%s", logLabel, sum.length, sum.section2);
  logMddNodeOutput("DiagramInjector", finalDraft);
  return { mddDraft: finalDraft };
}

/**
 * Nodo que detecta puntos del MDD donde enriquecer con diagramas Mermaid (ER, estados, flujo).
 * El erDiagram se deriva siempre del SQL (CREATE TABLE): la salida del LLM se pisa en §3.
 */
export function createMddDiagramInjectorNode(): (state: MDDStateType) => Promise<Partial<MDDStateType>> {
  return async (state: MDDStateType): Promise<Partial<MDDStateType>> => {
    const draft = (state.mddDraft ?? "").trim();
    if (!draft || draft.length < 200) {
      LOG("draft vacío o muy corto, sin cambios");
      return {};
    }

    let workingDraft = draft;
    const suggestions = suggestMddDiagrams(workingDraft);
    if (suggestions.length > 0) {
      try {
        workingDraft = injectMddDiagrams(workingDraft, suggestions);
      } catch (err) {
        LOG("error inyectando diagramas desde draft: %s", err instanceof Error ? err.message : String(err));
      }
    }

    try {
      const regenerated = regenerateErDiagramFromSql(workingDraft);
      if (regenerated) workingDraft = regenerated;
    } catch (err) {
      LOG("error regenerando ER desde SQL: %s", err instanceof Error ? err.message : String(err));
    }

    let mergedStructured = state.mddStructured;
    const md = state.mddStructured?.modeloDatos;
    if (md?.sql?.trim() && /CREATE\s+TABLE/i.test(md.sql)) {
      try {
        const diagramaEr = sqlToErDiagramContent(md.sql);
        if (diagramaEr) {
          const mermaidBlock = wrapErDiagramAsMermaidFence(diagramaEr);
          workingDraft = injectErDiagramBlockIntoDraft(workingDraft, mermaidBlock);
          mergedStructured = mergeMddStructured(
            state.mddStructured,
            {
              modeloDatos: { sql: md.sql, diagramaEr, technicalMetadata: md.technicalMetadata },
            },
            state.mddDraft ?? "",
          );
        }
      } catch (err) {
        LOG("error sincronizando diagramaEr desde structured SQL: %s", err instanceof Error ? err.message : String(err));
      }
    }

    const out = finalizeDiagramInjection(draft, workingDraft, "diagramas ER/SQL + componentes propuestos");
    if (out) {
      return mergedStructured !== state.mddStructured ? { ...out, mddStructured: mergedStructured } : out;
    }

    LOG("sin cambios tras inyección de diagramas");
    return {};
  };
}
