import { Module, forwardRef } from "@nestjs/common";
import { AiModule } from "../ai/ai.module.js";
import { UiMcpModule } from "../ui-mcp/ui-mcp.module.js";
import { FigmaModule } from "../figma/figma.module.js";
import { DesignArtifactsService } from "./design-artifacts.service.js";
import { DesignContractService } from "./design-contract.service.js";
import { DesignFirstController } from "./design-first.controller.js";
import { DesignProposalService } from "./design-proposal.service.js";
import { DesignSpecReader, DesignSpecService } from "./design-spec.service.js";

@Module({
  imports: [AiModule, UiMcpModule, forwardRef(() => FigmaModule)],
  controllers: [DesignFirstController],
  providers: [
    DesignSpecReader,
    DesignSpecService,
    DesignContractService,
    DesignProposalService,
    DesignArtifactsService,
  ],
  exports: [
    DesignSpecReader,
    DesignSpecService,
    DesignContractService,
    DesignProposalService,
    DesignArtifactsService,
  ],
})
export class DesignFirstModule {}
