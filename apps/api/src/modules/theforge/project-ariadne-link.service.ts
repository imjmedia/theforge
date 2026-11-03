import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import {
  resolveForgeProjectForAriadneInputSchema,
  type ResolveForgeProjectAmbiguousResponse,
  type ResolveForgeProjectForAriadneOutput,
} from "@theforge/shared-types";
import { PrismaService } from "../../prisma/prisma.service.js";
import { getRequestUserId } from "../../common/request-user.store.js";
import type { AriadneListedProject } from "./ariadne-mcp-scope.util.js";
import { resolveAriadneCodebaseMcpTarget } from "./ariadne-mcp-scope.util.js";
import {
  normalizeGitRemoteUrl,
  normalizeProjectKey,
  normalizeRepoSlug,
} from "./normalize-git-remote.util.js";
import {
  pickForgeProjectResolution,
  type ForgeProjectLinkRow,
} from "./resolve-forge-project-for-ariadne.util.js";

@Injectable()
export class ProjectAriadneLinkService {
  private readonly logger = new Logger(ProjectAriadneLinkService.name);

  constructor(private readonly prisma: PrismaService) {}

  async resolve(body: unknown): Promise<ResolveForgeProjectForAriadneOutput> {
    const input = resolveForgeProjectForAriadneInputSchema.parse(body ?? {});
    const rows = await this.loadCandidateRows();
    const stagesByProject = await this.loadStagesByProject(rows.map((r) => r.projectId));
    const picked = pickForgeProjectResolution(input, rows, stagesByProject);

    if (picked.kind === "none") {
      throw new NotFoundException({
        error: "not_found",
        message: "No hay proyecto Forge vinculado a esos identificadores Ariadne",
      });
    }

    if (picked.kind === "ambiguous") {
      const payload: ResolveForgeProjectAmbiguousResponse = {
        error: "ambiguous",
        message: "Varios proyectos Forge coinciden; elige uno en Ariadne",
        candidates: picked.candidates,
        warnings: picked.warnings.length ? picked.warnings : undefined,
      };
      throw new ConflictException(payload);
    }

    return picked.result;
  }

  /**
   * Crea o actualiza el enlace primario al dar de alta brownfield o importar parity/handoff.
   */
  async upsertPrimaryFromBrownfield(input: {
    forgeProjectId: string;
    ariadneSourceId: string;
    catalog?: AriadneListedProject[] | null;
    gitRemote?: string | null;
    projectKey?: string | null;
    repoSlug?: string | null;
  }): Promise<void> {
    const forgeProjectId = input.forgeProjectId.trim();
    const sourceId = input.ariadneSourceId.trim();
    if (!forgeProjectId || !sourceId) return;

    const resolved = resolveAriadneCodebaseMcpTarget(sourceId, input.catalog ?? []);
    const ariadneProjectId = resolved.workspaceProjectId || null;
    const ariadneRepositoryId =
      resolved.scopeForScopedTools?.repoIds?.[0] ??
      (sourceId !== ariadneProjectId ? sourceId : resolved.graphProjectId) ??
      null;

    await this.prisma.$transaction(async (tx) => {
      await tx.projectAriadneLink.updateMany({
        where: { projectId: forgeProjectId, isPrimary: true },
        data: { isPrimary: false },
      });

      const existing = await tx.projectAriadneLink.findFirst({
        where: {
          projectId: forgeProjectId,
          OR: [
            ariadneRepositoryId ? { ariadneRepositoryId } : undefined,
            ariadneProjectId ? { ariadneProjectId } : undefined,
          ].filter(Boolean) as Array<{ ariadneRepositoryId?: string; ariadneProjectId?: string }>,
        },
      });

      const data = {
        ariadneProjectId,
        ariadneRepositoryId,
        gitRemote: normalizeGitRemoteUrl(input.gitRemote),
        projectKey: normalizeProjectKey(input.projectKey),
        repoSlug: normalizeRepoSlug(input.repoSlug),
        isPrimary: true,
      };

      if (existing) {
        await tx.projectAriadneLink.update({ where: { id: existing.id }, data });
      } else {
        await tx.projectAriadneLink.create({
          data: { projectId: forgeProjectId, ...data },
        });
      }
    });

    this.logger.log(
      `[AriadneLink] primary upsert forge=${forgeProjectId} workspace=${ariadneProjectId ?? "?"} repo=${ariadneRepositoryId ?? "?"}`,
    );
  }

  /**
   * Candidatos de resolución: solo proyectos propios del solicitante o `SHARED`. Sin este filtro la
   * resolución (y los `candidates[]` del 409) expondrían nombres y ids de proyectos PRIVATE ajenos.
   */
  private async loadCandidateRows(): Promise<ForgeProjectLinkRow[]> {
    const actor = getRequestUserId();
    const visibleToActor = { OR: [{ userId: actor }, { visibility: "SHARED" as const }] };
    const [links, projectsWithTheforgeId] = await Promise.all([
      this.prisma.projectAriadneLink.findMany({
        where: { project: { archivedAt: null, ...visibleToActor } },
        include: { project: { select: { id: true, name: true, theforgeProjectId: true } } },
      }),
      this.prisma.project.findMany({
        where: { archivedAt: null, theforgeProjectId: { not: null }, ...visibleToActor },
        select: { id: true, name: true, theforgeProjectId: true },
      }),
    ]);

    const rows: ForgeProjectLinkRow[] = links.map((link) => ({
      projectId: link.projectId,
      projectName: link.project.name,
      theforgeProjectId: link.project.theforgeProjectId,
      linkId: link.id,
      ariadneProjectId: link.ariadneProjectId,
      ariadneRepositoryId: link.ariadneRepositoryId,
      gitRemote: link.gitRemote,
      projectKey: link.projectKey,
      repoSlug: link.repoSlug,
      isPrimary: link.isPrimary,
    }));

    for (const project of projectsWithTheforgeId) {
      const tfId = project.theforgeProjectId?.trim();
      if (!tfId) continue;
      const already = rows.some((r) => r.projectId === project.id);
      if (already) continue;
      rows.push({
        projectId: project.id,
        projectName: project.name,
        theforgeProjectId: tfId,
        linkId: null,
        ariadneProjectId: null,
        ariadneRepositoryId: null,
        gitRemote: null,
        projectKey: null,
        repoSlug: null,
        isPrimary: true,
      });
    }

    for (const project of projectsWithTheforgeId) {
      const tfId = project.theforgeProjectId?.trim();
      if (!tfId) continue;
      const idx = rows.findIndex((r) => r.projectId === project.id);
      if (idx === -1) continue;
      const row = rows[idx]!;
      if (!row.ariadneRepositoryId && tfId) {
        row.ariadneRepositoryId = tfId;
      }
      if (!row.ariadneProjectId && tfId) {
        row.ariadneProjectId = tfId;
      }
    }

    return rows;
  }

  private async loadStagesByProject(projectIds: string[]) {
    const map = new Map<string, { id: string; name: string; workflowStatus: string }[]>();
    if (!projectIds.length) return map;
    const stages = await this.prisma.stage.findMany({
      where: { projectId: { in: projectIds } },
      select: { id: true, name: true, workflowStatus: true, projectId: true },
      orderBy: { ordinal: "asc" },
    });
    for (const stage of stages) {
      const list = map.get(stage.projectId) ?? [];
      list.push({
        id: stage.id,
        name: stage.name ?? `Etapa ${list.length + 1}`,
        workflowStatus: stage.workflowStatus,
      });
      map.set(stage.projectId, list);
    }
    return map;
  }
}
