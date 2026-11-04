import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import { BadRequestException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { EMPTY_DESIGN_SPEC } from "@theforge/shared-types";
import { FigmaImportService } from "./figma-import.service.js";
import { DesignProposalService } from "../design-first/design-proposal.service.js";
import type { FigmaCredentialService } from "./figma-credential.service.js";
import type { FigmaClient } from "./figma.client.js";

const fixtureDir = join(dirname(fileURLToPath(import.meta.url)), "__fixtures__");
const fileBody = readFileSync(join(fixtureDir, "file-response.json"), "utf8");

describe("figma-import.service", () => {
  it("CL-02: URL inválida → ERR_FIGMA_URL", async () => {
    const config = { get: () => true } as ConfigService;
    const svc = new FigmaImportService(
      config,
      { requireDecryptedToken: async () => "tok" } as unknown as FigmaCredentialService,
      {} as FigmaClient,
      {} as DesignProposalService,
    );
    await assert.rejects(
      () => svc.importForProject("p1", { fileUrl: "https://evil.test/x" }, "u1"),
      (e: unknown) => {
        assert.ok(e instanceof BadRequestException);
        assert.equal((e.getResponse() as { code?: string }).code, "ERR_FIGMA_URL");
        return true;
      },
    );
  });

  it("importa fixture y crea propuesta", async () => {
    let proposalCalls = 0;
    const proposal = {
      importFromFigmaExtract: async () => {
        proposalCalls += 1;
        return { proposalId: "prop-1", revision: 0, expiresAt: "", diff: {}, issues: [] };
      },
    } as unknown as DesignProposalService;
    const client = {
      getFile: async () => JSON.parse(fileBody),
    } as unknown as FigmaClient;
    const config = {
      get: (key: string, def?: unknown) => {
        if (key === "DESIGN_FIRST_ENABLED") return true;
        if (key === "DESIGN_FIRST_FIGMA_MAX_NODES") return 5000;
        return def;
      },
    } as ConfigService;
    const svc = new FigmaImportService(
      config,
      { requireDecryptedToken: async () => "tok" } as unknown as FigmaCredentialService,
      client,
      proposal,
    );
    await svc.importForProject(
      "p1",
      { fileUrl: "https://www.figma.com/design/abcdefghijkl/Demo" },
      "u1",
    );
    assert.equal(proposalCalls, 1);
  });

  it("reimport sin cambios → diff vacío", async () => {
    const { readFileSync: read } = await import("node:fs");
    const { mapFigmaFileToScreens } = await import("./figma-to-screens.mapper.js");
    const file = JSON.parse(read(join(fixtureDir, "file-response.json"), "utf8"));
    const extracted = mapFigmaFileToScreens({ fileKey: "abcdefghijkl", file });

    const proposal = DesignProposalService.createForTest({
      env: { NODE_ENV: "test", DESIGN_FIRST_ENABLED: "true" },
    });

    const firstDiff = proposal.buildFigmaDiffAgainstSpec(EMPTY_DESIGN_SPEC, extracted);
    assert.ok(firstDiff.add.screens.length > 0);

    const persisted = {
      ...EMPTY_DESIGN_SPEC,
      screens: firstDiff.add.screens,
      navigation: firstDiff.add.navigation,
    };
    const secondDiff = proposal.buildFigmaDiffAgainstSpec(persisted, extracted);
    assert.equal(secondDiff.add.screens.length, 0);
    assert.equal(secondDiff.update.screens.length, 0);
  });
});
