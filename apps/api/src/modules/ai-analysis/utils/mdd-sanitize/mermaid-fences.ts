import { findBalancedBraceRespectingStrings } from "./brace.util.js";

/** Exportado para reparar SQL/mermaid pegados en §3. */
export function fixSection2UnclosedSqlAndGluedMermaid(draft: string): string {
  const modeloHeading = "## 3. Modelo de Datos";
  const modeloIdx = draft.indexOf(modeloHeading);
  if (modeloIdx === -1) return draft;
  const sectionStart = modeloIdx + modeloHeading.length;
  const rest = draft.slice(sectionStart);
  const nextH2 = rest.search(/\n##\s+/);
  const body = nextH2 !== -1 ? rest.slice(0, nextH2) : rest;
  let newBody = body
    .replace(/\);\s*###\s*Diagrama entidad-relaciónmermaid/gi, ");\n```\n\n### Diagrama entidad-relación\n\n```mermaid")
    .replace(/\);\s*###\s*Diagrama\b/gi, ");\n```\n\n### Diagrama")
    .replace(/\);\s*```mermaid/gi, ");\n```\n\n```mermaid")
    .replace(/###\s*Diagrama entidad-relaciónmermaid/gi, "### Diagrama entidad-relación\n\n```mermaid");
  if (newBody === body) return draft;
  const afterSection = nextH2 !== -1 ? rest.slice(nextH2) : "";
  return draft.slice(0, sectionStart) + newBody + afterSection;
}

export function stripMermaidFences(content: string): string {
  if (!content || typeof content !== "string") return "";
  let s = content.trim();
  // Quitar uno o más ```mermaid (o ```) al inicio
  s = s.replace(/^(\s*```(?:mermaid)?\s*)+/i, "").trim();
  // Quitar uno o más ``` al final
  s = s.replace(/(\s*```\s*)+$/g, "").trim();
  return s;
}

function stripJsonFromMermaidBlocks(body: string): string {
  return body.replace(/```mermaid\s*([\s\S]*?)```/gi, (_match, inner) => {
    const t = inner.trim();
    if (!t || /^erDiagram\b/i.test(t)) return _match;
    if (t.startsWith("##") || t.startsWith("{") || /"sqlPostgreSQL"\s*:/i.test(t)) {
      try {
        const firstBrace = t.indexOf("{");
        if (firstBrace !== -1) {
          const braceEnd = findBalancedBraceRespectingStrings(t, firstBrace);
          if (braceEnd !== -1) {
            const obj = JSON.parse(t.slice(firstBrace, braceEnd + 1)) as Record<string, unknown>;
            // erDiagram como string (clave "erDiagram") o diagramaER como array
            const erStr = (obj.erDiagram ?? obj.diagramaER ?? obj.diagrama_er) as string | string[] | undefined;
            if (typeof erStr === "string" && erStr.trim().length > 0 && /erDiagram|{\s*string\s+id/i.test(erStr)) {
              return "```mermaid\n" + erStr.trim() + "\n```";
            }
            const diagramaArr = erStr as string[] | undefined;
            if (Array.isArray(diagramaArr) && diagramaArr.length > 0) {
              const joined = diagramaArr.map((s) => (typeof s === "string" ? s : String(s)).trim()).filter(Boolean).join("\n");
              if (/erDiagram|{\s*string\s+id/i.test(joined)) return "```mermaid\n" + joined + "\n```";
            }
          }
        }
      } catch {
        // fall through to placeholder
      }
      return "```mermaid\nerDiagram\n  \n```";
    }
    return _match;
  });
}

/**
 * Dentro de bloques ```mermaid con erDiagram: relaciones : "id" con el nombre de FK correcto.
 * Anotaciones PK/FK: varias claves de un atributo van separadas por coma (`PK, FK`); ver repairErDiagramPkFkCommas.
 */
function sanitizeErDiagramInMermaidBlocks(body: string): string {
  return body.replace(/```mermaid\s*([\s\S]*?)```/gi, (_match, inner) => {
    let content = inner.trim();
    if (!/erDiagram/i.test(content)) return _match;
    // Relaciones: etiquetar con la columna FK real (user_id, application_id, role_id)
    content = content.replace(
      /(users\s*\|\|--o\{\s*sessions\s*:\s*)"id"/gi,
      '$1"user_id"'
    );
    content = content.replace(
      /(applications\s*\|\|--o\{\s*roles\s*:\s*)"id"/gi,
      '$1"application_id"'
    );
    content = content.replace(
      /(users\s*\|\|--o\{\s*user_application_roles\s*:\s*)"id"/gi,
      '$1"user_id"'
    );
    content = content.replace(
      /(roles\s*\|\|--o\{\s*user_application_roles\s*:\s*)"id"/gi,
      '$1"role_id"'
    );
    content = content.replace(/(\|\|--o\{\s*sessions\s*:\s*)"id"/gi, '$1"user_id"');
    content = content.replace(/(\|\|--o\{\s*roles\s*:\s*)"id"/gi, '$1"application_id"');
    return "```mermaid\n" + content + "\n```";
  });
}

/**
 * En la sección 3: deja solo la primera ### Diagrama, primer ```mermaid y primer ```TechnicalMetadata.
 * Colapsa bloques TechnicalMetadata duplicados consecutivos y trunca tras el primero.
 */
function deduplicateSection3DiagramAndMetadata(body: string): string {
  let out = body.replace(
    /(```TechnicalMetadata\s*[\s\S]*?```)\s*(?:\s*```TechnicalMetadata\s*[\s\S]*?```\s*)+/gi,
    "$1\n\n"
  );
  const techMetaRe = /```TechnicalMetadata\s*[\s\S]*?```/gi;
  const firstTech = techMetaRe.exec(out);
  if (!firstTech) return out;
  const cutEnd = firstTech.index + firstTech[0].length;
  const rest = out.slice(cutEnd).replace(/^\s*\n+/, "").trim();
  if (!rest) return out;
  if (/```TechnicalMetadata|###\s*Diagrama\s+entidad-relación|```mermaid/i.test(rest)) {
    return out.slice(0, cutEnd).trim();
  }
  return out;
}

/**
 * Corrige doble fence en bloques Mermaid: ```mermaid\n```mermaid → ```mermaid; ```\n``` → ```.
 * Evita "Syntax error in text" en Mermaid cuando el LLM o el pipeline generó apertura/cierre duplicados.
 */
export function fixDoubleMermaidFences(draft: string): string {
  if (!draft || typeof draft !== "string") return draft;
  let out = draft;
  // Doble apertura: ```mermaid seguido de ```mermaid en la siguiente línea
  out = out.replace(/```mermaid\s*\n+\s*```mermaid/gi, "```mermaid");
  // Doble cierre: ```\n``` al final de un bloque (deja solo un ```)
  out = out.replace(/\n```\s*\n+\s*```\s*(\n|$)/g, "\n```$1");
  return out;
}

/**
 * Dentro de cada bloque ```mermaid...``` reemplaza literales \n (backslash-n) por newline real.
 * El LLM a veces devuelve diagramaEr con \\n en el string; así Mermaid puede parsear el diagrama.
 */
export function unescapeMermaidLiteralNewlines(draft: string): string {
  if (!draft || typeof draft !== "string") return draft;
  return draft.replace(/```mermaid\s*([\s\S]*?)```/gi, (_match, inner) => {
    const unescaped = inner.replace(/\\n/g, "\n").replace(/\\r/g, "\r").replace(/\\t/g, "\t");
    return "```mermaid\n" + unescaped + "\n```";
  });
}

/** Repara bloques mermaid/erDiagram dentro del cuerpo de §3. */
export function repairMermaidBlocksInSectionBody(body: string): string {
  return deduplicateSection3DiagramAndMetadata(
    sanitizeErDiagramInMermaidBlocks(stripJsonFromMermaidBlocks(body)),
  );
}
