import { Injectable } from "@nestjs/common";
import { Status } from "@theforge/database";
import { countCostDrivers } from "@theforge/business-rules";
import { PrismaService } from "../../prisma/prisma.service.js";
import { CostCalculatorService, parseInfraFixedHours } from "../engine/cost-calculator.service.js";
import { extractTechnicalMetadataTags } from "../engine/mdd-markdown-parser.js";

/**
 * Responsabilidad única: recalcular estimación (horas, MXN, team structure) a partir
 * de MDD + contenido de infra y persistir en Estimation. Usado por ProjectsService
 * cuando cambia mddContent o infraContent (por etapa activa).
 */
@Injectable()
export class ProjectEstimationRecalcService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly costCalculator: CostCalculatorService,
  ) {}

  /**
   * Recalcula totalHours, totalMxn y teamStructure desde mddContent e infraContent
   * y hace upsert en Estimation para la etapa.
   */
  async recalcAndUpsert(
    stageId: string,
    params: {
      mddContent: string | null;
      infraContent: string | null;
      status: Status;
      /** Task count post-consolidación — evita heredar horas de generación parcial. */
      consolidatedTaskCount?: number | null;
    },
  ): Promise<void> {
    const { mddContent, infraContent, status, consolidatedTaskCount } = params;
    if (mddContent == null) return;

    let { entityCount, screenCount, extraEndpointCount } = countCostDrivers(mddContent);
    if (consolidatedTaskCount != null && consolidatedTaskCount > 0) {
      const floorFromTasks = Math.ceil(consolidatedTaskCount / 4);
      entityCount = Math.max(entityCount, floorFromTasks);
      const frontendFloor = Math.ceil(consolidatedTaskCount / 8);
      screenCount = Math.max(screenCount, frontendFloor);
    }
    const metadataTags = extractTechnicalMetadataTags(mddContent);
    const infraFixedHours = parseInfraFixedHours(infraContent);

    const { totalHours, totalMxn, teamStructure } = this.costCalculator.calculate({
      entityCount,
      screenCount,
      extraEndpointCount,
      metadataTags,
      infraFixedHours,
      status,
    });

    await this.prisma.estimation.upsert({
      where: { stageId },
      create: {
        stageId,
        totalHours,
        totalMxn,
        teamStructure: teamStructure as object,
      },
      update: {
        totalHours,
        totalMxn,
        teamStructure: teamStructure as object,
      },
    });
  }
}
