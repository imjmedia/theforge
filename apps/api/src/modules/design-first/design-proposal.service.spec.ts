import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { PayloadTooLargeException, ConflictException, GoneException } from "@nestjs/common";
import { METHOD_METADATA, PATH_METADATA } from "@nestjs/common/constants";
import { PROJECT_SCOPED_KEY } from "../../common/access/project-access.metadata.js";
import { DesignFirstController } from "./design-first.controller.js";
import {
  DesignProposalService,
  type StoredDesignProposal,
} from "./design-proposal.service.js";
import { parseDesignFirstImageAttachments, resolveImportScreenIdAndRoute } from "../ai/utils/design-screen-extract.util.js";
import { EMPTY_DESIGN_SPEC } from "@theforge/shared-types";
import type { AiService } from "../ai/ai.service.js";
import type { DesignSpecReader, DesignSpecService } from "./design-spec.service.js";

const tinyPngBase64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

describe("design-proposal.service", () => {
  it("CL-08: exceso de imágenes → 413 antes del LLM", () => {
    const many = Array.from({ length: 9 }, () => ({
      mimeType: "image/png",
      base64: tinyPngBase64,
    }));
    assert.throws(
      () => parseDesignFirstImageAttachments(many, 8),
      (e: unknown) => {
        assert.ok(e instanceof PayloadTooLargeException);
        const body = e.getResponse() as { code?: string };
        assert.equal(body.code, "ERR_DESIGN_IMAGES_TOO_LARGE");
        return true;
      },
    );
  });

  it("CL-08: imagen > 5MB → 413", () => {
    const big = Buffer.alloc(5 * 1024 * 1024 + 1).toString("base64");
    assert.throws(
      () =>
        parseDesignFirstImageAttachments([{ mimeType: "image/png", base64: big }], 8),
      (e: unknown) => e instanceof PayloadTooLargeException,
    );
  });

  it("CL-12: colisión de id/ruta aplica sufijo -2", () => {
    const usedIds = new Set<string>(["orders"]);
    const usedRoutes = new Set<string>(["/orders"]);
    const resolved = resolveImportScreenIdAndRoute("orders", "/orders", usedIds, usedRoutes);
    assert.equal(resolved.id, "orders-2");
    assert.equal(resolved.route, "/orders-2");
  });

  it("importFromImages no llama al LLM cuando hay demasiadas imágenes", async () => {
    let llmCalls = 0;
    const ai = {
      extractScreenSpecFromImages: async () => {
        llmCalls++;
        return { issues: [], screens: [], navigation: [] };
      },
    } as unknown as AiService;

    const reader = {
      loadPrimaryStage: async () => ({
        project: { projectType: "DESIGN_FIRST" },
        stage: {
          id: "st1",
          designSpecRevision: 0,
          designSpec: EMPTY_DESIGN_SPEC,
        },
      }),
    } as unknown as DesignSpecReader;

    const svc = DesignProposalService.createForTest({
      env: { NODE_ENV: "test", DESIGN_FIRST_ENABLED: "true" },
    });
    svc.bindForTest({ ai, reader, designSpec: {} as DesignSpecService });

    await assert.rejects(
      () =>
        svc.importFromImages("p1", {
          images: Array.from({ length: 9 }, () => ({ mimeType: "image/png", base64: tinyPngBase64 })),
        }),
      (e: unknown) => e instanceof PayloadTooLargeException,
    );
    assert.equal(llmCalls, 0);
  });

  it("accept con revisión vieja → 409 ERR_DESIGN_REVISION_CONFLICT", async () => {
    const stored: StoredDesignProposal = {
      proposalId: "prop-1",
      projectId: "p1",
      stageId: "st1",
      baseRevision: 0,
      kind: "screens",
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      diff: {
        add: { screens: [], navigation: [] },
        update: { screens: [], navigation: [] },
        remove: { screenIds: [], navigationIds: [] },
      },
      issues: [],
    };

    const memRedis = {
      eval: async () => null,
      set: async () => "OK",
      del: async () => 1,
      get: async () => JSON.stringify(stored),
    };

    const reader = {
      loadPrimaryStage: async () => ({
        project: { projectType: "DESIGN_FIRST" },
        stage: { id: "st1", designSpecRevision: 2, designSpec: EMPTY_DESIGN_SPEC },
      }),
    } as unknown as DesignSpecReader;

    const svc = DesignProposalService.createForTest({
      env: { NODE_ENV: "test", DESIGN_FIRST_ENABLED: "true" },
      redis: memRedis,
    });
    svc.bindForTest({
      ai: {} as AiService,
      reader,
      designSpec: { updateScreens: async () => ({}) } as unknown as DesignSpecService,
    });

    await assert.rejects(
      () => svc.acceptProposal("p1", "prop-1", { revision: 0 }),
      (e: unknown) => {
        assert.ok(e instanceof ConflictException);
        const body = e.getResponse() as { code?: string; currentRevision?: number };
        assert.equal(body.code, "ERR_DESIGN_REVISION_CONFLICT");
        assert.equal(body.currentRevision, 2);
        return true;
      },
    );
  });

  it("propuesta expirada → ERR_DESIGN_PROPOSAL_EXPIRED", async () => {
    const memRedis = {
      eval: async () => null,
      set: async () => "OK",
      del: async () => 1,
      get: async () => null,
    };
    const svc = DesignProposalService.createForTest({
      env: { NODE_ENV: "test", DESIGN_FIRST_ENABLED: "true" },
      redis: memRedis,
    });
    svc.bindForTest({
      ai: {} as AiService,
      reader: {} as DesignSpecReader,
      designSpec: {} as DesignSpecService,
    });

    await assert.rejects(
      () => svc.acceptProposal("p1", "missing", { revision: 0 }),
      (e: unknown) => {
        assert.ok(e instanceof GoneException);
        assert.equal((e.getResponse() as { code?: string }).code, "ERR_DESIGN_PROPOSAL_EXPIRED");
        return true;
      },
    );
  });

  it("CL-30: import/images exige nivel spend en el controller", () => {
    const handler = DesignFirstController.prototype.importImages;
    const level = Reflect.getMetadata(PROJECT_SCOPED_KEY, handler)?.[0]?.level;
    assert.equal(level, "spend");
    const path = Reflect.getMetadata(PATH_METADATA, handler);
    assert.equal(path, "import/images");
    const method = Reflect.getMetadata(METHOD_METADATA, handler);
    assert.equal(method, 1);
  });

  it("CL-30: import/figma exige nivel contribute", () => {
    const handler = DesignFirstController.prototype.importFigma;
    const level = Reflect.getMetadata(PROJECT_SCOPED_KEY, handler)?.[0]?.level;
    assert.equal(level, "contribute");
  });

  it("CL-29: MCP caído → warning y diff intacto", async () => {
    const uiMcp = {
      isActive: async () => true,
      resolveComponent: async () => {
        throw new Error("down");
      },
    };
    const svc = DesignProposalService.createForTest({
      env: { NODE_ENV: "test", DESIGN_FIRST_ENABLED: "true" },
    });
    (svc as unknown as { uiMcp: typeof uiMcp }).uiMcp = uiMcp;
    const issues: string[] = [];
    const enriched = await svc.enrichScreenComponents(
      [
        {
          id: "home",
          name: "Home",
          route: "/",
          roles: [],
          states: [],
          origin: { kind: "manual" },
          components: [{ id: "home-c1", component: "Button", label: "Go" }],
        },
      ],
      issues,
    );
    assert.equal(enriched[0]?.components[0]?.package, undefined);
    assert.ok(issues.some((i) => i.includes("MCP gráfico")));
  });

  it("CL-29: sin MCP configurado no llama resolve", async () => {
    const svc = DesignProposalService.createForTest({
      env: { NODE_ENV: "test", DESIGN_FIRST_ENABLED: "true" },
    });
    const issues: string[] = [];
    const enriched = await svc.enrichScreenComponents(
      [
        {
          id: "home",
          name: "Home",
          route: "/",
          roles: [],
          states: [],
          origin: { kind: "manual" },
          components: [{ id: "home-c1", component: "Button", label: "Go" }],
        },
      ],
      issues,
    );
    assert.equal(enriched.length, 1);
    assert.equal(issues.length, 0);
  });
});
