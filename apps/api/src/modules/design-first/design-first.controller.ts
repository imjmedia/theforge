import { Body, Controller, Get, Param, Post, Put } from "@nestjs/common";
import {
  compileDesignContractBodySchema,
  putDesignDataNeedsBodySchema,
  putDesignScreensBodySchema,
} from "@theforge/shared-types";
import { ProjectScoped } from "../../common/access/project-scoped.decorator.js";
import { DesignContractService } from "./design-contract.service.js";
import { DesignSpecService } from "./design-spec.service.js";

@Controller("projects/:id/design")
export class DesignFirstController {
  constructor(
    private readonly designSpec: DesignSpecService,
    private readonly designContract: DesignContractService,
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
}
