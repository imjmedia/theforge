import { Module } from "@nestjs/common";
import { ConformanceService } from "./conformance.service.js";
import { CostCalculatorService } from "./cost-calculator.service.js";
import { SemaphoreService } from "./semaphore.service.js";
import { MddUpdatePipelineService } from "./mdd-update-pipeline.service.js";
import { DocumentEngineService } from "./document-engine.service.js";
import { MddCoherenceModule } from "./mdd-coherence/mdd-coherence.module.js";
import { EstimationModule } from "../ai-analysis/estimation/estimation.module.js";

@Module({
  // EstimationModule: MddUpdatePipelineService calcula el semáforo con EstimationService (escritor único de Stage.status).
  imports: [MddCoherenceModule, EstimationModule],
  providers: [CostCalculatorService, SemaphoreService, ConformanceService, MddUpdatePipelineService, DocumentEngineService],
  exports: [CostCalculatorService, SemaphoreService, ConformanceService, MddUpdatePipelineService, DocumentEngineService, MddCoherenceModule],
})
export class EngineModule { }