import { z } from "zod";
import {
  designSpecDataNeedsEntrySchema,
  designSpecEntitySchema,
  designSpecNavigationSchema,
  designSpecSchema,
  designSpecScreenSchema,
} from "./design-spec.js";
import { designFirstPhaseGatesSchema } from "./design-first-gates-api.js";

export const putDesignScreensBodySchema = z
  .object({
    revision: z.number().int().nonnegative(),
    cascade: z.boolean().optional(),
    screens: z.array(designSpecScreenSchema),
    navigation: z.array(designSpecNavigationSchema),
  })
  .strict();
export type PutDesignScreensBody = z.infer<typeof putDesignScreensBodySchema>;

export const putDesignDataNeedsBodySchema = z
  .object({
    revision: z.number().int().nonnegative(),
    entities: z.array(designSpecEntitySchema),
    dataNeeds: z.array(designSpecDataNeedsEntrySchema),
  })
  .strict();
export type PutDesignDataNeedsBody = z.infer<typeof putDesignDataNeedsBodySchema>;

export const compileDesignContractBodySchema = z
  .object({
    revision: z.number().int().nonnegative(),
  })
  .strict();
export type CompileDesignContractBody = z.infer<typeof compileDesignContractBodySchema>;

export const designReadResponseSchema = z.object({
  designSpec: designSpecSchema,
  revision: z.number().int().nonnegative(),
  gates: designFirstPhaseGatesSchema,
  designSpecHash: z.string(),
  architectureGraphSourceHash: z.string().nullable(),
  stale: z.boolean(),
});
export type DesignReadResponse = z.infer<typeof designReadResponseSchema>;
