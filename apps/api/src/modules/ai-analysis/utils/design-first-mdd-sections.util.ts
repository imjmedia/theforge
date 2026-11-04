import {
  compilePagEntitiesToSql,
  compilePagToMddSection3,
  compilePagToMddSection4,
  type ProjectArchitectureGraph,
} from "@theforge/shared-types";
import {
  buildErDiagramSectionBlockFromSql,
  injectMddDiagrams,
  regenerateErDiagramFromSql,
  suggestMddDiagrams,
} from "./mdd-diagram-suggestions.js";

/** §3 sellada para MDD pinned: SQL + prosa + erDiagram (opción 14.1a). */
export function sealDesignFirstMddSection3(pag: ProjectArchitectureGraph): string {
  const body = compilePagToMddSection3(pag);
  const sql = compilePagEntitiesToSql(pag);
  const erBlock = buildErDiagramSectionBlockFromSql(sql);
  if (!erBlock) return body.trimEnd();
  return `${body.trimEnd()}${erBlock}`.trimEnd();
}

export function sealDesignFirstMddSection4(pag: ProjectArchitectureGraph): string {
  return compilePagToMddSection4(pag).trimEnd();
}

/** Ensambla un borrador mínimo de MDD con §3 y §4 para harness / injector. */
export function wrapDesignFirstMddSectionsForHarness(section3Body: string, section4Body: string): string {
  return [
    "# MDD Design-First harness",
    "",
    "## 1. Contexto",
    "",
    "Proyecto compilado desde PAG Design-First (fixture three-screens). ".repeat(8),
    "",
    "## 2. Arquitectura y Stack",
    "",
    "NestJS, PostgreSQL y React según el PAG. ".repeat(8),
    "",
    "## 3. Modelo de Datos",
    "",
    section3Body,
    "",
    "## 4. Contratos de API",
    "",
    section4Body,
    "",
  ].join("\n");
}

/** Segunda pasada de `regenerateErDiagramFromSql` es idempotente. */
export function designFirstSealedDraftStableUnderErRegeneration(draft: string): boolean {
  const once = regenerateErDiagramFromSql(draft);
  if (!once) return false;
  const twice = regenerateErDiagramFromSql(once);
  return once === twice;
}

/** Con sugerencias ER, `injectMddDiagrams` no cambia §3 si el erDiagram ya deriva del SQL. */
export function designFirstSection3StableUnderDiagramInjection(draft: string): boolean {
  const suggestions = suggestMddDiagrams(draft);
  const injected = injectMddDiagrams(draft, suggestions);
  const extractS3 = (md: string) =>
    md.match(/##\s*3\.[\s\S]*?(?=##\s*4\.)/i)?.[0]?.replace(/^##[^\n]*\n?/i, "").trimEnd() ?? "";
  return extractS3(draft) === extractS3(injected);
}
