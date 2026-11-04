/**
 * Design-First: esquema `designSpec`, invariantes I1–I3 y adaptadores ScreenSpec v1.
 * Hash SHA-256: `@theforge/shared-types/design-spec-hash.node` (solo Node/API).
 */
import { z } from "zod";
import {
  entityClassificationSchema,
  type ScreenSpec,
  screenSpecSchema,
} from "../ui-mcp-contract.js";

export const DESIGN_SPEC_SCHEMA_VERSION = 1 as const;
export const DESIGN_SPEC_MAX_SCREEN_COUNT = 200;

export const designSpecScreenIdRegex = /^[a-z][a-z0-9-]{1,63}$/;

export const designSpecScreenIdSchema = z.string().regex(designSpecScreenIdRegex);

export const designSpecOriginSchema = z.object({
  kind: z.enum(["image", "figma", "manual", "ui-mcp"]),
  ref: z.string().optional(),
  nodeId: z.string().optional(),
  fileKey: z.string().optional(),
  sourceImageIndex: z.number().int().nonnegative().optional(),
  confidence: z.number().min(0).max(1).optional(),
});

export const designSpecScreenComponentSchema = z.object({
  id: designSpecScreenIdSchema,
  component: z.string().min(1),
  label: z.string().optional(),
  package: z.string().optional(),
  version: z.string().optional(),
  props: z.record(z.string()).optional(),
});

export const designSpecScreenSchema = z.object({
  id: designSpecScreenIdSchema,
  name: z.string().min(1),
  route: z.string().min(1),
  roles: z.array(z.string()).default([]),
  purpose: z.string().optional(),
  states: z.array(z.string()).default([]),
  static: z.boolean().optional(),
  origin: designSpecOriginSchema,
  components: z.array(designSpecScreenComponentSchema).default([]),
});

export const designSpecNavigationTriggerSchema = z.object({
  componentId: designSpecScreenIdSchema.optional(),
  event: z.string().min(1),
});

export const designSpecNavigationSchema = z.object({
  id: designSpecScreenIdSchema,
  from: designSpecScreenIdSchema,
  to: designSpecScreenIdSchema,
  trigger: designSpecNavigationTriggerSchema,
  condition: z.string().optional(),
});

export const designSpecEntitySchema = z.object({
  id: designSpecScreenIdSchema,
  name: z.string().min(1),
  classification: entityClassificationSchema.optional(),
  keyFields: z.array(z.string()).optional(),
  restEndpoint: z.string().optional(),
});

export const designSpecDataNeedItemSchema = z.object({
  id: designSpecScreenIdSchema,
  name: z.string().min(1),
  type: z.string().min(1),
  format: z.string().optional(),
  origin: z.enum(["entity", "derived", "input"]),
  action: z.string().min(1),
  required: z.boolean().optional(),
  many: z.boolean().optional(),
  endpointHint: z.string().optional(),
  provenance: z.enum(["heuristic", "llm", "user"]),
});

export const designSpecDataNeedComponentSchema = z.object({
  componentId: designSpecScreenIdSchema,
  needs: z.array(designSpecDataNeedItemSchema).default([]),
});

export const designSpecDataNeedsEntrySchema = z.object({
  screenId: designSpecScreenIdSchema,
  components: z.array(designSpecDataNeedComponentSchema).default([]),
  states: z.array(z.string()).default([]),
});

export const designSpecSchema = z.object({
  schemaVersion: z.literal(DESIGN_SPEC_SCHEMA_VERSION),
  entities: z.array(designSpecEntitySchema).default([]),
  screens: z.array(designSpecScreenSchema).default([]),
  navigation: z.array(designSpecNavigationSchema).default([]),
  dataNeeds: z.array(designSpecDataNeedsEntrySchema).default([]),
});

export type DesignSpec = z.infer<typeof designSpecSchema>;
export type DesignSpecScreen = z.infer<typeof designSpecScreenSchema>;
export type DesignSpecEntity = z.infer<typeof designSpecEntitySchema>;
export type DesignSpecNavigation = z.infer<typeof designSpecNavigationSchema>;
export type DesignSpecDataNeedsEntry = z.infer<typeof designSpecDataNeedsEntrySchema>;

/** Valor inicial al crear un proyecto DESIGN_FIRST (RF-01). */
export const EMPTY_DESIGN_SPEC: DesignSpec = {
  schemaVersion: DESIGN_SPEC_SCHEMA_VERSION,
  entities: [],
  screens: [],
  navigation: [],
  dataNeeds: [],
};

export type DesignSpecInvariantId = "I1" | "I2" | "I3";

export type DesignSpecInvariantIssue = {
  invariant: DesignSpecInvariantId;
  path: string;
  message: string;
};

export class DesignSpecByteLimitError extends Error {
  readonly code = "DESIGN_SPEC_BYTE_LIMIT" as const;
  constructor(
    readonly maxBytes: number,
    readonly actualBytes: number,
  ) {
    super(`designSpec excede el límite de ${maxBytes} bytes (${actualBytes} bytes)`);
    this.name = "DesignSpecByteLimitError";
  }
}

export class DesignSpecScreenCountError extends Error {
  readonly code = "DESIGN_SPEC_SCREEN_COUNT" as const;
  constructor(readonly count: number) {
    super(`designSpec tiene ${count} pantallas; el máximo es ${DESIGN_SPEC_MAX_SCREEN_COUNT}`);
    this.name = "DesignSpecScreenCountError";
  }
}

function canonicalizeJsonValue(value: unknown): unknown {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map((item) => canonicalizeJsonValue(item));
  const obj = value as Record<string, unknown>;
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(obj).sort()) {
    sorted[key] = canonicalizeJsonValue(obj[key]);
  }
  return sorted;
}

export function canonicalDesignSpecJson(spec: DesignSpec): string {
  return JSON.stringify(canonicalizeJsonValue(spec));
}

export function utf8ByteLength(text: string): number {
  return Buffer.byteLength(text, "utf8");
}

export function measureDesignSpecBytes(spec: DesignSpec): number {
  return utf8ByteLength(JSON.stringify(spec));
}

/** RNF-04: límite de pantallas y tamaño en bytes (maxBytes viene de config en la API). */
export function assertDesignSpecWithinLimits(spec: DesignSpec, maxBytes: number): void {
  if (spec.screens.length > DESIGN_SPEC_MAX_SCREEN_COUNT) {
    throw new DesignSpecScreenCountError(spec.screens.length);
  }
  const actual = measureDesignSpecBytes(spec);
  if (actual > maxBytes) {
    throw new DesignSpecByteLimitError(maxBytes, actual);
  }
}

export function parseDesignSpec(input: unknown): DesignSpec {
  return designSpecSchema.parse(input);
}

function screenIdSet(spec: DesignSpec): Set<string> {
  return new Set(spec.screens.map((s) => s.id));
}

function entityIdSet(spec: DesignSpec): Set<string> {
  return new Set(spec.entities.map((e) => e.id));
}

function componentIdSet(spec: DesignSpec): Set<string> {
  const ids = new Set<string>();
  for (const screen of spec.screens) {
    for (const c of screen.components) {
      ids.add(c.id);
    }
  }
  return ids;
}

/** I1: ids únicos, rutas únicas, navegación referencia pantallas existentes. */
export function validateDesignSpecI1(spec: DesignSpec): DesignSpecInvariantIssue[] {
  const issues: DesignSpecInvariantIssue[] = [];
  const screenIds = new Set<string>();
  const routes = new Map<string, string>();
  for (const screen of spec.screens) {
    if (screenIds.has(screen.id)) {
      issues.push({
        invariant: "I1",
        path: `screens[id=${screen.id}]`,
        message: `id de pantalla duplicado: ${screen.id}`,
      });
    }
    screenIds.add(screen.id);
    const prevRoute = routes.get(screen.route);
    if (prevRoute) {
      issues.push({
        invariant: "I1",
        path: `screens[id=${screen.id}].route`,
        message: `ruta duplicada ${screen.route} (pantallas ${prevRoute} y ${screen.id})`,
      });
    } else {
      routes.set(screen.route, screen.id);
    }
  }

  const componentIds = new Map<string, string>();
  for (const screen of spec.screens) {
    for (const comp of screen.components) {
      const prev = componentIds.get(comp.id);
      if (prev) {
        issues.push({
          invariant: "I1",
          path: `screens[id=${screen.id}].components[id=${comp.id}]`,
          message: `id de componente duplicado: ${comp.id} (pantallas ${prev} y ${screen.id})`,
        });
      } else {
        componentIds.set(comp.id, screen.id);
      }
    }
  }

  const navIds = new Set<string>();
  const knownScreens = screenIdSet(spec);
  for (const edge of spec.navigation) {
    if (navIds.has(edge.id)) {
      issues.push({
        invariant: "I1",
        path: `navigation[id=${edge.id}]`,
        message: `id de arista de navegación duplicado: ${edge.id}`,
      });
    }
    navIds.add(edge.id);
    if (!knownScreens.has(edge.from)) {
      issues.push({
        invariant: "I1",
        path: `navigation[id=${edge.id}].from`,
        message: `arista colgante: pantalla origen inexistente ${edge.from}`,
      });
    }
    if (!knownScreens.has(edge.to)) {
      issues.push({
        invariant: "I1",
        path: `navigation[id=${edge.id}].to`,
        message: `arista colgante: pantalla destino inexistente ${edge.to}`,
      });
    }
    if (edge.trigger.componentId && !componentIds.has(edge.trigger.componentId)) {
      issues.push({
        invariant: "I1",
        path: `navigation[id=${edge.id}].trigger.componentId`,
        message: `componentId de trigger inexistente: ${edge.trigger.componentId}`,
      });
    }
  }

  return issues;
}

/** I2: referencias de dataNeeds y acciones hacia entidades existentes. */
export function validateDesignSpecI2(spec: DesignSpec): DesignSpecInvariantIssue[] {
  const issues: DesignSpecInvariantIssue[] = [];
  const screens = screenIdSet(spec);
  const components = componentIdSet(spec);
  const entities = entityIdSet(spec);

  for (const entry of spec.dataNeeds) {
    if (!screens.has(entry.screenId)) {
      issues.push({
        invariant: "I2",
        path: `dataNeeds[screenId=${entry.screenId}]`,
        message: `screenId inexistente: ${entry.screenId}`,
      });
      continue;
    }
    for (const block of entry.components) {
      if (!components.has(block.componentId)) {
        issues.push({
          invariant: "I2",
          path: `dataNeeds[screenId=${entry.screenId}].components[componentId=${block.componentId}]`,
          message: `componentId inexistente: ${block.componentId}`,
        });
      }
      for (const need of block.needs) {
        if (!entities.has(need.action)) {
          issues.push({
            invariant: "I2",
            path: `dataNeeds[screenId=${entry.screenId}].components[componentId=${block.componentId}].needs[id=${need.id}].action`,
            message: `action no referencia entidad existente: ${need.action}`,
          });
        }
      }
    }
  }

  return issues;
}

/** I3: todo need con tipo; mismo campo sin tipos contradictorios. */
export function validateDesignSpecI3(spec: DesignSpec): DesignSpecInvariantIssue[] {
  const issues: DesignSpecInvariantIssue[] = [];
  const typeByField = new Map<string, string>();

  for (const entry of spec.dataNeeds) {
    for (const block of entry.components) {
      for (const need of block.needs) {
        const typeTrim = need.type?.trim() ?? "";
        if (!typeTrim) {
          issues.push({
            invariant: "I3",
            path: `dataNeeds[screenId=${entry.screenId}].components[componentId=${block.componentId}].needs[id=${need.id}].type`,
            message: "need sin tipo",
          });
          continue;
        }
        const key = `${entry.screenId}:${block.componentId}:${need.name}`;
        const prev = typeByField.get(key);
        if (prev && prev !== typeTrim) {
          issues.push({
            invariant: "I3",
            path: `dataNeeds[screenId=${entry.screenId}].components[componentId=${block.componentId}].needs[name=${need.name}]`,
            message: `tipos contradictorios para el campo ${need.name}: ${prev} vs ${typeTrim}`,
          });
        } else {
          typeByField.set(key, typeTrim);
        }
      }
    }
  }

  return issues;
}

export function validateDesignSpecInvariants(spec: DesignSpec): DesignSpecInvariantIssue[] {
  return [...validateDesignSpecI1(spec), ...validateDesignSpecI2(spec), ...validateDesignSpecI3(spec)];
}

function slugScreenId(name: string, index: number): string {
  const base = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  const candidate = base.length >= 2 ? base : `screen-${index + 1}`;
  return designSpecScreenIdRegex.test(candidate) ? candidate : `screen-${index + 1}`;
}

function collectEndpointsForScreen(spec: DesignSpec, screenId: string): string[] {
  const endpoints = new Set<string>();
  for (const entity of spec.entities) {
    if (entity.restEndpoint) endpoints.add(entity.restEndpoint);
  }
  for (const entry of spec.dataNeeds) {
    if (entry.screenId !== screenId) continue;
    for (const block of entry.components) {
      for (const need of block.needs) {
        if (need.endpointHint) endpoints.add(need.endpointHint);
        const entity = spec.entities.find((e) => e.id === need.action);
        if (entity?.restEndpoint) endpoints.add(entity.restEndpoint);
      }
    }
  }
  return [...endpoints].sort();
}

/** Adaptador a ScreenSpec v1 (`ui-mcp-contract`). */
export function toScreenSpecV1(spec: DesignSpec): ScreenSpec[] {
  return spec.screens.map((screen) => ({
    name: screen.name,
    purpose: screen.purpose,
    components: screen.components.map((c) => ({
      component: c.component,
      package: c.package,
      version: c.version,
      entity: spec.dataNeeds
        .find((d) => d.screenId === screen.id)
        ?.components.find((b) => b.componentId === c.id)
        ?.needs[0]?.action,
      props: c.props ?? {},
    })),
    endpoints: collectEndpointsForScreen(spec, screen.id),
  }));
}

/** Reconstruye pantallas del designSpec desde ScreenSpec v1 (roundtrip parcial). */
export function fromScreenSpecV1(
  screens: ScreenSpec[],
  existing?: Pick<DesignSpec, "entities" | "navigation" | "dataNeeds">,
): DesignSpec {
  const parsedScreens = z.array(screenSpecSchema).parse(screens);
  const usedIds = new Set<string>();
  const designScreens: DesignSpecScreen[] = parsedScreens.map((s, index) => {
    let id = slugScreenId(s.name, index);
    let n = 2;
    while (usedIds.has(id)) {
      id = `${slugScreenId(s.name, index).slice(0, 58)}-${n}`;
      n++;
    }
    usedIds.add(id);
    return {
      id,
      name: s.name,
      route: `/${id}`,
      roles: [],
      purpose: s.purpose,
      states: [],
      origin: { kind: "ui-mcp" as const },
      components: s.components.map((c, ci) => ({
        id: `${id}-c${ci + 1}`,
        component: c.component,
        package: c.package,
        version: c.version,
        props: c.props,
      })),
    };
  });

  return {
    schemaVersion: DESIGN_SPEC_SCHEMA_VERSION,
    entities: existing?.entities ?? [],
    screens: designScreens,
    navigation: existing?.navigation ?? [],
    dataNeeds: existing?.dataNeeds ?? [],
  };
}

export function roundtripScreenSpecV1(spec: DesignSpec): DesignSpec {
  const v1 = toScreenSpecV1(spec);
  const rebuilt = fromScreenSpecV1(v1, spec);
  return {
    ...rebuilt,
    screens: rebuilt.screens.map((screen, i) => ({
      ...screen,
      name: spec.screens[i]?.name ?? screen.name,
      route: spec.screens[i]?.route ?? screen.route,
      id: spec.screens[i]?.id ?? screen.id,
    })),
  };
}
