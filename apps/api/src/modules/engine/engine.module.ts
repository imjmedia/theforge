import { Module } from "@nestjs/common";
import { ConformanceService } from "./conformance.service.js";
import { CostCalculatorService } from "./cost-calculator.service.js";
import { SemaphoreService } from "./semaphore.service.js";
import { MddUpdatePipelineService } from "./mdd-update-pipeline.service.js";
import { DocumentEngineService } from "./document-engine.service.js";
import { GraphMemoryModule } from "../ai-analysis/graph-memory/graph-memory.module.js";

@Module({
  imports: [GraphMemoryModule],
  providers: [CostCalculatorService, SemaphoreService, ConformanceService, MddUpdatePipelineService, DocumentEngineService],
  exports: [CostCalculatorService, SemaphoreService, ConformanceService, MddUpdatePipelineService, DocumentEngineService],
})
export class EngineModule { }