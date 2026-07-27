/**
 * @fileoverview Módulo FalkorDB desactivado.
 * Los servicios son stubs no-op; el módulo existe solo para compatibilidad.
 */
import { Module } from "@nestjs/common";
import { AiModule } from "../../ai/ai.module.js";
import { GraphMemoryService } from "./graph-memory.service.js";
import { SddGraphSyncService } from "./sdd-graph-sync.service.js";

@Module({
  imports: [AiModule],
  providers: [GraphMemoryService, SddGraphSyncService],
  exports: [GraphMemoryService, SddGraphSyncService],
})
export class GraphMemoryModule {}