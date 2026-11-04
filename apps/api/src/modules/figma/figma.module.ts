import { Module, forwardRef } from "@nestjs/common";
import { PrismaModule } from "../../prisma/prisma.module.js";
import { CryptoModule } from "../crypto/crypto.module.js";
import { DesignFirstModule } from "../design-first/design-first.module.js";
import { FigmaClient } from "./figma.client.js";
import { FigmaCredentialController } from "./figma-credential.controller.js";
import { FigmaCredentialService } from "./figma-credential.service.js";
import { FigmaImportService } from "./figma-import.service.js";

@Module({
  imports: [PrismaModule, CryptoModule, forwardRef(() => DesignFirstModule)],
  controllers: [FigmaCredentialController],
  providers: [FigmaClient, FigmaCredentialService, FigmaImportService],
  exports: [FigmaImportService],
})
export class FigmaModule {}
