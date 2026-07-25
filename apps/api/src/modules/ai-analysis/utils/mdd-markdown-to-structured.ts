/**
 * @fileoverview Conversión de MDD markdown a schema estructurado.
 */

import type { MddStructured } from "../state/mdd-structured.schema.js";
import {
  mddIntegracionSubsectionSchema,
  mddIntegracionWithManifestSchema,
  mddSeguridadItemSchema,
  mddStructuredSchema,
} from "../state/mdd-structured.schema.js";

/**
 * Extrae el cuerpo de una sección ## heading hasta el siguiente ## o fin.
 */
function getSectionBody(draft: string, headingPattern: RegExp): string | null {
  const match = draft.match(headingPattern);
  if (!match) return null;
  const start = draft.indexOf(match[0]) + match[0].length;
  const rest = draft.slice(start).replace(/^\s*\n+/, "");
  const nextH2 = rest.search(/\n##\s+/);
  return nextH2 !== -1 ? rest.slice(0, nextH2).trim() : rest.trim();
}

function extractSql(body: string): string {
  const m = body.match(/```sql\s*([\s\S]*?)```/i);
  return m?.[1]?.trim() ?? "";
}

function extractMermaid(body: string): string {
  const m = body.match(/```mermaid\s*([\s\S]*?)```/i);
  return m?.[1]?.trim() ?? "";
}

function extractTechnicalMetadata(body: string): string[] {
  const m = body.match(/```TechnicalMetadata\s*([\s\S]*?)```/i);
  if (!m?.[1]) return ["[high_security]"];
  const line = m[1].trim();
  return line ? [line] : ["[high_security]"];
}

/**
 * Convierte markdown del MDD a MddStructured de forma heurística.
 * Útil para checkpoints antiguos que solo tienen mddDraft; el parseo es frágil.
 * Si falla o no hay contenido, devuelve objeto vacío/parcial; el siguiente agente hará merge con {}.
 */
export function markdownToMddStructured(draft: string): MddStructured {
  const trimmed = (draft ?? "").trim();
  if (!trimmed) return mddStructuredSchema.parse({});

  const out: Partial<MddStructured> = {};

  const h1Match = trimmed.match(/^#\s+(.+?)(?:\n|$)/m);
  if (h1Match?.[1]) out.title = h1Match[1].trim();

  const section1 = getSectionBody(
    trimmed,
    /##\s*1\.\s*Contexto(?:\s+y\s+alcance)?|##\s*Contexto(?:\s+y\s+alcance)?/i,
  );
  if (section1) out.contextoAlcance = section1;

  // Section 2: Arquitectura y Stack
  const sectionArquitecturaStack = getSectionBody(
    trimmed,
    /##\s*2\.\s*Arquitectura\s+y\s+Stack|##\s*Arquitectura\s+y\s+Stack|##\s*2\.\s*Arquitectura\s+y\s+stack/i,
  );
  if (sectionArquitecturaStack) out.arquitecturaStack = sectionArquitecturaStack;

  const sectionModeloDatos = getSectionBody(trimmed, /##\s*3\.\s*Modelo\s+(?:de\s+)?datos|##\s*2\.\s*Modelo\s+(?:de\s+)?datos|##\s*Modelo\s+de\s+datos/i);
  if (sectionModeloDatos) {
    const sql = extractSql(sectionModeloDatos);
    const diagramaEr = extractMermaid(sectionModeloDatos);
    const technicalMetadata = extractTechnicalMetadata(sectionModeloDatos);
    if (sql) {
      out.modeloDatos = { sql, diagramaEr: diagramaEr || undefined, technicalMetadata };
    }
  }

  const sectionContratos = getSectionBody(
    trimmed,
    /##\s*(?:4\.\s*)?Contratos\s+de\s+API|##\s*3\.\s*Contratos\s+de\s+API/i,
  );
  if (sectionContratos && sectionContratos.length > 100) {
    const endpoints: Array<{ method: string; path: string; description?: string }> = [];
    const h3Matches = sectionContratos.matchAll(/###\s+(GET|POST|PUT|DELETE|PATCH)\s+(\S+)/gi);
    for (const m of h3Matches) {
      endpoints.push({ method: m[1].toUpperCase(), path: m[2].trim(), description: "" });
    }
    out.contratosApi = {
      summary: sectionContratos.slice(0, 2000),
      endpoints: endpoints.length ? endpoints : undefined,
    };
  }

  const section4 = getSectionBody(trimmed, /##\s*4\.\s*Arquitectura\s+Frontend|##\s*Arquitectura\s+Frontend/i);
  if (section4) out.arquitecturaFrontend = section4;

  // Section 5: Lógica y Edge Cases
  const sectionLogicaEdgeCases = getSectionBody(
    trimmed,
    /##\s*5\.\s*L[oó]gica\s+y\s+Edge\s+Cases|##\s*L[oó]gica\s+y\s+Edge\s+Cases|##\s*5\.\s*L[oó]gica\s+y\s+Casos\s+extremos/i,
  );
  if (sectionLogicaEdgeCases) out.logicaEdgeCases = sectionLogicaEdgeCases;

  const sectionSeg = getSectionBody(trimmed, /##\s*(?:6\.\s+)?Seguridad/i);
  if (sectionSeg) {
    const items: Array<{ title: string; content: string[] }> = [];
    const h3s = sectionSeg.split(/(?=###\s+)/);
    for (const block of h3s) {
      const titleMatch = block.match(/^###\s+(.+?)(?:\n|$)/m);
      const title = titleMatch?.[1]?.trim() ?? "Seguridad";
      const content = block
        .replace(/^###\s+[^\n]+\n?/m, "")
        .split(/\n/)
        .map((l) => l.replace(/^\s*[-*]\s+/, "").trim())
        .filter(Boolean);
      if (title || content.length) items.push(mddSeguridadItemSchema.parse({ title, content: content.length ? content : [block.trim()] }));
    }
    if (items.length === 0) items.push(mddSeguridadItemSchema.parse({ title: "Seguridad", content: [sectionSeg] }));
    out.seguridad = items;
  }

  const sectionInt = getSectionBody(
    trimmed,
    /##\s*(?:7\.\s+)?(?:Infraestructura|Integraci[oó]n)/i,
  );
  if (sectionInt) {
    const subsections: Array<{ title: string; content: string[] }> = [];
    const h3s = sectionInt.split(/(?=###\s+)/);
    for (const block of h3s) {
      const titleMatch = block.match(/^###\s+(.+?)(?:\n|$)/m);
      const title = titleMatch?.[1]?.trim() ?? "Integración";
      const contentArr = block
        .replace(/^###\s+[^\n]+\n?/m, "")
        .split(/\n/)
        .map((l) => l.replace(/^\s*[-*]\s+/, "").trim())
        .filter(Boolean);
      const content = contentArr.length ? contentArr : ["(Pendiente)"];
      if (title) subsections.push(mddIntegracionSubsectionSchema.parse({ title, content }));
    }
    if (subsections.length) out.integracion = mddIntegracionWithManifestSchema.parse({ subsections });
  }

  return mddStructuredSchema.parse(out);
}
