/**
 * @fileoverview **UiScreensService** — genera el deliverable "Pantallas / UI Screens Spec" (texto)
 * a partir del MCP gráfico compatible activo o fallback heurístico.
 *
 * Estrategia: cruza entidades §3 MDD con Historias de Usuario; `list_screens` con respaldo
 * por-entidad vía `resolve_component` cuando el MCP no soporta `list_screens`. Sin MCP activo,
 * `buildHeuristicScreensFromPlan` produce ScreenSpec[] desde el plan. Ensambla markdown de texto
 * (sin TSX ni preview) y lo persiste en `Project.uiScreensContent`.
 *
 * @copyright 2026 Jorge Correa
 * @license Apache-2.0
 */
import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import type { ListScreensEntity, ScreenSpec } from "@theforge/shared-types";
import { PrismaService } from "../../prisma/prisma.service.js";
import { UiMcpClientService } from "./ui-mcp-client.service.js";
import { UiMcpService } from "./ui-mcp.service.js";
import { buildUiScreensMarkdown } from "./ui-screens-markdown.util.js";
import {
  appendUiProjectToPantallas,
  buildUiProjectInstructions,
} from "./ui-project-instructions.util.js";
import { resolveConstitutionMarkdown } from "./ui-screens-mdd.util.js";
import { buildPantallasPlan, type PantallaPlanItem } from "./ui-screens-plan.util.js";
import { prependDocumentTimestamps } from "../engine/document-date-header.util.js";
import {
  buildHeuristicScreensFromPlan,
  resolveUiStackHint,
} from "./ui-screens-heuristic.util.js";

@Injectable()
export class UiScreensService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly uiMcpClient: UiMcpClientService,
    private readonly uiMcp: UiMcpService,
  ) {}

  /**
   * Genera y persiste el deliverable "Pantallas" para un proyecto.
   * Con MCP activo enriquece componentes; sin MCP usa fallback heurístico.
   */
  async syncUiScreens(projectId: string): Promise<{ content: string; screens: number }> {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: {
        id: true,
        complexity: true,
        dbgaContent: true,
        phase0SummaryContent: true,
        specContent: true,
        apiContractsContent: true,
        userStoriesContent: true,
        blueprintContent: true,
        name: true,
        stages: {
          select: { ordinal: true, workflowStatus: true, mddContent: true },
          orderBy: { ordinal: "asc" },
        },
      },
    });
    if (!project) throw new NotFoundException("Proyecto no encontrado");

    const mdd = resolveConstitutionMarkdown(project);
    const stackHint = resolveUiStackHint(mdd, project.blueprintContent);
    const stage = await this.prisma.stage.findFirst({
      where: { projectId },
      orderBy: { ordinal: "asc" },
      select: { domainInventory: true, brdContent: true, mddContent: true },
    });
    let inventory: import("@theforge/shared-types").DomainInventory | null = null;
    try {
      const { resolveDomainInventory } = await import("../engine/domain-inventory-persist.util.js");
      inventory = resolveDomainInventory({
        persisted: stage?.domainInventory,
        brdMarkdown: stage?.brdContent,
        dbgaMarkdown: (project as { dbgaContent?: string | null }).dbgaContent,
        mddMarkdown: mdd,
      });
    } catch {
      inventory = null;
    }
    const plan = buildPantallasPlan(
      mdd,
      project.userStoriesContent,
      project.apiContractsContent,
      inventory,
    );

    if (plan.length === 0) {
      throw new BadRequestException(
        "El MDD del proyecto no tiene entidades en §3 (Modelo de Datos) ni journeys para derivar pantallas.",
      );
    }

    const mcpActive = await this.uiMcpClient.isActive();
    let screens: ScreenSpec[];
    let libraryName: string | null | undefined = stackHint.adapterLabel;
    let libraryVersion: string | null | undefined;
    let contractVersion: string | null | undefined;

    if (mcpActive) {
      const entities: ListScreensEntity[] = plan.map(
        ({ name, classification, keyFields, restEndpoint }) => ({
          name,
          classification,
          keyFields,
          restEndpoint,
        }),
      );

      let mcpScreens = await this.uiMcpClient.listScreens({ entities });
      if (!mcpScreens) {
        mcpScreens = await this.buildScreensFromResolve(plan);
      } else {
        mcpScreens = await this.enrichScreensFromPlan(mcpScreens, plan);
      }
      if (!mcpScreens || mcpScreens.length === 0) {
        screens = buildHeuristicScreensFromPlan(plan, stackHint);
      } else {
        screens = mcpScreens;
      }
      const meta = await this.uiMcp.getActiveCompatibleMeta();
      libraryName = meta?.libraryName ?? stackHint.adapterLabel;
      libraryVersion = meta?.libraryVersion;
      contractVersion = meta?.contractVersion;
    } else {
      screens = buildHeuristicScreensFromPlan(plan, stackHint);
    }

    const pantallasBody = buildUiScreensMarkdown(screens, plan, {
      projectName: project.name,
      libraryName,
      libraryVersion,
      contractVersion,
      stackBase: stackHint.adapterLabel,
      generatedAt: new Date(),
    });
    if (!pantallasBody) {
      throw new BadRequestException("No se pudo ensamblar el documento de pantallas.");
    }

    let content = pantallasBody;
    if (mcpActive && (await this.uiMcp.supportsUiProjectInstructions())) {
      const uiProject = buildUiProjectInstructions({
        projectName: project.name,
        plan,
        screens,
      });
      content = appendUiProjectToPantallas(pantallasBody, uiProject);
    }

    await this.prisma.project.update({
      where: { id: projectId },
      data: { uiScreensContent: prependDocumentTimestamps(content) },
    });

    return { content, screens: screens.length };
  }

  /** Aplica nombres y propósitos del plan (HU + §3) sobre pantallas de `list_screens`. */
  private async enrichScreensFromPlan(
    screens: ScreenSpec[],
    plan: PantallaPlanItem[],
  ): Promise<ScreenSpec[]> {
    const byEntity = new Map(plan.map((p) => [p.name, p]));
    const enriched = screens.map((screen) => {
      const entity = screen.components[0]?.entity ?? screen.name;
      const item = byEntity.get(entity);
      if (!item) return screen;
      return {
        ...screen,
        name: item.screenName,
        purpose: this.formatPurposeWithHuRefs(item),
      };
    });

    const listedEntities = new Set(
      enriched.flatMap((s) => s.components.map((c) => c.entity).filter(Boolean) as string[]),
    );
    const missingHuOnly = plan.filter((p) => p.source === "hu-only" && !listedEntities.has(p.name));
    if (missingHuOnly.length === 0) return enriched;

    const huOnlyScreens = await this.buildScreensFromResolve(missingHuOnly);
    return [...enriched, ...huOnlyScreens];
  }

  private formatPurposeWithHuRefs(item: PantallaPlanItem): string {
    let purpose = item.purpose;
    if (item.userStoryRefs && item.userStoryRefs.length > 1) {
      purpose += `\n\n**Historias relacionadas:** ${item.userStoryRefs.join("; ")}`;
    }
    return purpose;
  }

  /** Respaldo: una pantalla por ítem del plan usando `resolve_component`. */
  private async buildScreensFromResolve(plan: PantallaPlanItem[]): Promise<ScreenSpec[]> {
    const screens: ScreenSpec[] = [];
    for (const item of plan) {
      const keyFields =
        item.keyFields && item.keyFields.length > 0 ? item.keyFields : ["id"];
      const resolved = await this.uiMcpClient.resolveComponent({
        entityName: item.name,
        classification: item.classification,
        keyFields,
        restEndpoint: item.restEndpoint,
        uiHint: item.uiHint,
        context: item.resolveContext,
      });
      if (!resolved) continue;
      screens.push({
        name: item.screenName,
        purpose: this.formatPurposeWithHuRefs(item),
        components: [
          {
            component: resolved.component,
            package: resolved.package,
            version: resolved.version,
            entity: item.source === "hu-only" ? undefined : item.name,
            props: resolved.propMapping ?? {},
          },
        ],
        endpoints: item.restEndpoint ? [item.restEndpoint] : [],
      });
    }
    return screens;
  }
}
