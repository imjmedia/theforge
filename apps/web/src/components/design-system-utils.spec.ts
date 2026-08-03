import { describe, it } from "node:test";
import assert from "node:assert";
import {
  buildPreviewTheme,
  resolveLightPreviewBackground,
  generateColorScale,
  hexValue,
  fallbackFromColors,
  normalizeHex,
} from "./design-system-utils.js";
import type { DesignTokens } from "./design-system-types.js";
import { shadcnZincPreset } from "@theforge/shared-types";

const ELEVEN_LABS_LIKE: DesignTokens = {
  colors: {
    primary: "#3B82F6",
    secondary: "#A855F7",
    tertiary: "#888899",
    neutral: "#888899",
    foreground: "#FAFAFA",
    background: "#0A0A0F",
  },
};

const PRIMITIVE_REFS: DesignTokens = {
  primitives: shadcnZincPreset.primitives,
  colors: {
    primary: "{primitives.zinc900}",
    background: "{primitives.zinc50}",
    foreground: "{primitives.zinc900}",
    muted: "{primitives.zinc100}",
    border: "{primitives.zinc200}",
    destructive: "{primitives.red500}",
    success: "{primitives.green500}",
    warning: "{primitives.amber500}",
  },
};

describe("primitive color refs", () => {
  it("hexValue resolves {primitives.*} via tokens.primitives", () => {
    assert.equal(normalizeHex(hexValue("{primitives.zinc900}", PRIMITIVE_REFS)), "#18181B");
    assert.equal(normalizeHex(hexValue("{primitives.red500}", PRIMITIVE_REFS)), "#EF4444");
  });

  it("fallbackFromColors resolves semantic primitive refs", () => {
    const palette = fallbackFromColors(PRIMITIVE_REFS);
    assert.match(palette.primary, /^#[0-9A-F]{6}$/i);
    assert.match(palette.muted, /^#[0-9A-F]{6}$/i);
    assert.notEqual(palette.primary, "{primitives.zinc900}");
  });

  it("buildPreviewTheme renders scales from primitive refs", () => {
    const theme = buildPreviewTheme(PRIMITIVE_REFS, "light");
    assert.match(theme.accent, /^#[0-9A-F]{6}$/i);
    assert.match(theme.cssVars["--ds-accent-1"]!, /^#[0-9A-F]{6}$/i);
    assert.match(theme.cssVars["--ds-gray-1"]!, /^#[0-9A-F]{6}$/i);
  });
});

describe("buildPreviewTheme light mode", () => {
  it("uses a light canvas when YAML background is dark-first", () => {
    const theme = buildPreviewTheme(ELEVEN_LABS_LIKE, "light");
    assert.ok(theme.background !== "#0A0A0F");
    assert.match(theme.cssVars["--ds-bg"]!, /^#[A-F0-9]{6}$/i);
    assert.ok(
      parseInt(theme.cssVars["--ds-bg"]!.slice(1, 3), 16) >= 200,
      "light bg should be bright",
    );
    assert.ok(
      parseInt(theme.cssVars["--ds-fg"]!.slice(1, 3), 16) < 80,
      "fg should be dark on light canvas",
    );
  });

  it("resolveLightPreviewBackground prefers light neutral over dark background", () => {
    const grayScale = generateColorScale("#888899", 12, "light");
    const bg = resolveLightPreviewBackground(ELEVEN_LABS_LIKE, grayScale);
    assert.notEqual(bg, "#0A0A0F");
  });
});
