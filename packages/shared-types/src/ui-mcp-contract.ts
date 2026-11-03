/**
 * @fileoverview **UI MCP contract** — el contrato que The Forge define para MCPs de componentes UI.
 *
 * Un MCP externo es **compatible** si:
 *  1. `tools/list` expone al menos los tools de {@link REQUIRED_UI_MCP_TOOLS}, y
 *  2. `describe_capabilities` devuelve un `contractVersion` reconocido ({@link UI_MCP_CONTRACT_VERSION}).
 *
 * Cuando hay un MCP compatible y activo, The Forge lo usa para resolver componentes reales
 * (reemplazando los genéricos heurísticos) en las secciones UI/UX del MDD y Blueprint,
 * inferir el design system y generar el deliverable "Pantallas / UI Screens Spec" (texto, sin TSX).
 *
 * @copyright 2026 Jorge Correa
 * @license Apache-2.0
 */
import { z } from "zod";

/**
 * Versión del contrato UI MCP definida por The Forge. Un MCP que declare esta versión
 * (o una anterior compatible) en `describe_capabilities` se considera reconocido.
 */
export const UI_MCP_CONTRACT_VERSION = "1.0.0" as const;

/** Versiones de contrato que The Forge acepta como compatibles. */
export const SUPPORTED_UI_MCP_CONTRACT_VERSIONS: readonly string[] = [UI_MCP_CONTRACT_VERSION];

/**
 * Tools MCP obligatorios para que The Forge considere un MCP como "UI MCP" compatible.
 * `describe_capabilities`, `list_components` y `resolve_component` son el núcleo mínimo;
 * `list_screens` y `get_design_tokens` son opcionales y se declaran en `supports`.
 */
export const REQUIRED_UI_MCP_TOOLS = [
  "describe_capabilities",
  "list_components",
  "resolve_component",
] as const;

/** Tools opcionales del contrato (habilitan deliverables extra). */
export const OPTIONAL_UI_MCP_TOOLS = ["list_screens", "get_design_tokens"] as const;

export type RequiredUiMcpTool = (typeof REQUIRED_UI_MCP_TOOLS)[number];
export type OptionalUiMcpTool = (typeof OPTIONAL_UI_MCP_TOOLS)[number];

// ---------------------------------------------------------------------------
// Clasificación semántica compartida (alineada con el resolver heurístico)
// ---------------------------------------------------------------------------

/** Clasificación semántica de una entidad de dominio. */
export const entityClassificationSchema = z.enum([
  "WorkflowProcess",
  "DataRegistry",
  "Configuration",
]);
export type EntityClassification = z.infer<typeof entityClassificationSchema>;

// ---------------------------------------------------------------------------
// describe_capabilities
// ---------------------------------------------------------------------------

/** Respuesta de `describe_capabilities` — handshake de compatibilidad. */
export const describeCapabilitiesResultSchema = z.object({
  /** Versión de contrato que implementa el MCP (debe ser reconocida por The Forge). */
  contractVersion: z.string().min(1),
  /** Librería de componentes que expone el MCP. */
  componentLibrary: z.object({
    name: z.string().min(1),
    version: z.string().min(1),
  }),
  /** Capacidades opcionales soportadas. */
  supports: z
    .object({
      resolveComponent: z.boolean().default(true),
      listScreens: z.boolean().default(false),
      designTokens: z.boolean().default(false),
    })
    .default({ resolveComponent: true, listScreens: false, designTokens: false }),
  /** Metadatos libres (documentación, homepage, etc.). */
  meta: z.record(z.unknown()).optional(),
});
export type DescribeCapabilitiesResult = z.infer<typeof describeCapabilitiesResultSchema>;

// ---------------------------------------------------------------------------
// list_components
// ---------------------------------------------------------------------------

/** Descriptor de una prop de componente. */
export const componentPropSchema = z.object({
  name: z.string().min(1),
  type: z.string().min(1),
  required: z.boolean().default(false),
  description: z.string().optional(),
});
export type ComponentProp = z.infer<typeof componentPropSchema>;

/** Descriptor de un componente del catálogo. */
export const uiComponentDescriptorSchema = z.object({
  /** Nombre del componente real (ej. "DataGridPro"). */
  name: z.string().min(1),
  /** Paquete npm (ej. "@mui/x-data-grid-pro"). */
  package: z.string().min(1),
  version: z.string().min(1),
  /** Componentes genéricos de The Forge que este reemplaza (ej. ["DataTable", "UserTable"]). */
  replacesGeneric: z.array(z.string()).default([]),
  /** Semántica: clasificaciones y capacidades que cubre. */
  semantic: z
    .object({
      classification: z.array(entityClassificationSchema).default([]),
      capabilities: z.array(z.string()).default([]),
    })
    .default({ classification: [], capabilities: [] }),
  props: z.array(componentPropSchema).default([]),
  /** Estrategia de binding a datos (ej. "rest", "graphql", "props"). */
  dataBinding: z.string().optional(),
  description: z.string().optional(),
});
export type UiComponentDescriptor = z.infer<typeof uiComponentDescriptorSchema>;

export const listComponentsResultSchema = z.object({
  components: z.array(uiComponentDescriptorSchema).default([]),
});
export type ListComponentsResult = z.infer<typeof listComponentsResultSchema>;

// ---------------------------------------------------------------------------
// resolve_component
// ---------------------------------------------------------------------------

/** Argumentos para `resolve_component`. */
export const resolveComponentArgsSchema = z.object({
  entityName: z.string().min(1),
  classification: entityClassificationSchema.optional(),
  keyFields: z.array(z.string()).optional(),
  lifecycleStates: z.array(z.string()).optional(),
  restEndpoint: z.string().optional(),
  /** Hint explícito para MCPs que lo soporten (p. ej. kanban, form, table). */
  uiHint: z.string().optional(),
  /** Contexto de negocio adicional (p. ej. texto de la HU). */
  context: z.string().optional(),
});
export type ResolveComponentArgs = z.infer<typeof resolveComponentArgsSchema>;

/** Resultado de `resolve_component` — un componente real para una entidad. */
export const resolveComponentResultSchema = z.object({
  component: z.string().min(1),
  package: z.string().min(1),
  version: z.string().min(1),
  /** Mapeo prop -> origen de datos (ej. { columns: "state", dataSource: "GET /api/v1/orders" }). */
  propMapping: z.record(z.string()).default({}),
  /** Confianza [0..1] del match. */
  confidence: z.number().min(0).max(1).default(1),
  /** Componente genérico de fallback si no se pudo resolver (opcional). */
  fallback: z.string().optional(),
  note: z.string().optional(),
});
export type ResolveComponentResult = z.infer<typeof resolveComponentResultSchema>;

// ---------------------------------------------------------------------------
// list_screens
// ---------------------------------------------------------------------------

/** Entidad de entrada para `list_screens`. */
export const listScreensEntitySchema = z.object({
  name: z.string().min(1),
  classification: entityClassificationSchema.optional(),
  keyFields: z.array(z.string()).optional(),
  restEndpoint: z.string().optional(),
});
export type ListScreensEntity = z.infer<typeof listScreensEntitySchema>;

/** Argumentos para `list_screens`. */
export const listScreensArgsSchema = z.object({
  entities: z.array(listScreensEntitySchema).default([]),
});
export type ListScreensArgs = z.infer<typeof listScreensArgsSchema>;

/** Un componente colocado en una pantalla (spec estructurada, sin TSX). */
export const screenComponentSchema = z.object({
  component: z.string().min(1),
  package: z.string().optional(),
  version: z.string().optional(),
  /** Entidad de dominio asociada (si aplica). */
  entity: z.string().optional(),
  /** Props/binding key -> valor descriptivo (texto, no código). */
  props: z.record(z.string()).default({}),
});
export type ScreenComponent = z.infer<typeof screenComponentSchema>;

/** Descriptor de una pantalla (spec estructurada de texto, sin TSX ni preview). */
export const screenSpecSchema = z.object({
  name: z.string().min(1),
  purpose: z.string().optional(),
  components: z.array(screenComponentSchema).default([]),
  /** Endpoints REST que la pantalla consume. */
  endpoints: z.array(z.string()).default([]),
});
export type ScreenSpec = z.infer<typeof screenSpecSchema>;

export const listScreensResultSchema = z.object({
  screens: z.array(screenSpecSchema).default([]),
});
export type ListScreensResult = z.infer<typeof listScreensResultSchema>;

// ---------------------------------------------------------------------------
// get_design_tokens
// ---------------------------------------------------------------------------

/** Resultado de `get_design_tokens` (opcional) — tokens para inferir el design system. */
export const getDesignTokensResultSchema = z.object({
  colors: z.record(z.string()).optional(),
  typography: z.record(z.unknown()).optional(),
  spacing: z.record(z.union([z.string(), z.number()])).optional(),
  radii: z.record(z.union([z.string(), z.number()])).optional(),
  shadows: z.record(z.string()).optional(),
  raw: z.record(z.unknown()).optional(),
});
export type GetDesignTokensResult = z.infer<typeof getDesignTokensResultSchema>;

// ---------------------------------------------------------------------------
// Compatibilidad
// ---------------------------------------------------------------------------

/** Resumen de compatibilidad detectada de un MCP. */
export interface UiMcpCompatibility {
  compatible: boolean;
  contractVersion?: string;
  libraryName?: string;
  libraryVersion?: string;
  supports?: DescribeCapabilitiesResult["supports"];
  /** Tools obligatorios que faltan (vacío si compatible nativo o vía adaptador). */
  missingTools: string[];
  error?: string;
  /** `null` = contrato nativo The Forge; id del adaptador si se usa shim genérico. */
  adapterId?: string | null;
  /** `true` si el MCP expone el contrato The Forge sin adaptador. */
  nativeCompatible?: boolean;
  /** Tools detectados en la última prueba (`tools/list`). */
  detectedTools?: string[];
}

/**
 * Determina si un `contractVersion` declarado por el MCP es reconocido por The Forge.
 * Comparación por major (semver laxo): reconocemos versiones cuyo major coincide con
 * el de {@link UI_MCP_CONTRACT_VERSION} o que estén explícitamente soportadas.
 */
export function isSupportedUiMcpContractVersion(version: string | undefined): boolean {
  if (!version) return false;
  const v = version.trim();
  if (SUPPORTED_UI_MCP_CONTRACT_VERSIONS.includes(v)) return true;
  const major = v.split(".")[0];
  const ourMajor = UI_MCP_CONTRACT_VERSION.split(".")[0];
  return !!major && major === ourMajor;
}

/**
 * Evalúa compatibilidad a partir de la lista de tools (`tools/list`) y el resultado
 * de `describe_capabilities` (si se pudo obtener).
 */
export function evaluateUiMcpCompatibility(input: {
  toolNames: string[];
  capabilities?: DescribeCapabilitiesResult | null;
}): UiMcpCompatibility {
  const available = new Set(input.toolNames);
  const missingTools = REQUIRED_UI_MCP_TOOLS.filter((t) => !available.has(t));
  const caps = input.capabilities ?? undefined;
  const versionOk = isSupportedUiMcpContractVersion(caps?.contractVersion);
  const compatible = missingTools.length === 0 && versionOk;
  return {
    compatible,
    contractVersion: caps?.contractVersion,
    libraryName: caps?.componentLibrary.name,
    libraryVersion: caps?.componentLibrary.version,
    supports: caps?.supports,
    missingTools,
  };
}
