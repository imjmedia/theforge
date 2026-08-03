/**
 * Stack-aware design system presets (primitives + semantic tokens).
 */

import { detectWebSurfaces } from "./web-surfaces.util.js";

export type DesignStackBase = "shadcn" | "mui" | "tailwind" | "imj";

export type ColorSource = "brand" | "system-default" | "mcp" | "url-scan";

export type DesignTokenPreset = {
  stackBase: DesignStackBase;
  adapterLabel: string;
  packageScope: string;
  colorSource: ColorSource;
  primitives: Record<string, string>;
  semantic: Record<string, string>;
  typography: Record<string, unknown>;
  spacing: Record<string, string>;
  rounded: Record<string, string>;
};

const SHADCN_ZINC_PRIMITIVES: Record<string, string> = {
  zinc50: "#fafafa",
  zinc100: "#f4f4f5",
  zinc200: "#e4e4e7",
  zinc500: "#71717a",
  zinc900: "#18181b",
  red500: "#ef4444",
  green500: "#22c55e",
  amber500: "#f59e0b",
};

const MUI_DEFAULT_PRIMITIVES: Record<string, string> = {
  blue500: "#2196f3",
  blue700: "#1976d2",
  grey50: "#fafafa",
  grey100: "#f5f5f5",
  grey300: "#e0e0e0",
  grey900: "#212121",
  red700: "#d32f2f",
  green700: "#388e3c",
  orange700: "#f57c00",
};

const TAILWIND_SLATE_PRIMITIVES: Record<string, string> = {
  slate50: "#f8fafc",
  slate100: "#f1f5f9",
  slate200: "#e2e8f0",
  slate500: "#64748b",
  slate900: "#0f172a",
  red600: "#dc2626",
  green600: "#16a34a",
  amber500: "#f59e0b",
};

function semanticFromPrimitives(
  p: Record<string, string>,
  mapping: Record<string, string>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, primKey] of Object.entries(mapping)) {
    out[key] = `{primitives.${primKey}}`;
  }
  return out;
}

export const shadcnZincPreset: DesignTokenPreset = {
  stackBase: "shadcn",
  adapterLabel: "shadcn/ui",
  packageScope: "shadcn/ui",
  colorSource: "system-default",
  primitives: SHADCN_ZINC_PRIMITIVES,
  semantic: semanticFromPrimitives(SHADCN_ZINC_PRIMITIVES, {
    primary: "zinc900",
    background: "zinc50",
    foreground: "zinc900",
    muted: "zinc100",
    border: "zinc200",
    destructive: "red500",
    success: "green500",
    warning: "amber500",
  }),
  typography: {
    "font-sans": ["Inter", "system-ui", "sans-serif"],
    "body-md": { fontSize: "16px", fontWeight: 400, lineHeight: "24px" },
    "label-sm": { fontSize: "14px", fontWeight: 500, lineHeight: "20px" },
  },
  spacing: { sm: "8px", md: "16px", lg: "24px", xl: "32px" },
  rounded: { sm: "6px", md: "8px", lg: "12px", full: "9999px" },
};

export const muiDefaultPreset: DesignTokenPreset = {
  stackBase: "mui",
  adapterLabel: "MUI + packages/ui adapter",
  packageScope: "@org/ui",
  colorSource: "system-default",
  primitives: MUI_DEFAULT_PRIMITIVES,
  semantic: semanticFromPrimitives(MUI_DEFAULT_PRIMITIVES, {
    primary: "blue700",
    background: "grey50",
    foreground: "grey900",
    muted: "grey100",
    border: "grey300",
    destructive: "red700",
    success: "green700",
    warning: "orange700",
  }),
  typography: {
    "font-sans": ["Roboto", "Helvetica", "Arial", "sans-serif"],
    "body-md": { fontSize: "16px", fontWeight: 400, lineHeight: "24px" },
    "label-sm": { fontSize: "14px", fontWeight: 500, lineHeight: "20px" },
  },
  spacing: { sm: "8px", md: "16px", lg: "24px", xl: "32px" },
  rounded: { sm: "4px", md: "8px", lg: "12px", full: "9999px" },
};

export const tailwindSlatePreset: DesignTokenPreset = {
  stackBase: "tailwind",
  adapterLabel: "Tailwind slate preset",
  packageScope: "tailwindcss",
  colorSource: "system-default",
  primitives: TAILWIND_SLATE_PRIMITIVES,
  semantic: semanticFromPrimitives(TAILWIND_SLATE_PRIMITIVES, {
    primary: "slate900",
    background: "slate50",
    foreground: "slate900",
    muted: "slate100",
    border: "slate200",
    destructive: "red600",
    success: "green600",
    warning: "amber500",
  }),
  typography: {
    "font-sans": ["Inter", "system-ui", "sans-serif"],
    "body-md": { fontSize: "16px", fontWeight: 400, lineHeight: "24px" },
  },
  spacing: { sm: "8px", md: "16px", lg: "24px", xl: "32px" },
  rounded: { sm: "6px", md: "8px", lg: "12px", full: "9999px" },
};

export const imjUiPreset: DesignTokenPreset = {
  ...shadcnZincPreset,
  stackBase: "imj",
  adapterLabel: "@imj_media/ui",
  packageScope: "@imj_media/ui",
};

export type StackPresetResolution = DesignTokenPreset & {
  hasWebSurfaces: boolean;
};

/** Resolves stack preset from MDD/Blueprint (MCP lib → MUI → packages/ui → shadcn). */
export function resolveStackPreset(
  mddMarkdown?: string | null,
  blueprintMarkdown?: string | null,
): StackPresetResolution {
  const corpus = `${mddMarkdown ?? ""}\n${blueprintMarkdown ?? ""}`;
  const hasWebSurfaces = detectWebSurfaces(mddMarkdown, blueprintMarkdown);

  if (/@imj_media\/ui/i.test(corpus)) {
    return { ...imjUiPreset, hasWebSurfaces };
  }
  if (/@mui\/material|material-ui|\bmui\b/i.test(corpus)) {
    return { ...muiDefaultPreset, hasWebSurfaces };
  }
  if (/tailwind/i.test(corpus) && !/shadcn/i.test(corpus)) {
    return { ...tailwindSlatePreset, hasWebSurfaces };
  }
  return { ...shadcnZincPreset, hasWebSurfaces };
}

const REQUIRED_SEMANTIC_KEYS = [
  "primary",
  "background",
  "foreground",
  "muted",
  "border",
  "destructive",
  "success",
  "warning",
] as const;

export type PartialDesignTokens = {
  colorSource?: ColorSource;
  colors?: Record<string, string>;
  typography?: Record<string, unknown>;
  spacing?: Record<string, string>;
  rounded?: Record<string, string>;
  primitives?: Record<string, string>;
};

/** Fills missing semantic tokens from preset; sets colorSource when absent. */
export function fillSemanticTokens(
  partial: PartialDesignTokens | null | undefined,
  preset: DesignTokenPreset,
): PartialDesignTokens & { colorSource: ColorSource } {
  const base = partial ?? {};
  const colors = { ...(base.colors ?? {}) };
  const primitives = { ...(base.primitives ?? preset.primitives) };

  for (const key of REQUIRED_SEMANTIC_KEYS) {
    if (!colors[key]) {
      const ref = preset.semantic[key];
      colors[key] = ref ?? preset.primitives.zinc900 ?? "#18181b";
    }
  }

  const colorSource =
    base.colorSource ??
    (Object.keys(base.colors ?? {}).length > 0 ? "brand" : preset.colorSource);

  return {
    ...base,
    colorSource,
    colors,
    primitives,
    typography:
      base.typography && Object.keys(base.typography).length > 0
        ? base.typography
        : preset.typography,
    spacing:
      base.spacing && Object.keys(base.spacing).length > 0 ? base.spacing : preset.spacing,
    rounded:
      base.rounded && Object.keys(base.rounded).length > 0 ? base.rounded : preset.rounded,
  };
}

/** Detects loose hex colors outside preset primitives (warn-only). */
export function findLooseHexColors(
  content: string,
  preset: DesignTokenPreset,
): string[] {
  const allowed = new Set([
    ...Object.values(preset.primitives),
    ...Object.values(preset.semantic),
  ]);
  const found = new Set<string>();
  for (const m of content.matchAll(/#[0-9a-fA-F]{3,8}\b/g)) {
    const hex = m[0]!.toLowerCase();
    if (!allowed.has(hex) && !allowed.has(hex.toUpperCase())) {
      found.add(hex);
    }
  }
  return [...found];
}
