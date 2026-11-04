import type { ConfigService } from "@nestjs/config";
import { DEFAULT_DESIGN_FIRST_ENABLED } from "../../config/env.schema.js";

export function isDesignFirstEnabled(config: ConfigService): boolean {
  return config.get<boolean>("DESIGN_FIRST_ENABLED", DEFAULT_DESIGN_FIRST_ENABLED) === true;
}

export function designFirstMaxSpecBytes(config: ConfigService): number {
  return config.get<number>("DESIGN_FIRST_MAX_SPEC_BYTES", 524_288);
}
