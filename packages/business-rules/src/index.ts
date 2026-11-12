/**
 * @fileoverview **@theforge/business-rules** — reglas puras de negocio: estimación de coste (MXN), estructura
 * de equipo, horas por endpoint/pantalla/entidad y utilidades de metadatos. Depende de tipos en `@theforge/shared-types`.
 *
 * @copyright 2026 Jorge Correa
 * @license Apache-2.0
 */
export {
  BUFFER_FACTOR_WHEN_NOT_VERDE,
  computeCostEstimation,
  getDefaultTeamStructure,
  HOURS_PER_ENDPOINT,
  HOURS_PER_ENTITY,
  HOURS_PER_SCREEN,
  KNOWN_METADATA_TAGS,
  METADATA_FIXED_HOURS,
  METADATA_MULTIPLIERS,
  RATES_MXN_PER_ROLE,
  RATE_MXN_PER_HOUR,
  type CostEstimationInput,
  type CostEstimationResult,
  type KnownMetadataTag,
} from "./cost-estimation.js";
export {
  allocateDeliveryRoleHours,
  buildDeliveryTeamStructure,
  payrollMxnFromRoleHours,
  ROLE_LABELS_ES,
} from "./team-delivery.js";
export { parseInfraFixedHours } from "./infra-fixed-hours.js";
export {
  estimateHighMddPipelineTokens,
  estimateHighMddTopModelCostMxn,
  highMddTopModelCostHintEs,
  HIGH_MDD_IA_REFERENCE,
} from "./mdd-ia-cost-reference.js";
export type { Status, TeamStructure } from "@theforge/shared-types";
export { countCostDrivers, type CostDriverCounts } from "./cost-drivers.js";
