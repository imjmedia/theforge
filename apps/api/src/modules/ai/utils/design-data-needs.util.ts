import type {
  DesignSpec,
  DesignSpecDataNeedsEntry,
} from "@theforge/shared-types";
import { designSpecDataNeedItemSchema } from "@theforge/shared-types";
import { z } from "zod";
import type { DataNeedsComponentGap } from "../../design-first/data-needs-heuristic.util.js";

type DesignSpecDataNeedItem = z.infer<typeof designSpecDataNeedItemSchema>;

export const designDataNeedsLlmOutputSchema = z.object({
  issues: z.array(z.string()).default([]),
  entries: z
    .array(
      z.object({
        screenId: z.string().min(1),
        componentId: z.string().min(1),
        needs: z.array(
          z.object({
            id: z.string().min(1),
            name: z.string().min(1),
            type: z.string().min(1),
            format: z.string().optional(),
            origin: z.enum(["entity", "derived", "input"]),
            action: z.string().min(1),
            required: z.boolean().optional(),
            many: z.boolean().optional(),
            endpointHint: z.string().optional(),
          }),
        ),
      }),
    )
    .default([]),
});

export type DesignDataNeedsLlmOutput = z.infer<typeof designDataNeedsLlmOutputSchema>;

export const DESIGN_DATA_NEEDS_SYSTEM_PROMPT = `Eres analista de datos de UI. Propón necesidades de datos (dataNeeds) SOLO para los componentes listados.
Reglas:
- No inventes pantallas ni componentes fuera de la lista.
- action debe ser el id de una entidad existente del designSpec.
- Responde en español en issues si hay ambigüedad.
- Cada need debe tener type no vacío.`;

export function buildDelimitedDataNeedsPrompt(
  spec: DesignSpec,
  gaps: DataNeedsComponentGap[],
): string {
  const entities = spec.entities.map((e) => `- ${e.id} (${e.name})`).join("\n") || "(sin entidades)";
  const gapLines = gaps
    .map(
      (g) =>
        `- screenId=${g.screenId} componentId=${g.componentId} type=${g.componentType}` +
        (g.label ? ` label=${g.label}` : ""),
    )
    .join("\n");
  return [
    "Entidades disponibles (solo usar estos ids en action):",
    "<<<ENTITIES",
    entities,
    "ENTITIES>>>",
    "",
    "Componentes sin needs (rellenar solo estos):",
    "<<<GAPS",
    gapLines || "(ninguno)",
    "GAPS>>>",
  ].join("\n");
}

function screenExists(spec: DesignSpec, screenId: string): boolean {
  return spec.screens.some((s) => s.id === screenId);
}

function componentExists(spec: DesignSpec, screenId: string, componentId: string): boolean {
  const screen = spec.screens.find((s) => s.id === screenId);
  return !!screen?.components.some((c) => c.id === componentId);
}

function entityExists(spec: DesignSpec, entityId: string): boolean {
  return spec.entities.some((e) => e.id === entityId);
}

/** Descarta needs del LLM que referencian pantalla/componente/entidad inexistentes. */
export function filterLlmDataNeedsAgainstSpec(
  spec: DesignSpec,
  raw: DesignDataNeedsLlmOutput,
): { entries: DesignSpecDataNeedsEntry[]; dropped: string[] } {
  const dropped: string[] = [];
  const grouped = new Map<string, DesignSpecDataNeedsEntry>();

  for (const row of raw.entries) {
    if (!screenExists(spec, row.screenId)) {
      dropped.push(`Pantalla desconocida ${row.screenId}`);
      continue;
    }
    if (!componentExists(spec, row.screenId, row.componentId)) {
      dropped.push(`Componente desconocido ${row.screenId}/${row.componentId}`);
      continue;
    }
    const needs: DesignSpecDataNeedItem[] = [];
    for (const n of row.needs) {
      if (!entityExists(spec, n.action)) {
        dropped.push(`Entidad desconocida en action=${n.action}`);
        continue;
      }
      const parsed = designSpecDataNeedItemSchema.safeParse({ ...n, provenance: "llm" as const });
      if (!parsed.success) {
        dropped.push(`Need inválido ${n.id}: ${parsed.error.message}`);
        continue;
      }
      needs.push(parsed.data);
    }
    if (needs.length === 0) continue;

    const key = row.screenId;
    const prev = grouped.get(key);
    if (!prev) {
      grouped.set(key, {
        screenId: row.screenId,
        components: [{ componentId: row.componentId, needs }],
        states: [],
      });
      continue;
    }
    const comp = prev.components.find((c) => c.componentId === row.componentId);
    if (comp) comp.needs.push(...needs);
    else prev.components.push({ componentId: row.componentId, needs });
  }

  return { entries: [...grouped.values()], dropped };
}

/** CL-14: needs sin tipo o tipos contradictorios para el mismo name. */
export function collectDataNeedsQualityIssues(entries: DesignSpecDataNeedsEntry[]): string[] {
  const issues: string[] = [];
  for (const entry of entries) {
    for (const block of entry.components) {
      const typesByName = new Map<string, Set<string>>();
      for (const need of block.needs) {
        const type = need.type?.trim() ?? "";
        if (!type) {
          issues.push(
            `[CL-14] dataNeeds[screenId=${entry.screenId}].components[componentId=${block.componentId}].needs[id=${need.id}] sin type`,
          );
          continue;
        }
        const set = typesByName.get(need.name) ?? new Set<string>();
        set.add(type);
        typesByName.set(need.name, set);
      }
      for (const [name, types] of typesByName) {
        if (types.size > 1) {
          issues.push(
            `[CL-14] dataNeeds[screenId=${entry.screenId}].components[componentId=${block.componentId}] campo ${name} con tipos contradictorios: ${[...types].join(" vs ")}`,
          );
        }
      }
    }
  }
  return issues;
}

export function llmPatchToDataNeedsEntries(raw: DesignDataNeedsLlmOutput): DesignSpecDataNeedsEntry[] {
  return raw.entries.map((row) => ({
    screenId: row.screenId,
    components: [
      {
        componentId: row.componentId,
        needs: row.needs.map((n) => ({ ...n, provenance: "llm" as const })),
      },
    ],
    states: [],
  }));
}
