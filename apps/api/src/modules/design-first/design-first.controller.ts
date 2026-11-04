import { BadRequestException, Body, Controller, Get, Param, Post, Put } from "@nestjs/common";
import {
  compileDesignContractBodySchema,
  putDesignDataNeedsBodySchema,
  putDesignScreensBodySchema,
} from "@theforge/shared-types";
import { ProjectScoped } from "../../common/access/project-scoped.decorator.js";
import { DesignContractService } from "./design-contract.service.js";
import { DesignProposalService } from "./design-proposal.service.js";
import { DesignSpecService } from "./design-spec.service.js";
import { FigmaImportService } from "../figma/figma-import.service.js";

@Controller("projects/:id/design")
export class DesignFirstController {
  constructor(
    private readonly designSpec: DesignSpecService,
    private readonly designContract: DesignContractService,
    private readonly designProposal: DesignProposalService,
    private readonly figmaImport: FigmaImportService,
  ) {}

  @ProjectScoped("read")
  @Get()
  getDesign(@Param("id") projectId: string) {
    return this.designSpec.buildReadResponse(projectId);
  }

  @ProjectScoped("contribute")
  @Put("screens")
  putScreens(@Param("id") projectId: string, @Body() body: unknown) {
    const parsed = putDesignScreensBodySchema.parse(body);
    return this.designSpec.updateScreens(projectId, parsed);
  }

  @ProjectScoped("contribute")
  @Put("data-needs")
  putDataNeeds(@Param("id") projectId: string, @Body() body: unknown) {
    const parsed = putDesignDataNeedsBodySchema.parse(body);
    return this.designSpec.updateDataNeeds(projectId, parsed);
  }

  @ProjectScoped("contribute")
  @Post("compile-contract")
  compileContract(@Param("id") projectId: string, @Body() body: unknown) {
    const parsed = compileDesignContractBodySchema.parse(body);
    return this.designContract.compileContract(projectId, parsed);
  }

  @ProjectScoped("spend")
  @Post("data-needs/propose")
  proposeDataNeeds(@Param("id") projectId: string) {
    return this.designProposal.proposeDataNeeds(projectId);
  }

  @ProjectScoped("contribute")
  @Post("import/figma")
  importFigma(@Param("id") projectId: string, @Body() body: unknown) {
    return this.figmaImport.importForProject(projectId, body as { fileUrl?: unknown; nodeIds?: unknown });
  }

  @ProjectScoped("spend")
  @Post("import/images")
  importImages(@Param("id") projectId: string, @Body() body: unknown) {
    return this.designProposal.importFromImages(projectId, body);
  }

  @ProjectScoped("contribute")
  @Post("proposals/:pid/accept")
  acceptProposal(@Param("id") projectId: string, @Param("pid") proposalId: string, @Body() body: unknown) {
    const revision =
      body != null && typeof body === "object" && typeof (body as { revision?: unknown }).revision === "number"
        ? (body as { revision: number }).revision
        : NaN;
    if (!Number.isInteger(revision) || revision < 0) {
      throw new BadRequestException({ code: "ERR_DESIGN_INVALID_REVISION", message: "revision inválida" });
    }
    return this.designProposal.acceptProposal(projectId, proposalId, { revision });
  }

  @ProjectScoped("contribute")
  @Post("proposals/:pid/reject")
  rejectProposal(@Param("id") projectId: string, @Param("pid") proposalId: string) {
    return this.designProposal.rejectProposal(projectId, proposalId);
  }
}
