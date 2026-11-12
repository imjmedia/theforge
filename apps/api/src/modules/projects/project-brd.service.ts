import { BadRequestException, Injectable } from "@nestjs/common";
import type { Stage } from "@theforge/database";
import type { Estimation } from "@theforge/database";
import { cleanDocumentContent } from "../sessions/document-content.util.js";
import { prependDocumentTimestamps } from "../engine/document-date-header.util.js";
import { AiService } from "../ai/ai.service.js";
import {
  brdGenerationErrorMessage,
  extractBrdFromLlmResponse,
  type BrdExtractFailure,
} from "../ai/utils/brd-extract.util.js";
import { validateBrdMermaidOutput } from "../ai/utils/brd-mermaid-validate.util.js";
import { truncateSourceDocForBrdPrompt } from "../ai/utils/dbga-prompt-context.util.js";
import {
  BRD_GENERATION_SYSTEM,
  buildBrdGenerationRetryReminder,
  buildBrdUserPrompt,
} from "../ai/prompts/brd-generation-prompt.js";
import { PrismaService } from "../../prisma/prisma.service.js";
import { loadAccessibleProjectWithStages } from "./project-access.util.js";
import { pickPrimaryStage } from "./stage-helpers.js";
import { StageSemaphoreSyncService } from "./stage-semaphore-sync.service.js";

type StageWithEst = Stage & { estimation: Estimation | null };

@Injectable()
export class ProjectBrdService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ai: AiService,
    private readonly stageSemaphoreSync: StageSemaphoreSyncService,
  ) {}

  /**
   * Genera BRD desde `Project.dbgaContent` (greenfield). LEGACY debe usar
   * `POST …/legacy/suggest-brd-from-codebase-doc`. (To-Be eliminado del sistema.)
   */
  async suggestBrdFromDbga(
    projectId: string,
    opts?: { stageId?: string | null },
  ): Promise<{ brdContent: string; stageId: string }> {
    const project = await loadAccessibleProjectWithStages(this.prisma, projectId);
    if (project.projectType === "LEGACY") {
      throw new BadRequestException(
        "En proyectos legacy usa POST …/legacy/suggest-brd-from-codebase-doc (documentación Ariadne).",
      );
    }
    const dbga = String(project.dbgaContent ?? "").trim();
    const phase0 = String(project.phase0SummaryContent ?? "").trim();
    const effectiveDbga = dbga.length >= 300 ? dbga : phase0;
    if (effectiveDbga.length < 300) {
      throw new BadRequestException(
        "Se requiere DBGA en el proyecto (mín. ~300 caracteres). Genera el benchmark en el Paso 0 o pégalo en el proyecto.",
      );
    }
    const sid = opts?.stageId?.trim();
    const stage: StageWithEst | undefined =
      (sid ? project.stages.find((s) => s.id === sid) : undefined) ??
      pickPrimaryStage(project.stages as StageWithEst[]);
    if (!stage?.id) {
      throw new BadRequestException("No hay etapa para persistir BRD.");
    }
    const { text: dbgaForPrompt, truncated: dbgaTruncated } = truncateSourceDocForBrdPrompt(effectiveDbga);

    const brdPromptBase = buildBrdUserPrompt({
      mode: "greenfield-from-dbga",
      sourceLabel: "DBGA",
      sourceDocument: dbgaForPrompt,
    });

    let brd = "";
    let lastFailure: BrdExtractFailure = "no_delimiter";
    let lastMermaidHint = "";
    let lastRawLength = 0;
    for (let attempt = 1; attempt <= 2; attempt++) {
      const formatReminder =
        attempt > 1
          ? buildBrdGenerationRetryReminder({
              delimiterRetry: !lastMermaidHint,
              mermaidRetry: Boolean(lastMermaidHint),
              mermaidHint: lastMermaidHint || undefined,
            })
          : "";
      const raw = await this.ai.generateResponse(brdPromptBase + formatReminder, [], {
        systemPrompt: BRD_GENERATION_SYSTEM,
      });
      lastRawLength = (raw ?? "").length;
      const extracted = extractBrdFromLlmResponse(raw ?? "");
      if (!extracted.ok) {
        lastFailure = extracted.failure;
        lastMermaidHint = "";
        if (attempt < 2) {
          console.warn(
            `[suggestBrdFromDbga] Intento BRD ${attempt}/2: ${extracted.failure} (raw ~${lastRawLength} chars), reintentando...`,
          );
        }
        continue;
      }
      const mermaidVal = validateBrdMermaidOutput(extracted.content);
      if (!mermaidVal.ok) {
        lastMermaidHint = mermaidVal.hint;
        if (attempt < 2) {
          console.warn(
            `[suggestBrdFromDbga] Intento BRD ${attempt}/2: Mermaid inválido (${mermaidVal.hint}), reintentando...`,
          );
        }
        continue;
      }
      brd = cleanDocumentContent(extracted.content);
      break;
    }
    if (!brd) {
      throw new BadRequestException(
        brdGenerationErrorMessage(lastFailure, {
          dbgaTruncated,
          rawLength: lastRawLength,
        }) +
          (lastMermaidHint ? ` Diagramas §4: ${lastMermaidHint}.` : ""),
      );
    }

    await this.prisma.stage.update({
      where: { id: stage.id },
      data: { brdContent: prependDocumentTimestamps(brd) },
    });
    await this.stageSemaphoreSync.syncFromPersisted(projectId, stage.id, { reason: "brd-from-dbga" });
    return { brdContent: brd, stageId: stage.id };
  }
}
