import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { DesignSpecNavigation, DesignSpecScreen } from "@theforge/shared-types";
import { getRequestUserId } from "../../common/request-user.store.js";
import { DesignProposalService } from "../design-first/design-proposal.service.js";
import { FigmaClient } from "./figma.client.js";
import { FigmaCredentialService } from "./figma-credential.service.js";
import { throwFigmaNoFrames, throwFigmaTooManyNodes, throwFigmaUrlInvalid } from "./figma.errors.js";
import { mapFigmaFileToScreens, type FigmaFileDocument } from "./figma-to-screens.mapper.js";
import { parseFigmaFileUrl } from "./figma-url.util.js";
import { isDesignFirstEnabled } from "../design-first/design-first.config.js";
import { throwDesignFirstWritesDisabled } from "../design-first/design-first.errors.js";

export type ImportFigmaBody = {
  fileUrl?: unknown;
  nodeIds?: unknown;
};

function countFigmaNodes(node: { children?: unknown[] } | undefined): number {
  if (!node) return 0;
  let count = 1;
  for (const child of node.children ?? []) {
    if (child && typeof child === "object") count += countFigmaNodes(child as { children?: unknown[] });
  }
  return count;
}

@Injectable()
export class FigmaImportService {
  constructor(
    private readonly config: ConfigService,
    private readonly credentials: FigmaCredentialService,
    private readonly figmaClient: FigmaClient,
    private readonly designProposal: DesignProposalService,
  ) {}

  async importForProject(projectId: string, body: ImportFigmaBody, userId = getRequestUserId()) {
    if (!isDesignFirstEnabled(this.config)) {
      throwDesignFirstWritesDisabled();
    }
    const fileUrl = typeof body.fileUrl === "string" ? body.fileUrl : "";
    const parsedUrl = parseFigmaFileUrl(fileUrl);
    if (!parsedUrl) throwFigmaUrlInvalid();

    const nodeIds = Array.isArray(body.nodeIds)
      ? body.nodeIds.filter((n): n is string => typeof n === "string" && n.trim().length > 0)
      : parsedUrl.nodeIdFromUrl
        ? [parsedUrl.nodeIdFromUrl]
        : undefined;

    const token = await this.credentials.requireDecryptedToken(userId);
    const raw = (await this.figmaClient.getFile(userId, token, parsedUrl.fileKey)) as FigmaFileDocument;
    const maxNodes = this.config.get<number>("DESIGN_FIRST_FIGMA_MAX_NODES", 5000);
    const totalNodes = countFigmaNodes(raw.document as { children?: unknown[] });
    if (totalNodes > maxNodes && !nodeIds?.length) {
      throwFigmaTooManyNodes(maxNodes, totalNodes);
    }

    const mapped = mapFigmaFileToScreens({
      fileKey: parsedUrl.fileKey,
      file: raw,
      nodeIds,
    });
    if (mapped.screens.length === 0) {
      throwFigmaNoFrames();
    }

    return this.designProposal.importFromFigmaExtract(projectId, {
      fileKey: parsedUrl.fileKey,
      screens: mapped.screens,
      navigation: mapped.navigation,
      issues: mapped.issues,
    });
  }
}

export type { DesignSpecScreen, DesignSpecNavigation };
