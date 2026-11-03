import { Global, Module } from "@nestjs/common";
import { MermaidRuntimeService } from "./mermaid-runtime.service.js";

/** Parser Mermaid en runtime (worker_thread aislado). */
@Global()
@Module({
  providers: [MermaidRuntimeService],
  exports: [MermaidRuntimeService],
})
export class MermaidOracleModule {}
