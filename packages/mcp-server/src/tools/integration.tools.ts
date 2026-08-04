import type { ProjectNextTaskResponse } from "@theforge/shared-types";
import type { McpApiClient, McpHandler, McpTool } from "../mcp-tool.types.js";
import {
  enrichStagesWithBundleMeta,
  pickPrimaryStageFromApi,
  resolveTasksSsotFromProjectApi,
} from "../mcp-ssot.util.js";

export const INTEGRATION_TOOLS: McpTool[] = [
  {
    name: "merge_projects",
    description:
      "Fusiona 2 o más proyectos en Paso 0 (DBGA): sintetiza borrador Fase 0, opcional benchmark, suite de sub-productos, archivado de fuentes y auditoría automática.",
    inputSchema: {
      type: "object",
      properties: {
        sourceProjectIds: {
          type: "array",
          items: { type: "string" },
          description: "IDs de proyectos fuente (mínimo 2)",
        },
        name: { type: "string", description: "Nombre si targetMode=new" },
        targetMode: { type: "string", enum: ["new", "existing"], description: "Default: new" },
        targetProjectId: { type: "string", description: "Requerido si targetMode=existing" },
        deleteSources: {
          type: "string",
          enum: ["keep", "archive", "delete"],
          description: "Qué hacer con las fuentes (excepto destino)",
        },
        resetDownstream: { type: "boolean", description: "Limpiar MDD y entregables en destino (default true)" },
        createSuite: { type: "boolean", description: "Vincular fuentes como sub-productos" },
        includeBenchmark: { type: "boolean", description: "Incluir benchmark/deep research en la fusión" },
        autoAudit: { type: "boolean", description: "Lanzar auditoría Paso 0 tras fusionar" },
        preview: { type: "boolean", description: "Solo vista previa, sin persistir" },
      },
      required: ["sourceProjectIds"],
    },
  },
  {
    name: "set_aem_content",
    description: "Actualiza el contenido AEM (Análisis y Estrategia de Mercado) del proyecto. Usado por aplicaciones externas de análisis de mercado.",
    inputSchema: {
      type: "object",
      properties: {
        projectId: { type: "string" },
        content: { type: "string", description: "Contenido AEM en Markdown" },
      },
      required: ["projectId", "content"],
    },
  },
  {
    name: "get_change_log",
    description: "Obtiene la bitácora de cambios de un proyecto (quién modificó qué y cuándo).",
    inputSchema: {
      type: "object",
      properties: {
        projectId: { type: "string", description: "ID del proyecto" },
        limit: { type: "number", description: "Máximo de entradas (default 50)" },
      },
      required: ["projectId"],
    },
  },
  {
    name: "get_integration_status",
    description:
      "Estado de integración NEW ↔ LEGACY: enlaces, handoff NEW-LEG (ítems, status), matriz traces, warnings, handoffImportedAt y promotableItemIds (LEGACY). En LEGACY incluye linkedNewHandoff del proyecto NEW vinculado.",
    inputSchema: {
      type: "object",
      properties: {
        projectId: {
          type: "string",
          description: "ID del proyecto NEW o LEGACY (Workshop)",
        },
      },
      required: ["projectId"],
    },
  },
  {
    name: "get_integration_traces",
    description:
      "Matriz de trazabilidad NEW-LEG ↔ LEG (filas IntegrationTrace): newLegId, legacyStoryId, legacyStageId, status, title, description, actor, acceptanceCriteria. Equivalente a la tabla «Trazabilidad» en Integración.",
    inputSchema: {
      type: "object",
      properties: {
        projectId: {
          type: "string",
          description: "ID del proyecto NEW o LEGACY (Workshop)",
        },
      },
      required: ["projectId"],
    },
  },
  {
    name: "report_documentation_gap",
    description:
      "Reporta un gap de documentación SDD (doc incorrecta/incompleta). Por defecto queda pendiente de aprobación humana en Workshop (`pendingApproval` en la respuesta); con DOC_GAP_AUTO_APPLY=1 reconcilia al instante.",
    inputSchema: {
      type: "object",
      properties: {
        projectId: { type: "string", description: "ID del proyecto The Forge" },
        stageId: { type: "string", description: "ID de la etapa activa" },
        description: {
          type: "string",
          description: "Descripción del gap (mín. 40 caracteres, accionable)",
        },
        evidence: {
          type: "object",
          properties: {
            reference: {
              type: "string",
              description: "Referencia SDD: §, T-, docs/sdd/, tasks.md, etc.",
            },
            codePaths: { type: "array", items: { type: "string" } },
            snippet: { type: "string" },
          },
          required: ["reference"],
        },
        affectedArtifacts: {
          type: "array",
          items: {
            type: "string",
            enum: [
              "mdd",
              "spec",
              "architecture",
              "blueprint",
              "useCases",
              "userStories",
              "tasks",
              "apiContracts",
              "logicFlows",
              "infra",
              "uxUiGuide",
              "agentGovernance",
            ],
          },
          description: "Artefactos SDD a regenerar parcialmente",
        },
      },
      required: ["projectId", "stageId", "description", "evidence", "affectedArtifacts"],
    },
  },
  {
    name: "get_agent_session_log",
    description:
      "Timeline de sesión agéntica (gaps reportados, reconciliaciones, artefactos actualizados) — separada del chat Workshop.",
    inputSchema: {
      type: "object",
      properties: {
        projectId: { type: "string", description: "ID del proyecto" },
        stageId: { type: "string", description: "ID de la etapa" },
        limit: { type: "number", description: "Máximo de entradas (default 100)" },
      },
      required: ["projectId", "stageId"],
    },
  },
  {
    name: "list_theforge_projects",
    description: "Lista proyectos indexados en TheForge/Ariadne (multi-root)",
    inputSchema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "resolve_forge_project_for_ariadne",
    description:
      "Resuelve un proyecto Workshop (Forge) desde identificadores Ariadne. Devuelve forgeProjectId, linkKind (primary|alias|inferred) y etapas opcionales. HTTP 404 → not_found; 409 → ambiguous con candidates[] para modal en Ariadne.",
    inputSchema: {
      type: "object",
      properties: {
        ariadneProjectId: { type: "string", description: "UUID proyecto Falkor / multi-root" },
        ariadneRepositoryId: { type: "string", description: "UUID repo indexado" },
        projectKey: { type: "string", description: "Clave de proyecto, ej. kreodevs" },
        repoSlug: { type: "string", description: "Slug del repo, ej. theforge" },
        gitRemoteUrl: { type: "string", description: "URL git normalizada (fallback)" },
      },
      required: [],
    },
  },
  {
    name: "create_stage_from_ariadne_change_pack",
    description:
      "Crea una etapa LEGACY (o importa en stageId existente ≥2) desde un change pack Ariadne v1. Persiste legacyChangeState, handoff opcional, wire brownfield y legacy/start condicional. Devuelve recommendedNextTools (legacy_generate_mdd, etc.).",
    inputSchema: {
      type: "object",
      properties: {
        forgeProjectId: { type: "string", description: "UUID proyecto Workshop (de resolve_forge_project_for_ariadne)" },
        pack: {
          type: "object",
          description: "Change pack v1",
          properties: {
            version: { type: "string", enum: ["1"] },
            changeDescription: { type: "string" },
            ariadneChangeId: { type: "string" },
            ariadneRepositoryId: { type: "string" },
            filesToModify: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  path: { type: "string" },
                  repoId: { type: "string" },
                },
                required: ["path"],
              },
            },
            questionsToRefine: { type: "array", items: { type: "string" } },
            handoffItems: { type: "array", items: { type: "object" } },
            linkedNewProjectId: { type: "string" },
            handoffPlanType: {
              type: "string",
              enum: ["migration_tasks", "full_cascade"],
              description: "migration_tasks: importa tasks del handoff; Forge omite LLM tasks en cascada.",
            },
            cursorTasksMarkdown: {
              type: "string",
              description: "Markdown Cursor-ready (alias snake_case: cursor_tasks_markdown). SSOT de tasks.",
            },
            cursor_tasks_markdown: {
              type: "string",
              description: "Alias snake_case de cursorTasksMarkdown.",
            },
          },
          required: ["version", "changeDescription"],
        },
        stageId: { type: "string", description: "Importar en etapa existente (ordinal ≥ 2) en lugar de crear" },
        stageName: { type: "string" },
        activate: { type: "boolean", description: "Default true al crear etapa" },
        runLegacyStart: {
          type: "boolean",
          description: "Forzar legacy/start; default false si pack trae filesToModify",
        },
        wireAriadne: { type: "boolean", description: "PATCH brownfield converge (default true)" },
      },
      required: ["forgeProjectId", "pack"],
    },
  },
  {
    name: "get_project_tables",
    description: "Obtiene definiciones de tablas SQL del §3 (Modelo de Datos) del MDD de un proyecto de referencia. Opcional: filtrar solo las tablas especificadas en tableNames.",
    inputSchema: {
      type: "object",
      properties: {
        projectId: { type: "string", description: "ID del proyecto del que extraer las tablas" },
        tableNames: {
          type: "array",
          items: { type: "string" },
          nullable: true,
          description: "Lista opcional de nombres de tablas (ej. ['usuarios', 'pagos']). Si se omite, devuelve todas salvo tablas ruido plataforma chat/MCP.",
        },
      },
      required: ["projectId"],
    },
  },
  {
    name: "get_next_implementation_task",
    description:
      "Returns the next open task (SSOT: tasksJson v2 with tasksContent fallback) plus layout paths. " +
      "Includes tasksSource, hasTasksJson, deliverableBundleVersion when available.",
    inputSchema: {
      type: "object",
      properties: { projectId: { type: "string", description: "The Forge project ID" } },
      required: ["projectId"],
    },
  },
  {
    name: "get_tasks_json",
    description:
      "Returns structured tasks v2 (SSOT) via resolveTasksForConsume — prefers valid tasksJson, " +
      "falls back to tasksContent metadata. Includes deliverableBundleVersion from stage snapshot.",
    inputSchema: {
      type: "object",
      properties: { projectId: { type: "string", description: "The Forge project ID" } },
      required: ["projectId"],
    },
  },
];

export function createIntegrationHandlers(api: McpApiClient): Record<string, McpHandler> {
  const { get: apiGet, post: apiPost, patch: apiPatch, delete: apiDelete, fetchAllowStatuses: apiFetchAllowStatuses } = api;
  return {
  async merge_projects(args) {
    const sourceProjectIds = args.sourceProjectIds as string[];
    if (!Array.isArray(sourceProjectIds) || sourceProjectIds.length < 2) {
      throw new Error("merge_projects requiere sourceProjectIds con al menos 2 IDs");
    }
    const body: Record<string, unknown> = {
      sourceProjectIds,
      targetMode: (args.targetMode as string) ?? "new",
      deleteSources: (args.deleteSources as string) ?? "keep",
      resetDownstream: args.resetDownstream !== false,
      createSuite: args.createSuite === true,
      autoAudit: args.autoAudit !== false,
      preview: args.preview === true,
      sourceOptions: {
        includeDbga: true,
        includePhase0Json: true,
        includeBenchmark: args.includeBenchmark === true,
      },
    };
    if (typeof args.name === "string") body.name = args.name;
    if (typeof args.targetProjectId === "string") body.targetProjectId = args.targetProjectId;
    const result = await apiPost("/projects/merge", body);
    return JSON.stringify(result, null, 2);
  },
  async set_aem_content(args) {
    const { projectId, content } = args as { projectId: string; content: string };
    return JSON.stringify(await apiPatch(`/projects/${projectId}`, { aemContent: content }));
  },
  async get_change_log(args) {
    const { projectId, limit } = args as { projectId: string; limit?: number };
    let path = `/projects/${projectId}/change-log`;
    if (limit != null) path += `?limit=${limit}`;
    return JSON.stringify(await apiGet(path));
  },
  async get_integration_status(args) {
    const projectId = (args.projectId as string | undefined)?.trim();
    if (!projectId) throw new Error("get_integration_status requiere projectId");
    return JSON.stringify(await apiGet(`/projects/${projectId}/integration`));
  },
  async get_integration_traces(args) {
    const projectId = (args.projectId as string | undefined)?.trim();
    if (!projectId) throw new Error("get_integration_traces requiere projectId");
    return JSON.stringify(await apiGet(`/projects/${projectId}/integration/traces`));
  },
  async report_documentation_gap(args) {
    const { projectId, stageId, description, evidence, affectedArtifacts } = args as {
      projectId: string;
      stageId: string;
      description: string;
      evidence: { reference: string; codePaths?: string[]; snippet?: string };
      affectedArtifacts: string[];
    };
    return JSON.stringify(
      await apiPost(`/projects/${projectId}/stages/${stageId}/documentation-gaps`, {
        description,
        evidence,
        affectedArtifacts,
      }),
    );
  },
  async get_agent_session_log(args) {
    const { projectId, stageId, limit } = args as {
      projectId: string;
      stageId: string;
      limit?: number;
    };
    let path = `/projects/${projectId}/stages/${stageId}/agent-session-log`;
    if (limit != null) path += `?limit=${limit}`;
    return JSON.stringify(await apiGet(path));
  },
  async list_theforge_projects() {
    return JSON.stringify(await apiGet("/theforge/projects"));
  },
  async resolve_forge_project_for_ariadne(args) {
    const { status, data } = await apiFetchAllowStatuses(
      "POST",
      "/theforge/resolve-forge-project-for-ariadne",
      args ?? {},
      [404, 409],
    );
    if (status === 200) {
      return JSON.stringify(data);
    }
    const body =
      typeof data === "object" && data !== null ? (data as Record<string, unknown>) : {};
    const inner = body.message;
    if (typeof inner === "object" && inner !== null && !Array.isArray(inner)) {
      return JSON.stringify({ status, ...(inner as Record<string, unknown>) });
    }
    return JSON.stringify({
      status,
      message: typeof body.message === "string" ? body.message : data,
    });
  },
  async create_stage_from_ariadne_change_pack(args) {
    return JSON.stringify(
      await apiPost("/theforge/create-stage-from-ariadne-change-pack", args ?? {}),
    );
  },
  async get_project_tables(args) {
    const { projectId, tableNames } = args as { projectId: string; tableNames?: string[] };
    const project = await apiGet(`/projects/${projectId}`) as Record<string, unknown>;
    const mddContent = (project.mddContent as string ?? "").trim();
    if (!mddContent) {
      return JSON.stringify({ error: "El proyecto no tiene contenido MDD", tables: [] });
    }
    // Extraer sección 3 (Modelo de Datos) - buscar CREATE TABLE
    const section3Match = mddContent.match(/##\s+(?:3\.\s+)?Modelo\s+(?:de\s+)?Datos[^#]*(?:CREATE\s+TABLE[\s\S]*?)(?=\n##\s+(?:4|5|6|7)\.|\n##\s+(?:Seguridad|Infraestructura|Contratos|Lógica)|\z)/i);
    const sqlBlock = section3Match?.[0] ?? "";
    if (!sqlBlock.trim()) {
      return JSON.stringify({ error: "No se encontró la sección 3 (Modelo de Datos) en el MDD", tables: [] });
    }
    // Extraer todas las sentencias CREATE TABLE
    const tableRegex = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(\w+)\s*\(([\s\S]*?)\);/gi;
    const allTables: { name: string; sql: string; columns: string[] }[] = [];
    let tableMatch: RegExpExecArray | null;
    while ((tableMatch = tableRegex.exec(sqlBlock)) !== null) {
      const name = tableMatch[1]!;
      const body = tableMatch[2]!.trim();
      const lines = body.split("\n").map(l => l.trim()).filter(Boolean);
      allTables.push({ name, sql: tableMatch[0]!, columns: lines.slice(0, 20) }); // max 20 col preview
    }
    let tables = allTables;
    if (Array.isArray(tableNames) && tableNames.length > 0) {
      const filterSet = new Set(tableNames.map(n => n.toLowerCase()));
      tables = allTables.filter(t => filterSet.has(t.name.toLowerCase()));
    } else {
      const section1 = mddContent.match(/(?:^|\n)##\s*1\.[\s\S]*?(?=\n##\s|\n#\s|$)/i)?.[0] ?? "";
      const scopeCorpus = `${section1}\n${mddContent.slice(0, 2500)}`;
      const platformNoise = new Set([
        "conversations", "messages", "mcp_plugins", "conversation_memory",
        "llm_configs", "agent_runs", "channels",
      ]);
      if (!/\b(integraci[oó]n\s+mcp|plataforma\s+mcp|chat\s+operacional|mensajer[ií]a)\b/i.test(scopeCorpus)) {
        tables = allTables.filter(t => !platformNoise.has(t.name));
      }
    }
    return JSON.stringify({
      projectId,
      projectName: project.name ?? "",
      total: allTables.length,
      filtered: tables.length,
      tables: tables.map(t => ({ name: t.name, sql: t.sql })),
    });
  },
  async get_next_implementation_task(args) {
    const projectId = args.projectId as string;
    const data = await apiGet<ProjectNextTaskResponse>(`/projects/${projectId}/next-task`);
    return JSON.stringify({
      ...data,
      agentWorkflow: [
        "1. Read IMPLEMENT.md",
        "2. Read .specify/memory/constitution.md (MDD)",
        `3. Open ${data.tasksPath ?? "specs/NNN-slug/tasks.md"} for checklist`,
        data.governancePresent
          ? "4. Install agent-governance per INSTALACION.md if not in .cursor/"
          : "4. (Optional) Generate agent governance in Workshop",
      ],
    });
  },
  async get_tasks_json(args) {
    const projectId = args.projectId as string;
    const [project, stagesPayload] = await Promise.all([
      apiGet(`/projects/${projectId}`) as Promise<Record<string, unknown>>,
      apiGet(`/projects/${projectId}/stages`).catch(() => ({ stages: [] })),
    ]);
    const stages = (stagesPayload as { stages?: unknown[] }).stages ?? [];
    const primary = pickPrimaryStageFromApi(stages);
    const ssot = resolveTasksSsotFromProjectApi(project, primary);
    if (!ssot.hasTasksJson && ssot.taskCount === 0) {
      return JSON.stringify({
        projectId,
        ...ssot,
        note: "Sin tasksJson válido ni tasksContent parseable. Ejecuta generate_tasks o generate_deliverables.",
      });
    }
    return JSON.stringify({
      projectId,
      ...ssot,
      note: ssot.hasTasksJson
        ? "SSOT tasksJson v2. Para siguiente tarea abierta usa get_next_implementation_task."
        : "Fallback tasksContent (sin JSON estructurado). Regenera tasks para poblar tasksJson.",
    });
  },
  };
}
