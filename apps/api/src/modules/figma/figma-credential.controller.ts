import { Body, Controller, Delete, Get, Put } from "@nestjs/common";
import { ProjectAccessExempt } from "../../common/access/project-scoped.decorator.js";
import { getRequestUserId } from "../../common/request-user.store.js";
import { FigmaCredentialService } from "./figma-credential.service.js";

type PutFigmaCredentialBody = {
  token?: unknown;
};

@ProjectAccessExempt("Credencial Figma del usuario autenticado (sin proyecto)")
@Controller("me/integrations/figma")
export class FigmaCredentialController {
  constructor(private readonly credentials: FigmaCredentialService) {}

  @Get()
  getStatus() {
    return this.credentials.getStatus(getRequestUserId());
  }

  @Put()
  putToken(@Body() body: PutFigmaCredentialBody) {
    const token = typeof body.token === "string" ? body.token : "";
    return this.credentials.upsertToken(getRequestUserId(), token);
  }

  @Delete()
  deleteToken() {
    return this.credentials.deleteCredential(getRequestUserId());
  }
}
