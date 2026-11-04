import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
  compileDataNeedsToPag,
  exportPagToOpenApiSpec,
  evaluateDesignFirstPhaseGates,
  parseDesignSpec,
  type CompileDesignContractBody,
} from "@theforge/shared-types";
import { hashDesignSpec } from "@theforge/shared-types/design-spec-hash.node";
import { PrismaService } from "../../prisma/prisma.service.js";
import { isDesignFirstEnabled } from "./design-first.config.js";
import {
  throwDesignFirstWritesDisabled,
  throwDesignPhaseGate,
  throwDesignRevisionConflict,
  throwOpenApiInvalid,
  throwPagCompileInvalid,
} from "./design-first.errors.js";
import { DesignSpecReader, DesignSpecService } from "./design-spec.service.js";
import { validateOpenApi31 } from "./openapi-validate.util.js";

@Injectable()
export class DesignContractService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly reader: DesignSpecReader,
    private readonly designSpecService: DesignSpecService,
  ) {}

  async compileContract(projectId: string, body: CompileDesignContractBody, stageId?: string | null) {
    if (!isDesignFirstEnabled(this.config)) {
      throwDesignFirstWritesDisabled();
    }
    const { project, stage } = await this.reader.loadPrimaryStage(projectId, stageId);
    if (body.revision !== stage.designSpecRevision) {
      throwDesignRevisionConflict(stage.designSpecRevision);
    }

    const designSpec = parseDesignSpec(stage.designSpec ?? { schemaVersion: 1, entities: [], screens: [], navigation: [], dataNeeds: [] });
    const gates = evaluateDesignFirstPhaseGates({ designSpec });
    if (!gates.phase2.ok) {
      throwDesignPhaseGate("Completa la fase 2 (datos) antes de compilar el contrato");
    }

    const compiled = compileDataNeedsToPag({ designSpec, projectName: project.name });
    if (!compiled.ok) {
      throwPagCompileInvalid(compiled.issues);
    }

    const openApi = exportPagToOpenApiSpec(compiled.pag);
    const openApiCheck = validateOpenApi31(openApi);
    if (!openApiCheck.ok) {
      throwOpenApiInvalid(openApiCheck.issues);
    }

    const designSpecHash = hashDesignSpec(designSpec);
    const result = await this.prisma.stage.updateMany({
      where: { id: stage.id, designSpecRevision: body.revision },
      data: {
        architectureGraph: compiled.pag as object,
        architectureGraphSourceHash: designSpecHash,
        designSpecRevision: { increment: 1 },
      },
    });
    if (result.count === 0) {
      const fresh = await this.prisma.stage.findUnique({
        where: { id: stage.id },
        select: { designSpecRevision: true },
      });
      throwDesignRevisionConflict(fresh?.designSpecRevision ?? body.revision);
    }

    return this.designSpecService.buildReadResponse(projectId, stage.id);
  }
}
