import { Module } from "@nestjs/common";
import { DesignContractService } from "./design-contract.service.js";
import { DesignFirstController } from "./design-first.controller.js";
import { DesignSpecReader, DesignSpecService } from "./design-spec.service.js";

@Module({
  controllers: [DesignFirstController],
  providers: [DesignSpecReader, DesignSpecService, DesignContractService],
  exports: [DesignSpecReader, DesignSpecService, DesignContractService],
})
export class DesignFirstModule {}
