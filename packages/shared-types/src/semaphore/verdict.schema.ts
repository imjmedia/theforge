import { z } from "zod";

export const SemaphoreStatusSchema = z.enum(["red", "yellow", "green"]);
export type SemaphoreStatus = z.infer<typeof SemaphoreStatusSchema>;

export const CompletenessPhaseSchema = z.enum(["pre_cascade", "post_cascade"]);
export type CompletenessPhase = z.infer<typeof CompletenessPhaseSchema>;

export const DerivativesStateSchema = z.enum(["none", "partial", "complete"]);
export type DerivativesState = z.infer<typeof DerivativesStateSchema>;

export const SemaphoreHeadlineSourceSchema = z.enum(["auditor", "integral", "design_first_phases"]);
export type SemaphoreHeadlineSource = z.infer<typeof SemaphoreHeadlineSourceSchema>;

export const SemaphoreSourceSchema = z.enum(["persisted", "draft", "stream"]);
export type SemaphoreSource = z.infer<typeof SemaphoreSourceSchema>;

export const DeliverablesGateRuleSchema = z.enum(["high", "low_medium", "design_first", "legacy"]);
export type DeliverablesGateRule = z.infer<typeof DeliverablesGateRuleSchema>;

export const mddSemaphoreVerdictSchema = z.object({
  version: z.literal(1),
  status: SemaphoreStatusSchema,
  headline: z.number().min(0).max(100),
  headlineSource: SemaphoreHeadlineSourceSchema,
  integral: z.number().min(0).max(100).nullable(),
  components: z.object({
    completeness: z.number(),
    consistency: z.number().nullable(),
    mddQuality: z.number(),
  }),
  phase: CompletenessPhaseSchema,
  derivativesState: DerivativesStateSchema,
  reasons: z.array(z.string()),
  notes: z.array(z.string()),
  source: SemaphoreSourceSchema,
  deliverablesGate: z.object({
    allowed: z.boolean(),
    rule: DeliverablesGateRuleSchema,
    reasons: z.array(z.string()),
  }),
});

export type MddSemaphoreVerdict = z.infer<typeof mddSemaphoreVerdictSchema>;
