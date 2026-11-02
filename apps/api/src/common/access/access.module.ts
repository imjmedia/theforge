import { Global, Module } from "@nestjs/common";
import { ProjectAccessService } from "./project-access.service.js";

/** Módulo global de autorización de proyectos (depende de `PrismaModule`, también global). */
@Global()
@Module({
  providers: [ProjectAccessService],
  exports: [ProjectAccessService],
})
export class AccessModule {}
