import { createHash } from "node:crypto";
import { canonicalDesignSpecJson, type DesignSpec } from "./design-spec.js";

/** RNF-02: hash del JSON canónico (independiente del orden de claves). */
export function hashDesignSpec(spec: DesignSpec): string {
  return createHash("sha256").update(canonicalDesignSpecJson(spec), "utf8").digest("hex");
}
