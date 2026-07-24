import { tool } from "@langchain/core/tools";
import { z } from "zod";
import {
  isChatLlmPlatformScope,
  THEFORGE_PLATFORM_NOISE_TABLES,
} from "../../engine/mdd-platform-table-strip.util.js";
import { injectMddDiagrams, suggestMddDiagrams } from "../utils/mdd-diagram-suggestions.js";
import { validateMddStructure } from "../utils/mdd-sanitize.js";

/**
 * Tool para Auditor y Redactor: valida la estructura del MDD (sección 4 Contratos con payloads, 7 secciones, TechnicalMetadata).
 * Devuelve JSON con section3HasPayloads, missingSections, hasTechnicalMetadata, sectionOrderCorrect, issues.
 */
export function createValidateMddStructureTool() {
  return tool(
    async ({ mdd_draft }: { mdd_draft: string }) => {
      const result = validateMddStructure(mdd_draft ?? "");
      return JSON.stringify(result, null, 2);
    },
    {
      name: "validate_mdd_structure",
      description:
        "Valida la estructura del MDD: comprueba si la sección 4 (Contratos de API) tiene endpoints con request/response en JSON, si faltan las 7 secciones, si existe TechnicalMetadata y si el orden es correcto. Usa el borrador completo del MDD (mdd_draft). Devuelve JSON con section3HasPayloads, missingSections, hasTechnicalMetadata, sectionOrderCorrect, issues.",
      schema: z.object({
        mdd_draft: z.string().describe("Borrador completo del MDD en markdown a validar."),
      }),
    }
  );
}

/** Normaliza un objeto endpoint del LLM (puede venir en camelCase o snake_case) a forma interna. */
function normalizeEndpoint(raw: Record<string, unknown>): {
  method: string;
  path: string;
  description?: string | null;
  request_body?: Record<string, unknown> | null;
  response_200?: Record<string, unknown> | null;
  response_401?: Record<string, unknown> | null;
} {
  return {
    method: String(raw.method ?? raw.Method ?? "GET").toUpperCase(),
    path: String(raw.path ?? raw.Path ?? ""),
    description: (raw.description ?? raw.Description) != null ? String(raw.description ?? raw.Description) : undefined,
    request_body: (raw.request_body ?? raw.requestBody) != null && typeof (raw.request_body ?? raw.requestBody) === "object" ? (raw.request_body ?? raw.requestBody) as Record<string, unknown> : undefined,
    response_200: (raw.response_200 ?? raw.response200) != null && typeof (raw.response_200 ?? raw.response200) === "object" ? (raw.response_200 ?? raw.response200) as Record<string, unknown> : undefined,
    response_401: (raw.response_401 ?? raw.response401) != null && typeof (raw.response_401 ?? raw.response401) === "object" ? (raw.response_401 ?? raw.response401) as Record<string, unknown> : undefined,
  };
}

/**
 * Tool para Software Architect: genera markdown de la sección 4 (Contratos de API) a partir de dominio y lista de endpoints.
 * Asegura formato con tabla y bloques ```json. Schema permisivo para aceptar camelCase o snake_case del LLM.
 */
export function createFormatSection3EndpointsTool() {
  return tool(
    async ({
      domain,
      endpoints,
    }: {
      domain?: string;
      endpoints: unknown;
    }) => {
      const sectionTitle = (domain ?? "")?.trim() ? `## 4. Contratos de API (${String(domain).trim()})` : "## 4. Contratos de API";
      const list = Array.isArray(endpoints) ? endpoints : endpoints != null && typeof endpoints === "object" && !Array.isArray(endpoints) ? [endpoints] : [];
      const normalized = list
        .filter((e): e is Record<string, unknown> => e != null && typeof e === "object")
        .map(normalizeEndpoint)
        .filter((ep) => ep.path.length > 0);

      const lines: string[] = [
        sectionTitle,
        "",
        "| Método | Ruta | Descripción | Auth |",
        "|--------|------|-------------|------|",
      ];
      for (const ep of normalized) {
        const desc = ep.description ?? "";
        const auth = ep.path.includes("login") || ep.path.includes("register") ? "No" : "Bearer";
        lines.push(`| ${ep.method} | ${ep.path} | ${desc} | ${auth} |`);
      }
      lines.push("", "");

      for (const ep of normalized) {
        lines.push(`### ${ep.method} ${ep.path}`, "");
        if (ep.description) lines.push(ep.description, "");
        if (ep.request_body && Object.keys(ep.request_body).length > 0) {
          lines.push("**Request body:**", "```json", JSON.stringify(ep.request_body, null, 2), "```", "");
        }
        if (ep.response_200) {
          lines.push("**Response 200:**", "```json", JSON.stringify(ep.response_200, null, 2), "```", "");
        }
        if (ep.response_401) {
          lines.push("**Response 401:**", "```json", JSON.stringify(ep.response_401, null, 2), "```", "");
        }
      }
      return lines.join("\n");
    },
    {
      name: "format_section3_endpoints",
      description:
        "Genera el markdown de la sección 4 (Contratos de API) del MDD: tabla de endpoints y para cada uno request/response en bloques ```json. Parámetros: domain (string opcional, ej. SSO); endpoints (array de objetos con method, path, description opcional, request_body/requestBody opcional, response_200/response200 opcional, response_401/response401 opcional).",
      schema: z.object({
        domain: z.string().optional().nullable().describe("Dominio del proyecto, ej. SSO, auth, ecommerce (opcional)"),
        endpoints: z
          .union([
            z.array(z.record(z.unknown())).min(1).max(30),
            z.record(z.unknown()).transform((o) => [o]),
          ])
          .describe("Lista de endpoints (array de objetos con method, path; opcional: description, request_body, response_200, response_401)"),
      }),
    }
  );
}

/**
 * Tool para detectar puntos del MDD donde enriquecer con diagramas Mermaid (ER, estados, flujo).
 * Analiza el borrador y devuelve sugerencias con tipo, razón y bloque Mermaid listo para insertar.
 */
export function createSuggestMddDiagramsTool() {
  return tool(
    async ({ mdd_draft }: { mdd_draft: string }) => {
      const suggestions = suggestMddDiagrams(mdd_draft ?? "");
      const summary = suggestions.map((s) => ({ section: s.section, type: s.type, reason: s.reason }));
      const result = {
        count: suggestions.length,
        suggestions: summary,
        mermaidBlocks: suggestions.map((s) => ({ section: s.section, type: s.type, block: s.mermaidBlock })),
      };
      return JSON.stringify(result, null, 2);
    },
    {
      name: "suggest_mdd_diagrams",
      description:
        "Analiza el MDD y detecta dónde añadir diagramas Mermaid: (1) Sección 2 Modelo de datos → erDiagram si hay CREATE TABLE; (2) Sección 3 Contratos de API → stateDiagram-v2 si hay login/auth; (3) Sección 4 Frontend → flowchart si hay componentes. Devuelve JSON con count, suggestions (section, type, reason) y mermaidBlocks (block listo para insertar).",
      schema: z.object({
        mdd_draft: z.string().describe("Borrador completo del MDD en markdown a analizar."),
      }),
    }
  );
}

/**
 * Aplica las sugerencias de diagramas al draft: inserta los bloques Mermaid en cada sección.
 */
export function applyMddDiagramSuggestions(mddDraft: string): string {
  const suggestions = suggestMddDiagrams(mddDraft);
  return injectMddDiagrams(mddDraft, suggestions);
}

/**
 * Tool para Software Architect: importar tablas SQL de otro proyecto (cross-project table reference).
 * Se inyecta como tool del SA vía getMddArchitectTools() en mdd-graph.ts.
 */
export function createGetProjectTablesTool() {
  const baseUrl = process.env.THEFORGE_API_URL ?? "http://theforge-api:3000";
  return tool(
    async ({ projectId, tableNames }: { projectId: string; tableNames?: string[] }) => {
      const url = `${baseUrl}/projects/${encodeURIComponent(projectId)}`;
      let mddContent = "";
      try {
        const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
        if (res.ok) {
          const data = (await res.json()) as Record<string, unknown>;
          mddContent = (data.mddContent as string ?? "").trim();
        }
      } catch {
        // fallback
      }
      if (!mddContent) {
        return `No se pudo obtener el MDD del proyecto ${projectId} o no tiene contenido.`;
      }
      const section3Match = mddContent.match(/##\s+(?:3\.\s+)?Modelo\s+(?:de\s+)?Datos[^#]*(?:CREATE\s+TABLE[\s\S]*?)(?=\n##\s+(?:4|5|6|7)\.|\n##\s+(?:Seguridad|Infraestructura|Contratos|Lógica)|\z)/i);
      const sqlBlock = section3Match?.[0] ?? "";
      if (!sqlBlock.trim()) {
        return `El proyecto ${projectId} tiene MDD pero no se encontraron tablas SQL en §3.`;
      }
      const tableRegex = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(\w+)\s*\(([\s\S]*?)\);/gi;
      const tables: { name: string; sql: string }[] = [];
      let m: RegExpExecArray | null;
      while ((m = tableRegex.exec(sqlBlock)) !== null) {
        tables.push({ name: m[1]!, sql: m[0]! });
      }
      if (tables.length === 0) {
        return `No se encontraron CREATE TABLE en §3 del proyecto ${projectId}.`;
      }
      let filtered = tables;
      if (Array.isArray(tableNames) && tableNames.length > 0) {
        const filterSet = new Set(tableNames.map((n) => n.toLowerCase()));
        filtered = tables.filter((t) => filterSet.has(t.name.toLowerCase()));
        if (filtered.length === 0) {
          return `El proyecto ${projectId} tiene ${tables.length} tabla(s) (${tables.map((t) => t.name).join(", ")}), pero ninguna coincide con: ${tableNames.join(", ")}.`;
        }
      } else {
        const section1 = mddContent.match(/(?:^|\n)##\s*1\.[\s\S]*?(?=\n##\s|\n#\s|$)/i)?.[0] ?? "";
        const scopeCorpus = `${section1}\n${mddContent.slice(0, 2500)}`;
        if (!isChatLlmPlatformScope(scopeCorpus)) {
          filtered = tables.filter((t) => !THEFORGE_PLATFORM_NOISE_TABLES.has(t.name));
        }
      }
      const header = `Tablas de proyecto de referencia (${projectId}):${filtered.length < tables.length ? ` ${filtered.length}/${tables.length} filtradas` : ` ${tables.length} tabla(s)`}`;
      return `${header}\n\n\`\`\`sql\n${filtered.map(t => t.sql).join("\n\n")}\n\`\`\``;
    },
    {
      name: "get_project_tables",
      description: "Importa definiciones de tablas SQL de otro proyecto en TheForge (cross-project). Útil cuando un proyecto nuevo necesita tablas compartidas de un proyecto existente. Parámetros: projectId (requerido) y opcional tableNames (array de strings) para filtrar solo tablas específicas. El SA debe integrarlas en §3 (Modelo de Datos) del proyecto nuevo.",
      schema: z.object({
        projectId: z.string().describe("ID del proyecto de referencia"),
        tableNames: z
          .array(z.string())
          .optional()
          .nullable()
          .describe(
            "Lista opcional de nombres de tablas (ej. ['usuarios', 'pagos']). Si se omite, importa todas salvo tablas ruido plataforma chat/MCP.",
          ),
      }),
    }
  );
}
