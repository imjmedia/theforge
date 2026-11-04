import { z } from "zod";

export const designFirstPhaseGateIssueSchema = z.object({
  path: z.string(),
  message: z.string(),
});

export const designFirstPhaseGateResultSchema = z.object({
  ok: z.boolean(),
  issues: z.array(designFirstPhaseGateIssueSchema),
});

export const designFirstPhaseGatesSchema = z.object({
  phase1: designFirstPhaseGateResultSchema,
  phase2: designFirstPhaseGateResultSchema,
  phase3: designFirstPhaseGateResultSchema,
});

export type DesignFirstPhaseGatesDto = z.infer<typeof designFirstPhaseGatesSchema>;
