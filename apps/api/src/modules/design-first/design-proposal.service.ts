import { Injectable, Logger, OnModuleDestroy } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { ChatImagePart } from "@theforge/shared-types";
import {
  parseDesignSpec,
  validateDesignSpecI1,
  type DesignSpec,
  type DesignSpecDataNeedsEntry,
  type DesignSpecNavigation,
  type DesignSpecScreen,
} from "@theforge/shared-types";
import { randomUUID } from "node:crypto";
import { connectIoredisReady } from "../../common/redis/connect-ioredis-ready.js";
import {
  DEFAULT_DESIGN_FIRST_MAX_IMAGES,
  DEFAULT_DESIGN_FIRST_VISION_BUDGET_MS,
} from "../../config/env.schema.js";
import { AiService } from "../ai/ai.service.js";
import { parseDesignFirstImageAttachments, resolveImportScreenIdAndRoute } from "../ai/utils/design-screen-extract.util.js";
import {
  buildHeuristicDataNeeds,
  listDataNeedsGaps,
  mergeDataNeedsByScreen,
} from "./data-needs-heuristic.util.js";
import { collectDataNeedsQualityIssues } from "../ai/utils/design-data-needs.util.js";
import { isDesignFirstEnabled } from "./design-first.config.js";
import {
  throwDesignFirstWritesDisabled,
  throwDesignInvariantIssues,
  throwDesignProposalExpired,
  throwDesignProposalNotFound,
  throwDesignRevisionConflict,
} from "./design-first.errors.js";
import { DesignSpecReader, DesignSpecService } from "./design-spec.service.js";
import type { AuthRedisClient } from "../auth/auth-redis.store.js";

type ProposalRedisClient = AuthRedisClient & {
  get: (key: string) => Promise<string | null>;
};

/** TTL de propuestas HITL en Redis (24 h). */
export const DESIGN_PROPOSAL_TTL_SECONDS = 86_400;

export type DesignProposalDiff = {
  add: { screens: DesignSpecScreen[]; navigation: DesignSpecNavigation[] };
  update: { screens: DesignSpecScreen[]; navigation: DesignSpecNavigation[] };
  remove: { screenIds: string[]; navigationIds: string[] };
  /** Propuesta de dataNeeds (lista completa propuesta). */
  dataNeeds?: DesignSpecDataNeedsEntry[];
};

export type DesignProposalKind = "screens" | "dataNeeds";

export type StoredDesignProposal = {
  proposalId: string;
  projectId: string;
  stageId: string;
  baseRevision: number;
  kind: DesignProposalKind;
  createdAt: string;
  expiresAt: string;
  diff: DesignProposalDiff;
  issues: string[];
};

export type ImportDesignImagesBody = {
  images: ChatImagePart[];
  hint?: string;
};

export type AcceptDesignProposalBody = {
  revision: number;
};

type MemEntry = { json: string; expiresAt: number };

type StoreOptions = {
  redis?: ProposalRedisClient | null;
  env?: Record<string, string | boolean | undefined>;
  now?: () => number;
};

function proposalKey(projectId: string, proposalId: string): string {
  return `design-first:proposal:${projectId}:${proposalId}`;
}

@Injectable()
export class DesignProposalService implements OnModuleDestroy {
  private readonly logger = new Logger(DesignProposalService.name);
  private now: () => number = () => Date.now();
  private redis: ProposalRedisClient | null = null;
  private redisInit: Promise<ProposalRedisClient> | null = null;
  private readonly mem = new Map<string, MemEntry>();

  constructor(
    private readonly config: ConfigService,
    private readonly ai: AiService,
    private readonly reader: DesignSpecReader,
    private readonly designSpec: DesignSpecService,
  ) {}

  static createForTest(options: StoreOptions = {}): DesignProposalService {
    const env = options.env ?? { NODE_ENV: "test" };
    const config = {
      get: (key: string, def?: unknown) => {
        if (key === "DESIGN_FIRST_ENABLED") {
          return env.DESIGN_FIRST_ENABLED === true || env.DESIGN_FIRST_ENABLED === "true";
        }
        if (key === "DESIGN_FIRST_MAX_IMAGES") {
          return Number(env.DESIGN_FIRST_MAX_IMAGES ?? DEFAULT_DESIGN_FIRST_MAX_IMAGES);
        }
        if (key === "DESIGN_FIRST_VISION_BUDGET_MS") {
          return Number(env.DESIGN_FIRST_VISION_BUDGET_MS ?? DEFAULT_DESIGN_FIRST_VISION_BUDGET_MS);
        }
        if (key === "DESIGN_FIRST_DATANEEDS_BUDGET_MS") {
          return Number(env.DESIGN_FIRST_DATANEEDS_BUDGET_MS ?? 120_000);
        }
        if (key === "NODE_ENV") return env.NODE_ENV ?? "test";
        if (key === "REDIS_URL") return env.REDIS_URL;
        return def;
      },
    } as unknown as ConfigService;
    const svc = new DesignProposalService(config, {} as AiService, {} as DesignSpecReader, {} as DesignSpecService);
    if (options.now) svc.now = options.now;
    if (options.redis !== undefined) svc.redis = options.redis;
    return svc;
  }

  /** Tests: inyecta dependencias reales tras createForTest. */
  bindForTest(deps: {
    ai: AiService;
    reader: DesignSpecReader;
    designSpec: DesignSpecService;
  }): void {
    const self = this as unknown as {
      ai: AiService;
      reader: DesignSpecReader;
      designSpec: DesignSpecService;
    };
    self.ai = deps.ai;
    self.reader = deps.reader;
    self.designSpec = deps.designSpec;
  }

  async onModuleDestroy(): Promise<void> {
    const r = this.redis;
    this.redis = null;
    this.redisInit = null;
    if (r) await Promise.resolve(r.quit?.()).catch(() => r.disconnect?.());
  }

  private maxImages(): number {
    return this.config.get<number>("DESIGN_FIRST_MAX_IMAGES", DEFAULT_DESIGN_FIRST_MAX_IMAGES);
  }

  private dataNeedsBudgetMs(): number {
    return this.config.get<number>("DESIGN_FIRST_DATANEEDS_BUDGET_MS", 120_000);
  }

  private visionBudgetMs(): number {
    return this.config.get<number>("DESIGN_FIRST_VISION_BUDGET_MS", DEFAULT_DESIGN_FIRST_VISION_BUDGET_MS);
  }

  private assertWritesAllowed(): void {
    if (!isDesignFirstEnabled(this.config)) {
      throwDesignFirstWritesDisabled();
    }
  }

  private async getRedis(): Promise<ProposalRedisClient | null> {
    if (this.redis) return this.redis;
    const url = this.config.get<string>("REDIS_URL");
    const nodeEnv = this.config.get<string>("NODE_ENV", "development");
    if (!url) {
      if (nodeEnv === "production") {
        throw new Error("REDIS_URL requerido para propuestas Design-First en producción");
      }
      return null;
    }
    if (!this.redisInit) {
      this.redisInit = connectIoredisReady<ProposalRedisClient>(url, {
        name: "DesignProposalService",
      }).then((client) => {
        this.redis = client;
        return client;
      });
    }
    return this.redisInit;
  }

  private async redisSet(key: string, value: string, ttlSec: number): Promise<void> {
    const redis = await this.getRedis();
    if (!redis) {
      this.mem.set(key, { json: value, expiresAt: this.now() + ttlSec * 1000 });
      return;
    }
    await redis.set(key, value, "EX", ttlSec);
  }

  private async redisGet(key: string): Promise<string | null> {
    const redis = await this.getRedis();
    if (!redis) {
      const row = this.mem.get(key);
      if (!row) return null;
      if (row.expiresAt <= this.now()) {
        this.mem.delete(key);
        return null;
      }
      return row.json;
    }
    const raw = await redis.get(key);
    return typeof raw === "string" ? raw : null;
  }

  private async redisDel(key: string): Promise<void> {
    const redis = await this.getRedis();
    if (!redis) {
      this.mem.delete(key);
      return;
    }
    await redis.del(key);
  }

  buildDiffAgainstSpec(
    current: DesignSpec,
    extracted: { screens: DesignSpecScreen[]; navigation: DesignSpecNavigation[] },
  ): DesignProposalDiff {
    const usedIds = new Set(current.screens.map((s) => s.id));
    const usedRoutes = new Set(current.screens.map((s) => s.route));
    const addScreens: DesignSpecScreen[] = [];
    const idMap = new Map<string, string>();

    for (const screen of extracted.screens) {
      const baseId = screen.id;
      const baseRoute = screen.route;
      const resolved = resolveImportScreenIdAndRoute(baseId, baseRoute, usedIds, usedRoutes);
      idMap.set(screen.id, resolved.id);
      addScreens.push({
        ...screen,
        id: resolved.id,
        route: resolved.route,
        components: screen.components.map((c, i) => ({
          ...c,
          id: `${resolved.id}-c${i + 1}`,
        })),
      });
    }

    const addNavigation: DesignSpecNavigation[] = [];
    for (const edge of extracted.navigation) {
      const from = idMap.get(edge.from) ?? edge.from;
      const to = idMap.get(edge.to) ?? edge.to;
      addNavigation.push({ ...edge, from, to });
    }

    return {
      add: { screens: addScreens, navigation: addNavigation },
      update: { screens: [], navigation: [] },
      remove: { screenIds: [], navigationIds: [] },
    };
  }

  async importFromImages(
    projectId: string,
    body: unknown,
    stageId?: string | null,
  ): Promise<{
    proposalId: string;
    revision: number;
    expiresAt: string;
    diff: DesignProposalDiff;
    issues: string[];
  }> {
    this.assertWritesAllowed();
    const { stage } = await this.reader.loadPrimaryStage(projectId, stageId);

    const parsed = body as { images?: unknown; hint?: unknown };
    const images = parseDesignFirstImageAttachments(parsed.images, this.maxImages());
    const hint = typeof parsed.hint === "string" ? parsed.hint : undefined;

    let extract;
    try {
      extract = await this.ai.extractScreenSpecFromImages({
        projectId,
        stageId: stage.id,
        images,
        hint,
        deadlineMs: this.visionBudgetMs(),
      });
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        this.logger.warn(`importFromImages abortado projectId=${projectId}`);
        throw err;
      }
      throw err;
    }

    const current = parseDesignSpec(stage.designSpec ?? { schemaVersion: 1, entities: [], screens: [], navigation: [], dataNeeds: [] });
    const diff = this.buildDiffAgainstSpec(current, extract);

    const proposalId = randomUUID();
    const createdAt = new Date(this.now()).toISOString();
    const expiresAt = new Date(this.now() + DESIGN_PROPOSAL_TTL_SECONDS * 1000).toISOString();
    const stored: StoredDesignProposal = {
      proposalId,
      projectId,
      stageId: stage.id,
      baseRevision: stage.designSpecRevision,
      kind: "screens",
      createdAt,
      expiresAt,
      diff,
      issues: extract.issues,
    };

    await this.redisSet(proposalKey(projectId, proposalId), JSON.stringify(stored), DESIGN_PROPOSAL_TTL_SECONDS);

    return {
      proposalId,
      revision: stage.designSpecRevision,
      expiresAt,
      diff,
      issues: extract.issues,
    };
  }

  async proposeDataNeeds(
    projectId: string,
    stageId?: string | null,
  ): Promise<{
    proposalId: string;
    revision: number;
    expiresAt: string;
    diff: DesignProposalDiff;
    issues: string[];
  }> {
    this.assertWritesAllowed();
    const { stage } = await this.reader.loadPrimaryStage(projectId, stageId);
    const current = parseDesignSpec(stage.designSpec ?? { schemaVersion: 1, entities: [], screens: [], navigation: [], dataNeeds: [] });

    const heuristicPatch = buildHeuristicDataNeeds(current);
    const afterHeuristic = mergeDataNeedsByScreen(current.dataNeeds, heuristicPatch);
    const gaps = listDataNeedsGaps(current, afterHeuristic);

    let llmIssues: string[] = [];
    let llmPatch: DesignSpecDataNeedsEntry[] = [];
    if (gaps.length > 0) {
      try {
        const llm = await this.ai.proposeDataNeeds({
          projectId,
          stageId: stage.id,
          spec: current,
          gaps,
          deadlineMs: this.dataNeedsBudgetMs(),
        });
        llmIssues = llm.issues;
        llmPatch = llm.entries;
      } catch (err) {
        if (err instanceof Error && err.name === "AbortError") {
          this.logger.warn(`proposeDataNeeds abortado projectId=${projectId}`);
          throw err;
        }
        throw err;
      }
    }

    const proposed = mergeDataNeedsByScreen(afterHeuristic, llmPatch);
    const qualityIssues = collectDataNeedsQualityIssues(proposed);
    const issues = [...llmIssues, ...qualityIssues];

    const diff: DesignProposalDiff = {
      add: { screens: [], navigation: [] },
      update: { screens: [], navigation: [] },
      remove: { screenIds: [], navigationIds: [] },
      dataNeeds: proposed,
    };

    const proposalId = randomUUID();
    const createdAt = new Date(this.now()).toISOString();
    const expiresAt = new Date(this.now() + DESIGN_PROPOSAL_TTL_SECONDS * 1000).toISOString();
    const stored: StoredDesignProposal = {
      proposalId,
      projectId,
      stageId: stage.id,
      baseRevision: stage.designSpecRevision,
      kind: "dataNeeds",
      createdAt,
      expiresAt,
      diff,
      issues,
    };

    await this.redisSet(proposalKey(projectId, proposalId), JSON.stringify(stored), DESIGN_PROPOSAL_TTL_SECONDS);

    return {
      proposalId,
      revision: stage.designSpecRevision,
      expiresAt,
      diff: { ...diff, dataNeeds: proposed },
      issues,
    };
  }

  private async loadProposal(projectId: string, proposalId: string): Promise<StoredDesignProposal> {
    const raw = await this.redisGet(proposalKey(projectId, proposalId));
    if (!raw) {
      throwDesignProposalExpired();
    }
    try {
      return JSON.parse(raw) as StoredDesignProposal;
    } catch {
      throwDesignProposalNotFound();
    }
  }

  private applyDiff(spec: DesignSpec, diff: DesignProposalDiff): DesignSpec {
    let screens = [...spec.screens];
    let navigation = [...spec.navigation];

    if (diff.remove.screenIds.length) {
      const removed = new Set(diff.remove.screenIds);
      screens = screens.filter((s) => !removed.has(s.id));
      navigation = navigation.filter((n) => !diff.remove.navigationIds.includes(n.id));
    }

    for (const updated of diff.update.screens) {
      const idx = screens.findIndex((s) => s.id === updated.id);
      if (idx >= 0) screens[idx] = updated;
      else screens.push(updated);
    }
    navigation = [
      ...navigation.filter((n) => !diff.update.navigation.some((u) => u.id === n.id)),
      ...diff.update.navigation,
    ];

    screens = [...screens, ...diff.add.screens];
    navigation = [...navigation, ...diff.add.navigation];

    return { ...spec, screens, navigation };
  }

  async acceptProposal(
    projectId: string,
    proposalId: string,
    body: AcceptDesignProposalBody,
    stageId?: string | null,
  ) {
    this.assertWritesAllowed();
    const proposal = await this.loadProposal(projectId, proposalId);
    const { stage } = await this.reader.loadPrimaryStage(projectId, stageId);

    if (body.revision !== stage.designSpecRevision) {
      throwDesignRevisionConflict(stage.designSpecRevision);
    }
    if (proposal.baseRevision !== stage.designSpecRevision) {
      throwDesignRevisionConflict(stage.designSpecRevision);
    }

    const current = parseDesignSpec(stage.designSpec ?? { schemaVersion: 1, entities: [], screens: [], navigation: [], dataNeeds: [] });

    if (proposal.kind === "dataNeeds" && proposal.diff.dataNeeds) {
      const result = await this.designSpec.updateDataNeeds(
        projectId,
        {
          revision: body.revision,
          entities: current.entities,
          dataNeeds: proposal.diff.dataNeeds,
        },
        stage.id,
      );
      await this.redisDel(proposalKey(projectId, proposalId));
      return result;
    }

    const nextSpec = this.applyDiff(current, proposal.diff);
    const i1 = validateDesignSpecI1(nextSpec);
    if (i1.length) throwDesignInvariantIssues(i1);

    const putBody = {
      revision: body.revision,
      screens: nextSpec.screens,
      navigation: nextSpec.navigation,
    };

    const result = await this.designSpec.updateScreens(projectId, putBody, stage.id);
    await this.redisDel(proposalKey(projectId, proposalId));
    return result;
  }

  async rejectProposal(projectId: string, proposalId: string): Promise<{ ok: true }> {
    this.assertWritesAllowed();
    await this.loadProposal(projectId, proposalId);
    await this.redisDel(proposalKey(projectId, proposalId));
    return { ok: true };
  }
}
