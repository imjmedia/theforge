/**
 * @fileoverview **ChangeInterviewService** — Entrevista conversacional para proyectos LEGACY.
 *
 * Reemplaza el flujo actual (legacy_start → preguntas → legacy_answer) por un agente
 * conversacional que, guiado por el navigation map, hace preguntas iterativas para
 * definir el alcance del cambio.
 *
 * Flujo:
 * 1. Usuario describe el cambio en lenguaje natural
 * 2. Sistema carga el navigation map del proyecto
 * 3. Sistema identifica rutas/componentes relevantes
 * 4. Sistema pregunta iterativamente hasta tener alcance claro
 * 5. Usuario confirma → se produce ChangeScope
 * 6. ChangeScope se usa para generar el MDD
 */

import { Injectable, Logger, BadRequestException, NotFoundException, Inject, forwardRef } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service.js";
import { AiService } from "../ai/ai.service.js";
import { ProjectsService } from "../projects/projects.service.js";
import { TheForgeService } from "../theforge/theforge.service.js";
import {
  type ChangeScope,
  type InterviewMessage,
  type InterviewState,
  type InterviewStatus,
  type NavigationMapSummary,
  type AffectedRoute,
} from "./change-interview.types.js";
import {
  INTERVIEW_SYSTEM_PROMPT,
  START_PROMPT_TEMPLATE,
  CONTINUE_PROMPT_TEMPLATE,
  CHANGE_SCOPE_EXTRACTION_PROMPT,
} from "./change-interview.prompts.js";

@Injectable()
export class ChangeInterviewService {
  private readonly logger = new Logger(ChangeInterviewService.name);
  private readonly sessions = new Map<string, InterviewState>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly ai: AiService,
    @Inject(forwardRef(() => ProjectsService))
    private readonly projects: ProjectsService,
    private readonly theforge: TheForgeService,
  ) {}

  /**
   * Inicia una entrevista: carga navigation map, identifica rutas relevantes
   * y muestra primeras preguntas.
   */
  async startInterview(
    projectId: string,
    description: string,
    stageId?: string,
  ): Promise<{
    sessionId: string;
    messages: InterviewMessage[];
    navigationMap: NavigationMapSummary | null;
  }> {
    const desc = (description ?? "").trim();
    if (!desc) throw new BadRequestException("description is required");

    // Load navigation map from Ariadne MCP
    const navMap = await this.fetchNavigationMap(projectId);

    // Find relevant routes based on the description
    const relevantRoutes = this.findRelevantRoutes(desc, navMap);
    const affectedComponents = this.findAffectedComponents(desc, navMap, relevantRoutes);

    // Build navigation map summary
    let navSummary: NavigationMapSummary | null = navMap
      ? {
          routes: (navMap.routes ?? []).map((r: any) => ({
            url: r.url ?? "",
            screenName: r.screenName ?? "",
            componentPath: r.componentPath ?? "",
            forms: (r.forms ?? []).length,
            endpoints: (r.endpoints ?? []).length,
            subComponents: (r.subComponents ?? []).length,
          })),
          sharedComponents: (navMap.sharedComponents ?? []).map((s: any) => ({
            name: s.name ?? "",
            path: s.path ?? "",
            usedInRoutes: s.usedInRoutes ?? [],
          })),
          framework: navMap.framework ?? "unknown",
          apiClient: navMap.apiClient,
        }
      : null;

    // Format the navigation map for the AI prompt
    const navContext = this.formatNavigationMapForPrompt(navMap, relevantRoutes, affectedComponents);

    // Generate initial AI response
    const prompt = START_PROMPT_TEMPLATE
      .replace("{{description}}", desc)
      .replace("{{navContext}}", navContext);

    const aiResponse = await this.ai.generateResponse(prompt, [], {
      systemPrompt: INTERVIEW_SYSTEM_PROMPT,
    });

    const messages: InterviewMessage[] = [
      {
        role: "user",
        content: desc,
        timestamp: new Date().toISOString(),
      },
      {
        role: "assistant",
        content: aiResponse,
        timestamp: new Date().toISOString(),
      },
    ];

    // Create session
    const sessionId = this.generateSessionId();
    this.sessions.set(sessionId, {
      sessionId,
      projectId,
      stageId,
      description: desc,
      messages,
      status: "in_progress",
      navigationMapSnapshot: navMap ? JSON.stringify(navMap) : null,
      relevantRoutes,
      affectedComponents,
      changeScope: null,
    });

    return {
      sessionId,
      messages,
      navigationMap: navSummary,
    };
  }

  /**
   * Continúa la conversación con un nuevo mensaje del usuario.
   */
  async continueChat(
    projectId: string,
    sessionId: string,
    message: string,
  ): Promise<{
    messages: InterviewMessage[];
    changeScope: ChangeScope | null;
  }> {
    const session = this.getSessionForProject(projectId, sessionId);
    if (session.status === "confirmed" || session.status === "cancelled") {
      throw new BadRequestException(`Interview is already ${session.status}. Start a new one.`);
    }

    const msg = (message ?? "").trim();
    if (!msg) throw new BadRequestException("message is required");

    // Add user message to history
    session.messages.push({
      role: "user",
      content: msg,
      timestamp: new Date().toISOString(),
    });

    // Build LLM history from session
    const llmHistory = session.messages.map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    }));

    // Generate AI response
    const aiResponse = await this.ai.generateResponse(
      CONTINUE_PROMPT_TEMPLATE.replace("{{description}}", session.description),
      llmHistory,
      {
        systemPrompt: INTERVIEW_SYSTEM_PROMPT,
      },
    );

    session.messages.push({
      role: "assistant",
      content: aiResponse,
      timestamp: new Date().toISOString(),
    });

    // Check if the response includes a confirmation marker
    let changeScope: ChangeScope | null = null;
    if (aiResponse.includes("---CONFIRMADO---")) {
      changeScope = await this.extractChangeScope(session);
      session.status = "pending_confirmation";
      session.changeScope = changeScope;
    }

    return { messages: session.messages, changeScope };
  }

  /**
   * Confirma el ChangeScope actual y lo persiste.
   */
  async confirmScope(projectId: string, sessionId: string): Promise<{
    changeScope: ChangeScope;
  }> {
    const session = this.getSessionForProject(projectId, sessionId);
    if (!session.changeScope) {
      throw new BadRequestException("No change scope to confirm. Complete the interview first.");
    }

    session.status = "confirmed";

    // Persist the change scope in the project/stage
    const scope = session.changeScope;
    await this.persistChangeScope(session.projectId, scope, session.stageId);

    return { changeScope: scope };
  }

  /**
   * Cancela la entrevista.
   */
  async cancelInterview(projectId: string, sessionId: string): Promise<void> {
    const session = this.getSessionForProject(projectId, sessionId);
    session.status = "cancelled";
  }

  /**
   * Obtiene el estado actual de la entrevista.
   */
  async getStatus(projectId: string, sessionId: string): Promise<{
    status: InterviewStatus;
    messages: InterviewMessage[];
    changeScope: ChangeScope | null;
    relevantRoutes: AffectedRoute[];
  }> {
    const session = this.getSessionForProject(projectId, sessionId);
    return {
      status: session.status,
      messages: session.messages,
      changeScope: session.changeScope,
      relevantRoutes: session.relevantRoutes,
    };
  }

  // -------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------

  /**
   * Devuelve la sesión solo si pertenece al proyecto de la ruta. Inexistente o de otro proyecto:
   * mismo 404, para que un `sessionId` no sirva de oráculo entre proyectos.
   */
  private getSessionForProject(projectId: string, sessionId: string): InterviewState {
    const session = this.sessions.get(sessionId);
    if (!session || session.projectId !== projectId) {
      throw new NotFoundException("Session not found");
    }
    return session;
  }

  private async fetchNavigationMap(projectId: string): Promise<any | null> {
    try {
      const theforgeProject = await this.projects.findOne(projectId);
      const theforgeId = (theforgeProject as any)?.theforgeProjectId;

      if (!theforgeId) {
        this.logger.warn(`No theforgeProjectId found for project ${projectId}`);
        return null;
      }

      const content = await this.theforge.fetchNavigationMap(theforgeId);
      if (!content) {
        this.logger.warn(`MCP navigation map call failed for ${theforgeId}`);
        return null;
      }

      // Parse the navigation map from the MCP response
      return this.parseNavMapFromMarkdown(content);
    } catch (err) {
      this.logger.warn(`Failed to fetch navigation map: ${err}`);
      return null;
    }
  }

  /**
   * Busca rutas relevantes para la descripción del cambio.
   */
  private findRelevantRoutes(
    description: string,
    navMap: any | null,
  ): AffectedRoute[] {
    if (!navMap?.routes) return [];
    const desc = description.toLowerCase();

    // Keywords to match against route URLs and screen names
    const keywords = desc
      .split(/\s+/)
      .filter((w) => w.length > 3)
      .filter((w) => !["para", "con", "que", "por", "las", "los", "del"].includes(w));

    const routes: AffectedRoute[] = [];

    for (const route of navMap.routes) {
      const url = (route.url ?? "").toLowerCase();
      const screen = (route.screenName ?? "").toLowerCase();
      const component = (route.componentPath ?? "").toLowerCase();

      // Check for keyword matches
      const matchScore = keywords.reduce((score, kw) => {
        if (url.includes(kw) || screen.includes(kw) || component.includes(kw)) {
          return score + 1;
        }
        return score;
      }, 0);

      // Extract change type from description
      let changeType: AffectedRoute["changeType"] = "other";
      if (/agregar|nuevo|crear|new|add/i.test(desc)) changeType = "new_route";
      else if (/modificar|cambiar|edit|update|change/i.test(desc)) changeType = "modify_field";
      else if (/eliminar|borrar|remove|delete/i.test(desc)) changeType = "other";

      if (matchScore > 0 || this.isRouteContextuallyRelevant(route, description)) {
        routes.push({
          url: route.url ?? "",
          screen: route.screenName ?? "",
          components: [
            route.componentPath ?? "",
            ...(route.subComponents ?? []).map((s: any) => s.path ?? s.name ?? ""),
          ].filter(Boolean),
          changeType,
          matchScore,
        });
      }
    }

    // Sort by relevance score
    routes.sort((a, b) => (b.matchScore ?? 0) - (a.matchScore ?? 0));

    return routes;
  }

  /**
   * Detecta si una ruta es contextualmente relevante aunque no matchee keywords.
   * Ej: "descuento" en "clientes" → busca forms con campos similares.
   */
  private isRouteContextuallyRelevant(route: any, description: string): boolean {
    const desc = description.toLowerCase();

    // Check form fields
    for (const form of route.forms ?? []) {
      for (const field of form.fields ?? []) {
        const fieldName = (field.name ?? "").toLowerCase();
        if (fieldName.includes(desc) || desc.includes(fieldName)) {
          return true;
        }
      }
    }

    // Check endpoints
    for (const ep of route.endpoints ?? []) {
      const path = (ep.path ?? "").toLowerCase();
      if (path.includes(desc) || desc.includes(path.split("/").pop() ?? "")) {
        return true;
      }
    }

    return false;
  }

  /**
   * Encuentra componentes afectados (compartidos) por el cambio.
   */
  private findAffectedComponents(
    _description: string,
    navMap: any | null,
    relevantRoutes: AffectedRoute[],
  ): string[] {
    if (!navMap?.sharedComponents) return [];
    const affectedUrls = new Set(relevantRoutes.map((r) => r.url));
    const components: string[] = [];

    for (const sc of navMap.sharedComponents) {
      for (const url of sc.usedInRoutes ?? []) {
        if (affectedUrls.has(url)) {
          components.push(sc.name ?? sc.path ?? "unknown");
          break;
        }
      }
    }

    return components;
  }

  /**
   * Extrae ChangeScope del estado actual de la entrevista.
   */
  private async extractChangeScope(session: InterviewState): Promise<ChangeScope> {
    const messages = session.messages.map((m) => `${m.role}: ${m.content}`).join("\n\n");

    const prompt = CHANGE_SCOPE_EXTRACTION_PROMPT
      .replace("{{messages}}", messages)
      .replace("{{description}}", session.description);

    const raw = await this.ai.generateResponse(prompt, [], {
      systemPrompt: "Eres un analista de sistemas. Extrae el ChangeScope exacto de la conversación. Responde SOLO con el JSON, nada más.",
    });

    try {
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      const json = jsonMatch ? JSON.parse(jsonMatch[0]) : this.fallbackChangeScope(session);
      return this.validateChangeScope(json);
    } catch {
      return this.fallbackChangeScope(session);
    }
  }

  private fallbackChangeScope(session: InterviewState): ChangeScope {
    return {
      confirmed: false,
      description: session.description,
      affectedRoutes: session.relevantRoutes.map((r) => ({
        url: r.url,
        screen: r.screen,
        components: r.components,
        changeType: r.changeType,
      })),
      affectedEndpoints: [],
      sharedComponentsImpacted: session.affectedComponents,
      userConfirmation: false,
    };
  }

  private validateChangeScope(raw: any): ChangeScope {
    return {
      confirmed: raw.confirmed ?? false,
      description: raw.description ?? "",
      affectedRoutes: Array.isArray(raw.affectedRoutes)
        ? raw.affectedRoutes.map((r: any) => ({
            url: r.url ?? "",
            screen: r.screen ?? "",
            components: Array.isArray(r.components) ? r.components : [],
            changeType: r.changeType ?? "other",
          }))
        : [],
      affectedEndpoints: Array.isArray(raw.affectedEndpoints)
        ? raw.affectedEndpoints.map((e: any) => ({
            method: e.method ?? "GET",
            path: e.path ?? "",
            changeType: e.changeType ?? "add",
          }))
        : [],
      newFields: Array.isArray(raw.newFields)
        ? raw.newFields.map((f: any) => ({
            component: f.component ?? "",
            form: f.form ?? "",
            field: f.field ?? "",
            type: f.type ?? "string",
            validation: f.validation ?? undefined,
            afterField: f.afterField ?? undefined,
          }))
        : [],
      sharedComponentsImpacted: Array.isArray(raw.sharedComponentsImpacted) ? raw.sharedComponentsImpacted : [],
      userConfirmation: raw.userConfirmation ?? false,
    };
  }

  /**
   * Persiste el ChangeScope en la stage/proyecto.
   */
  private async persistChangeScope(
    projectId: string,
    scope: ChangeScope,
    stageId?: string,
  ): Promise<void> {
    const scopeJson = scope as object;

    const legacyPatch = {
      description: scope.description,
      changeScope: scopeJson,
      status: "scope_confirmed",
      timestamp: new Date().toISOString(),
    };

    if (stageId) {
      const stage = await this.prisma.stage.findUnique({
        where: { id: stageId },
        select: { legacyChangeState: true },
      });
      const prev = (stage?.legacyChangeState as Record<string, unknown> | null) ?? {};
      await this.prisma.stage.update({
        where: { id: stageId },
        data: {
          mddContent: this.buildMddFromChangeScope(scope),
          legacyChangeState: { ...prev, ...legacyPatch },
        },
      });
      return;
    }

    const firstStage = await this.prisma.stage.findFirst({
      where: { projectId },
      orderBy: { ordinal: "asc" },
      select: { id: true, legacyChangeState: true },
    });
    if (firstStage) {
      const prev = (firstStage.legacyChangeState as Record<string, unknown> | null) ?? {};
      await this.prisma.stage.update({
        where: { id: firstStage.id },
        data: {
          mddContent: this.buildMddFromChangeScope(scope),
          legacyChangeState: { ...prev, ...legacyPatch },
        },
      });
      return;
    }

    throw new BadRequestException("El proyecto no tiene etapas para persistir el alcance del cambio.");
  }

  /**
   * Construye un MDD preliminar desde el ChangeScope.
   */
  private buildMddFromChangeScope(scope: ChangeScope): string {
    const sections: string[] = [
      "# Documento de Cambio (Generado desde ChangeScope)",
      "",
      "## 1. Descripción del Cambio",
      "",
      scope.description,
      "",
      "## 2. Rutas Afectadas",
      "",
    ];

    for (const route of scope.affectedRoutes) {
      sections.push(`### ${route.url} — ${route.screen}`);
      sections.push(`- Tipo de cambio: ${route.changeType}`);
      sections.push(`- Componentes: ${route.components.join(", ")}`);
      sections.push("");
    }

    if (scope.affectedEndpoints.length > 0) {
      sections.push("## 3. Endpoints Afectados", "");
      for (const ep of scope.affectedEndpoints) {
        sections.push(`- ${ep.method} ${ep.path} (${ep.changeType})`);
      }
      sections.push("");
    }

    if (scope.newFields && scope.newFields.length > 0) {
      sections.push("## 4. Nuevos Campos", "");
      for (const field of scope.newFields) {
        const after = field.afterField ? ` (después de: ${field.afterField})` : "";
        const validation = field.validation ? ` [${field.validation}]` : "";
        sections.push(`- ${field.component}/${field.form}: ${field.field} (${field.type})${validation}${after}`);
      }
      sections.push("");
    }

    if (scope.sharedComponentsImpacted.length > 0) {
      sections.push("## 5. Componentes Compartidos Afectados", "");
      for (const sc of scope.sharedComponentsImpacted) {
        sections.push(`- ⚠️ ${sc}`);
      }
      sections.push("");
    }

    return sections.join("\n");
  }

  /**
   * Parsea el navigation map desde el Markdown generado por el MCP tool.
   */
  private parseNavMapFromMarkdown(markdown: string): any {
    const routes: any[] = [];
    const sharedComponents: any[] = [];
    let framework = "";
    let frameworkVersion = "";

    const lines = markdown.split("\n");
    let currentRoute: any = null;
    let parsingShared = false;

    for (const line of lines) {
      const frameworkMatch = line.match(/Framework:\s+(\S+)\s+(\S+)/);
      if (frameworkMatch) {
        framework = frameworkMatch[1];
        frameworkVersion = frameworkMatch[2];
      }

      if (line.startsWith("## ") && !line.startsWith("## Advertencias") && !line.startsWith("## Componentes Compartidos")) {
        const url = line.replace(/^##\s+/, "").replace(/[🟢🟡🔴]\s*$/, "").trim();
        currentRoute = {
          url,
          params: [],
          screenName: "",
          componentPath: "",
          subComponents: [],
          forms: [],
          endpoints: [],
          navigation: [],
        };
        routes.push(currentRoute);
        parsingShared = false;
      }

      if (line.startsWith("## Componentes Compartidos")) {
        parsingShared = true;
        continue;
      }

      if (parsingShared && line.startsWith("### ")) {
        sharedComponents.push({
          name: line.replace(/^###\s+/, "").trim(),
          path: "",
          usedInRoutes: [],
        });
      }

      if (!currentRoute) continue;

      const screenMatch = line.match(/Pantalla:\s*(.+)/);
      if (screenMatch) currentRoute.screenName = screenMatch[1].trim();

      const renderMatch = line.match(/Renderiza:\s*(.+)/);
      if (renderMatch) currentRoute.componentPath = renderMatch[1].trim();

      const paramMatch = line.match(/Parametros:\s*(.+)/);
      if (paramMatch) {
        currentRoute.params = paramMatch[1].split(",").map((p: string) => p.trim());
      }

      const formMatch = line.match(/^\s+-\s+(.+?)\s+\(static|dynamic\)/);
      if (formMatch) {
        currentRoute.forms.push({
          name: formMatch[1].trim(),
          type: line.includes("(static)") ? "static" : "dynamic",
          fields: [],
        });
      }

      const epMatch = line.match(/^\s+-\s+(GET|POST|PUT|PATCH|DELETE)\s+(\S+)/);
      if (epMatch) {
        currentRoute.endpoints.push({
          method: epMatch[1],
          path: epMatch[2],
          usage: "data",
          file: currentRoute.componentPath ?? "",
        });
      }
    }

    return {
      routes,
      sharedComponents,
      framework,
      frameworkVersion,
      projectId: "",
    };
  }

  /**
   * Formatea el navigation map para el prompt del LLM.
   */
  private formatNavigationMapForPrompt(
    navMap: any | null,
    relevantRoutes: AffectedRoute[],
    _affectedComponents: string[],
  ): string {
    if (!navMap) {
      return "_No se pudo obtener el mapa de navegación del proyecto._";
    }

    const lines: string[] = [
      "## Mapa de Navegación del Proyecto",
      "",
      `Framework: ${navMap.framework ?? "desconocido"} ${navMap.frameworkVersion ?? ""}`,
      `Total de rutas: ${(navMap.routes ?? []).length}`,
      `Componentes compartidos: ${(navMap.sharedComponents ?? []).length}`,
      "",
    ];

    if (relevantRoutes.length > 0) {
      lines.push("### Rutas Más Relevantes para este Cambio", "");
      for (const route of relevantRoutes) {
        lines.push(`- **${route.url}** — ${route.screen}`);
        lines.push(`  Componentes: ${route.components.join(", ")}`);

        // Find forms for this route
        const navRoute = (navMap.routes ?? []).find((r: any) => r.url === route.url);
        if (navRoute?.forms?.length > 0) {
          for (const form of navRoute.forms) {
            lines.push(`  Formulario: ${form.name} (${form.type})`);
            for (const field of form.fields ?? []) {
              lines.push(`    - ${field.name} (${field.type})${field.required ? " [requerido]" : ""}${field.validation ? ` [${field.validation}]` : ""}`);
            }
            if (form.submitEndpoint) {
              lines.push(`    → Submit: ${form.submitMethod ?? "POST"} ${form.submitEndpoint}`);
            }
          }
        }

        // Find endpoints
        if (navRoute?.endpoints?.length > 0) {
          for (const ep of navRoute.endpoints) {
            lines.push(`  Endpoint: ${ep.method} ${ep.path}`);
          }
        }
        lines.push("");
      }
    } else if (navMap.routes?.length > 0) {
      lines.push("### Todas las Rutas", "");
      for (const route of navMap.routes) {
        lines.push(`- **${route.url ?? "/"}** — ${route.screenName ?? "Sin nombre"}`);
        if (route.forms?.length > 0) {
          lines.push(`  Formularios: ${route.forms.length}`);
        }
        if (route.endpoints?.length > 0) {
          lines.push(`  Endpoints: ${route.endpoints.length}`);
        }
      }
    }

    if (navMap.sharedComponents?.length > 0) {
      lines.push("");
      lines.push("### Componentes Compartidos", "");
      for (const sc of navMap.sharedComponents) {
        lines.push(`- **${sc.name ?? sc.path ?? "desconocido"}**`);
        lines.push(`  Usado en: ${(sc.usedInRoutes ?? []).join(", ")}`);
      }
    }

    return lines.join("\n");
  }

  private generateSessionId(): string {
    return `int_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  }
}
