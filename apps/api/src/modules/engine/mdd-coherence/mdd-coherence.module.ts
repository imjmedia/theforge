import { Module } from "@nestjs/common";
import { MddCoherenceService } from "./mdd-coherence.service.js";

@Module({
  providers: [MddCoherenceService],
  exports: [MddCoherenceService],
})
export class MddCoherenceModule {}
