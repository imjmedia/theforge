/**
 * @fileoverview Módulo FalkorDB desactivado.
 * Los servicios son stubs no-op; el módulo existe solo para compatibilidad.
 */
import { Module } from "@nestjs/common";
import { GraphMemoryService } from "./graph-memory.service.js";
import { SddGraphSyncService } from "./sdd-graph-sync.service.js";

@Module({
  providers: [GraphMemoryService, SddGraphSyncService],
  exports: [GraphMemoryService, SddGraphSyncService],
})
export class GraphMemoryModule {}