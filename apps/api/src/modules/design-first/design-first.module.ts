import { Module } from "@nestjs/common";
import { AiModule } from "../ai/ai.module.js";
import { DesignContractService } from "./design-contract.service.js";
import { DesignFirstController } from "./design-first.controller.js";
import { DesignProposalService } from "./design-proposal.service.js";
import { DesignSpecReader, DesignSpecService } from "./design-spec.service.js";

@Module({
  imports: [AiModule],
  controllers: [DesignFirstController],
  providers: [DesignSpecReader, DesignSpecService, DesignContractService, DesignProposalService],
  exports: [DesignSpecReader, DesignSpecService, DesignContractService, DesignProposalService],
})
export class DesignFirstModule {}
