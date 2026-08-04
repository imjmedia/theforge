import { useMemo } from "react";

import type { ComponentToken, DesignTokens, TypographyToken } from "@/components/design-system-types";
import {
  ELEVATION_PRESETS,
  hexValue,
  mergeTypographyTokens,
  normalizeElevationTokens,
  parseInlineTokenProps,
} from "@/components/design-system-utils";
import { DesignSystemCustomizer } from "@/components/DesignSystemCustomizer";
import { fillSemanticTokens, shadcnZincPreset } from "@theforge/shared-types";

export type { ComponentToken, DesignTokens, TypographyToken };

// ─── Google-style DESIGN.md parser (fallback sin YAML) ───────

const DESIGN_MD_CACHE = new Map<string, DesignTokens | null>();

function parseDesignMdContent(content: string): DesignTokens | null {
  const cached = DESIGN_MD_CACHE.get(content);
  if (cached !== undefined) return cached;

  const tokens: DesignTokens = {};

  // ── Colors ──────────────────────────────────────────────
  const colorsSection = extractSection(content, ["colors", "color"]);
  if (colorsSection) {
    const colors: Record<string, string> = {};
    const colorPatterns = [
      /(?:^|\n)\s*(?:\*\*)?(\w[\w\s-]*?)(?:\*\*)?\s*[:(]\s*[#]?\(?([A-Fa-f0-9]{6})\)?/gm,
      /--[\w-]+:\s*[#]?\(?([A-Fa-f0-9]{6})\)?/g,
    ];
    for (const pattern of colorPatterns) {
      let m: RegExpExecArray | null;
      const re = new RegExp(pattern.source, 'gm');
      while ((m = re.exec(colorsSection)) !== null) {
        if (m[1] && m[2]) {
          const name = m[1].toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
          if (name) colors[name] = `#${m[2].toUpperCase()}`;
        }
      }
    }
    const cssColorRe = /(\w[\w\s]*?)\s*\((#([A-Fa-f0-9]{6}))\)/g;
    let cm: RegExpExecArray | null;
    while ((cm = cssColorRe.exec(colorsSection)) !== null) {
      const name = cm[1]!.toLowerCase().trim().replace(/\s+/g, '-');
      const hex = cm[2]!.toUpperCase();
      if (name && !Object.values(colors).includes(hex)) {
        colors[name] = hex;
      }
    }
    // Markdown table patterns
    // Pattern A: | Name | Middle | #HEX | ... | (hex in col 3)
    const tableReHexCol3 = /\|\s*\*{0,2}([\w\s\-áéíóúñÑ/]+?)\*{0,2}\s*\|[^|]*\|\s*`?(?:#([A-Fa-f0-9]{6}))`?\s*\|/gm;
    for (const re of [tableReHexCol3]) {
      let m: RegExpExecArray | null;
      while ((m = re.exec(colorsSection)) !== null) {
        const name = m[1]!.replace(/\*\*/g, '').toLowerCase().trim().replace(/\s+/g, '-');
        const hex = `#${m[2]!.toUpperCase()}`;
        if (name && !Object.values(colors).includes(hex)) {
          colors[name] = hex;
        }
      }
    }
    // Pattern B: | Name | #HEX | ... | (hex in col 2 — common in UX/UI guide)
    const tableReHexCol2 = /\|\s*\*{0,2}([\w\s\-áéíóúñÑ/]+?)\*{0,2}\s*\|\s*`?(?:#([A-Fa-f0-9]{6}))`?\s*\|[^|]*\|/gm;
    {
      let m: RegExpExecArray | null;
      while ((m = tableReHexCol2.exec(colorsSection)) !== null) {
        const name = m[1]!.replace(/\*\*/g, '').toLowerCase().trim().replace(/\s+/g, '-');
        const hex = `#${m[2]!.toUpperCase()}`;
        if (name && !Object.values(colors).includes(hex)) {
          colors[name] = hex;
        }
      }
    }
    if (Object.keys(colors).length > 0) tokens.colors = colors;
  }

  // ── Typography ──────────────────────────────────────────
  const typographySection = extractSection(content, ["typography", "type", "fonts", "font"]);
  if (typographySection) {
    const typography: Record<string, TypographyToken> = {};
    const hierRe = /(h1|h2|h3|h4|h5|h6|body[\s-]?md|body[\s-]?sm|body|label[\s-]?sm|label|small|caption|footnote)\s+(\d+)\s*px\s+(\d{3})\s+(\d+)\s*px\s*([\d.-]+)?\s*(?:em)?/gi;
    let hm: RegExpExecArray | null;
    while ((hm = hierRe.exec(typographySection)) !== null) {
      const key = hm[1]!.toLowerCase().replace(/[\s_]+/g, '-');
      typography[key] = {
        fontSize: `${hm[2]}px`,
        fontWeight: parseInt(hm[3]!),
        lineHeight: `${hm[4]}px`,
        letterSpacing: hm[5] ? `${hm[5]}em` : undefined,
      };
    }
    const tableRe = /\|?\s*(h1|h2|h3|h4|h5|h6|body[\s-]?md|body[\s-]?sm|label[\s-]?sm)\s*\|?\s*(\d+)\s*px?\s*\|?\s*(\d{3})\s*\|?\s*(\d+)\s*px?\s*\|?\s*([\d.-]+)?\s*(?:em)?/gi;
    let tm: RegExpExecArray | null;
    while ((tm = tableRe.exec(typographySection)) !== null) {
      const key = tm[1]!.toLowerCase().replace(/[\s_]+/g, '-');
      if (!typography[key]) {
        typography[key] = {
          fontSize: `${tm[2]}px`,
          fontWeight: parseInt(tm[3]!),
          lineHeight: `${tm[4]}px`,
          letterSpacing: tm[5] ? `${tm[5]}em` : undefined,
        };
      }
    }
    if (Object.keys(typography).length > 0) {
      typography['font-sans'] = { fontFamily: "'Inter', system-ui, -apple-system, sans-serif" };
      tokens.typography = typography;
    }
    // Spanish typography table: | Propósito | Fuente | Peso | Tamaños clave |
    // e.g. | Títulos grandes (h1, h2) | Inter | Bold (700) | 32px, 28px |
    const spanishTypoRe = /\|\s*[\w\sáéíóúñÑ()/,]+\s*\|[^|]*\|[^|]*\|\s*([\d]+)px/gi;
    if (Object.keys(typography).length === 0) {
      let stm: RegExpExecArray | null;
      while ((stm = spanishTypoRe.exec(typographySection)) !== null) {
        const size = parseInt(stm[1]!);
        if (!typography['body-md'] && size >= 14 && size <= 18) {
          typography['body-md'] = { fontSize: `${size}px`, fontWeight: 400, lineHeight: `${Math.round(size * 1.5)}px` };
        }
      }
    }
  }

  // ── Components ─────────────────────────────────────────
  const componentsSection = extractSection(content, ["components"]);
  if (componentsSection) {
    const components: Record<string, ComponentToken> = {};
    const compPatterns = componentsSection.split(/\n(?=(?:[A-Z]\w[\w\s]*?)(?:\n|:)|###?\s+)/);
    for (const block of compPatterns) {
      const nameMatch = block.match(/^(?:###?\s+)?([A-Z]\w[\w\s/]+?)(?:\s*:)?(?:\n|$)/m);
      if (!nameMatch) continue;
      const compName = nameMatch[1]!.trim().toLowerCase().replace(/[\s/]+/g, '-');
      if (['overview', 'colors', 'typography', 'layout', 'components', 'elevation', 'shapes', "do's", "don'ts", 'dos', 'donts', 'introduction'].includes(compName)) continue;
      const comp: ComponentToken = {};
      const bgMatch = block.match(/(?:Color|Background|Fondo|Bg)[:\s]+(.+?)(?:\n|$)/i);
      if (bgMatch) {
        const val = bgMatch[1]!.trim();
        const hex = val.match(/#([A-Fa-f0-9]{6})/);
        if (hex) comp.backgroundColor = `#${hex[1]!.toUpperCase()}`;
        else if (val.includes('tertiary') || val.includes('amber') || val.includes('ámbar'))
          comp.backgroundColor = '#F4A261';
        else if (val.includes('primary') || val.includes('azul') || val.includes('blue'))
          comp.backgroundColor = '#1A5F7A';
        else if (val.includes('secondary') || val.includes('verde') || val.includes('green'))
          comp.backgroundColor = '#2E8B57';
        else if (val.includes('neutral') || val.includes('blanco') || val.includes('white') || val.includes('#FFF'))
          comp.backgroundColor = '#FFFFFF';
      }
      const fgMatch = block.match(/(?:Texto|Text|Color de texto)[:\s]+(.+?)(?:\n|$)/i);
      if (fgMatch) {
        const val = fgMatch[1]!.trim();
        if (val.includes('blanco') || val.includes('white') || val.includes('#FFF') || val.includes('#FFFFFF'))
          comp.textColor = '#FFFFFF';
        else if (val.includes('#') && val.match(/#([A-Fa-f0-9]{6})/))
          comp.textColor = `#${val.match(/#([A-Fa-f0-9]{6})/)![1]!.toUpperCase()}`;
        else comp.textColor = '#1A1C1E';
      }
      const rdMatch = block.match(/(?:rounded|border radius|border-radius|redondeado)[.\s:]+(.+?)(?:\n|$)/i);
      if (rdMatch) {
        const val = rdMatch[1]!.trim();
        const px = val.match(/(\d+)\s*px/);
        if (px) comp.rounded = `${px[1]}px`;
        else if (val.includes('sm')) comp.rounded = '6px';
        else if (val.includes('md')) comp.rounded = '12px';
        else if (val.includes('lg')) comp.rounded = '20px';
      }
      const padMatch = block.match(/(?:Padding|pad)[:\s]+(.+?)(?:\n|$)/i);
      if (padMatch) {
        const val = padMatch[1]!.trim();
        const px = val.match(/(\d+)\s*px/);
        if (px) comp.padding = `${px[1]}px`;
      }
      if (comp.backgroundColor || comp.textColor || comp.rounded || comp.padding) {
        components[compName] = comp;
      }
    }
    if (Object.keys(components).length > 0) tokens.components = components;
  }

  DESIGN_MD_CACHE.set(content, Object.keys(tokens).length > 0 ? tokens : null);
  return Object.keys(tokens).length > 0 ? tokens : null;
}

function extractSection(content: string, names: string[]): string | null {
  // Also try Spanish equivalents
  const spanishAliases: Record<string, string[]> = {
    colors: ["colores", "paleta", "color", "paleta de colores"],
    typography: ["tipografía", "tipografia", "fuentes", "fonts"],
    components: ["componentes", "ui clave", "componentes ui"],
    spacing: ["espaciado", "espacio", "layout"],
    elevation: ["elevación", "elevacion", "sombras"],
    shapes: ["formas", "bordes", "border", "rounded"],
  };
  // For each name, also try its Spanish aliases
  const allNames = [...names];
  for (const n of names) {
    const lower = n.toLowerCase();
    if (spanishAliases[lower]) {
      allNames.push(...spanishAliases[lower]);
    }
  }
  for (const name of allNames) {
    const patterns = [
      new RegExp(`##+\\s*\\d*\\.?\\s*${escapeRegex(name)}[^\\n]*(?:\\n(?:[^#][^\\n]*|\\s*)?)*`, 'i'),
      new RegExp(`\\*\\*${escapeRegex(name)}\\*\\*[^\\n]*(?:\\n(?!##|\\*\\*)[^\\n]*)*`, 'i'),
    ];
    for (const pattern of patterns) {
      const m = pattern.exec(content);
      if (m) return m[0];
    }
  }
  return null;
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ─── YAML Front-matter parser ────────────────────────────────

function parseYamlFrontMatter(content: string): { frontMatter: DesignTokens | null; body: string } {
  const m = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!m) return { frontMatter: null, body: content };

  const rawYaml: string = m[1] ?? "";
  const body: string = (m[2] ?? "").trim();
  const tokens: DesignTokens = {};
  let currentSection: string | null = null;

  const lines = rawYaml.split("\n");
  for (const line of lines) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;

    const sec = t.match(/^(\w+):\s*$/);
    if (sec) {
      currentSection = sec[1]!;
      continue;
    }

    if (currentSection === "typography") {
      if (!tokens.typography) tokens.typography = {};

      const inlineTypo = t.match(/^([\w-]+):\s*\{([^}]+)\}\s*$/);
      if (inlineTypo) {
        const sk = inlineTypo[1]!;
        const props = parseInlineTokenProps(inlineTypo[2]!);
        if (sk === "font-sans" && props.fontFamily) {
          tokens.typography[sk] = { fontFamily: props.fontFamily };
        } else {
          tokens.typography[sk] = typographyFromInlineProps(props);
        }
        continue;
      }

      const fontSansArr = t.match(/^font-sans:\s*(.+)$/i);
      if (fontSansArr) {
        const raw = fontSansArr[1]!.replace(/[\[\]]/g, "");
        const families = raw
          .split(",")
          .map((f) => f.trim().replace(/^['"]|['"]$/g, ""))
          .filter(Boolean);
        tokens.typography["font-sans"] = {
          fontFamily: families.map((f) => (f.includes(" ") ? `'${f}'` : f)).join(", "),
        };
        continue;
      }

      const sub = t.match(/^([\w-]+):\s*$/);
      if (sub) {
        const sk = sub[1]!;
        if (!tokens.typography[sk]) tokens.typography[sk] = {};
        continue;
      }

      const kv = t.match(/^([\w-]+):\s*["']?(.+?)["']?\s*$/);
      if (kv) {
        const k = kv[1]!;
        const v = kv[2]!.replace(/["']/g, "").replace(/\s+#.*$/, "");
        const typoKeys = tokens.typography ? Object.keys(tokens.typography) : [];
        if (typoKeys.length > 0) {
          const lastKey = typoKeys[typoKeys.length - 1]!;
          if (!tokens.typography[lastKey]) tokens.typography[lastKey] = {};
          (tokens.typography[lastKey] as Record<string, string>)[k] = v;
        }
      }
      continue;
    }

    if (currentSection === "components") {
      const sub = t.match(/^(\S+):\s*$/);
      if (sub) {
        const sk = sub[1]!;
        if (!tokens.components) tokens.components = {};
        if (!tokens.components[sk]) tokens.components[sk] = {};
        continue;
      }
      const kv = t.match(/^(\w+):\s*["']?(.+?)["']?\s*$/);
      if (kv) {
        const k = kv[1]!;
        const v = kv[2]!.replace(/["']/g, "").replace(/\s+#.*$/, "");
        const compKeys = tokens.components ? Object.keys(tokens.components) : [];
        if (compKeys.length > 0) {
          const lastKey: string = compKeys[compKeys.length - 1]!;
          if (!tokens.components![lastKey]) tokens.components![lastKey] = {};
          (tokens.components![lastKey] as Record<string, string>)[k] = v;
        }
      }
      continue;
    }

    if (currentSection === "elevation") {
      if (!tokens.elevation) tokens.elevation = {};
      const inlineElev = t.match(/^([\w-]+):\s*\{([^}]+)\}\s*$/);
      if (inlineElev) {
        const props = parseInlineTokenProps(inlineElev[2]!);
        tokens.elevation[inlineElev[1]!] =
          props.boxShadow ?? props.shadow ?? inlineElev[2]!;
        continue;
      }
      const kv = t.match(/^(\S+):\s*["']?(.+?)["']?\s*$/);
      if (kv) {
        tokens.elevation[kv[1]!] = kv[2]!.replace(/["']/g, "");
      }
      continue;
    }

    if (currentSection && ["colors", "rounded", "spacing"].includes(currentSection)) {
      const kv = t.match(/^(\S+):\s*["']?(.+?)["']?\s*$/);
      if (kv) {
        const k = kv[1]!;
        let v = kv[2]!.replace(/["']/g, "").replace(/\s+#.*$/, "");
        if (/^\d+(\.\d+)?$/.test(v)) v = `${v}px`;
        const s = tokens as Record<string, Record<string, string>>;
        if (!s[currentSection]) s[currentSection] = {};
        s[currentSection]![k] = v;
      }
      continue;
    }

    if (!currentSection) {
      const kv = t.match(/^(\w+):\s*["']?(.+?)["']?\s*$/);
      if (kv && kv[1] && ["name", "description", "version"].includes(kv[1])) {
        (tokens as Record<string, string>)[kv[1]] = kv[2]!.replace(/["']/g, "").replace(/\s+#.*$/, "");
      }
    }
  }

  return { frontMatter: tokens, body };
}

function typographyFromInlineProps(props: Record<string, string>): TypographyToken {
  const token: TypographyToken = {};
  if (props.fontFamily) token.fontFamily = props.fontFamily;
  if (props.fontSize) token.fontSize = props.fontSize;
  if (props.fontWeight) {
    const w = parseInt(props.fontWeight, 10);
    token.fontWeight = Number.isNaN(w) ? props.fontWeight : w;
  }
  if (props.lineHeight) token.lineHeight = props.lineHeight;
  if (props.letterSpacing) token.letterSpacing = props.letterSpacing;
  return token;
}

// ─── Relleno automático de secciones faltantes ─────────────

function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const c = hex.replace("#", "");
  if (c.length !== 6) return null;
  return {
    r: parseInt(c.slice(0, 2), 16),
    g: parseInt(c.slice(2, 4), 16),
    b: parseInt(c.slice(4, 6), 16),
  };
}

function rgbToHex(r: number, g: number, b: number): string {
  const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
  return `#${[r, g, b].map((v) => clamp(v).toString(16).padStart(2, "0")).join("").toUpperCase()}`;
}

function lighten(hex: string, factor: number): string {
  const rgb = hexToRgb(hex);
  if (!rgb) return hex;
  return rgbToHex(
    rgb.r + (255 - rgb.r) * factor,
    rgb.g + (255 - rgb.g) * factor,
    rgb.b + (255 - rgb.b) * factor,
  );
}

function darken(hex: string, factor: number): string {
  const rgb = hexToRgb(hex);
  if (!rgb) return hex;
  return rgbToHex(
    rgb.r * (1 - factor),
    rgb.g * (1 - factor),
    rgb.b * (1 - factor),
  );
}

/** Saturación HSL aproximada (0–1) para distinguir colores de marca de neutros. */
function colorSaturation(hex: string): number {
  const rgb = hexToRgb(hex.startsWith("#") ? hex : `#${hex}`);
  if (!rgb) return 0;
  const r = rgb.r / 255;
  const g = rgb.g / 255;
  const b = rgb.b / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max === min) return 0;
  const l = (max + min) / 2;
  const d = max - min;
  return l > 0.5 ? d / (2 - max - min) : d / (max + min);
}

/**
 * Elige el color de marca más saturado de la paleta, ignorando neutros
 * (grises, blancos, negros) y las claves ya excluidas. Sirve para DESIGN.md con
 * tokens de nombre específico (p. ej. `stripe-indigo`) sin claves semánticas.
 */
function pickBrandColor(
  colors: Record<string, string>,
  exclude: string[] = [],
): string | undefined {
  const excluded = new Set(exclude.map((v) => v.toUpperCase()));
  let best: { hex: string; saturation: number } | undefined;
  for (const value of Object.values(colors)) {
    const hex = (value.startsWith("#") ? value : `#${value}`).toUpperCase();
    if (!/^#[0-9A-F]{6}$/.test(hex) || excluded.has(hex)) continue;
    const saturation = colorSaturation(hex);
    if (saturation < 0.18) continue;
    if (!best || saturation > best.saturation) best = { hex, saturation };
  }
  return best?.hex;
}

const DEFAULT_TYPOGRAPHY: Record<string, TypographyToken> = {
  "font-sans": { fontFamily: "'Inter', system-ui, -apple-system, sans-serif" },
  h1: { fontSize: "32px", fontWeight: 700, lineHeight: "40px", letterSpacing: "-0.02em" },
  h2: { fontSize: "24px", fontWeight: 600, lineHeight: "32px", letterSpacing: "-0.01em" },
  h3: { fontSize: "20px", fontWeight: 600, lineHeight: "28px" },
  h4: { fontSize: "18px", fontWeight: 600, lineHeight: "24px" },
  "body-md": { fontSize: "16px", fontWeight: 400, lineHeight: "26px" },
  "body-sm": { fontSize: "14px", fontWeight: 400, lineHeight: "22px" },
  "label-sm": { fontSize: "14px", fontWeight: 500, lineHeight: "20px" },
  caption: { fontSize: "12px", fontWeight: 400, lineHeight: "16px" },
  overline: { fontSize: "10px", fontWeight: 600, lineHeight: "14px", letterSpacing: "0.08em" },
};

const DEFAULT_ROUNDED: Record<string, string> = {
  none: "0px", sm: "6px", md: "12px", lg: "20px", xl: "28px", full: "9999px",
};

const DEFAULT_SPACING: Record<string, string> = {
  xxs: "2px", xs: "4px", sm: "8px", md: "16px", lg: "24px", xl: "32px", "2xl": "48px", "3xl": "64px",
};

export function fillDesignMdDefaults(tokens: DesignTokens | null): DesignTokens | null {
  if (!tokens) return null;
  const t = { ...tokens };

  const sharedFilled = fillSemanticTokens(
    {
      colors: t.colors,
      typography: t.typography as Record<string, unknown> | undefined,
      spacing: t.spacing,
      rounded: t.rounded,
      primitives: t.primitives,
    },
    shadcnZincPreset,
  );

  if (sharedFilled.primitives) {
    t.primitives = sharedFilled.primitives;
  }

  const previewCtx: DesignTokens = {
    colors: sharedFilled.colors ?? t.colors,
    primitives: t.primitives,
  };

  if (sharedFilled.colors) {
    const c = { ...sharedFilled.colors };
    const p =
      hexValue(c["primary"] || c["brand"] || pickBrandColor(c) || "#18181b", previewCtx);
    c["primary"] ??= p;
    const accent =
      c["accent"] || c["secondary"] || pickBrandColor(c, [p]);
    c["secondary"] ??= accent ?? p;
    c["destructive"] ??= hexValue(c["danger"] ?? "#ef4444", previewCtx);
    c["foreground"] ??= darken(p, 0.8) || "#18181b";
    c["background"] ??= hexValue(c["background"] ?? "#fafafa", previewCtx);
    c["muted"] ??= lighten(p, 0.85);
    c["border"] ??= lighten(p, 0.7);
    c["success"] ??= hexValue(c["success"] ?? "#22c55e", previewCtx);
    c["warning"] ??= hexValue(c["warning"] ?? "#f59e0b", previewCtx);
    c["neutral"] ??= hexValue(c["muted"] ?? lighten(p, 0.8), previewCtx);
    c["accent"] ??= accent ?? p;
    c["danger"] ??= c["destructive"];
    c["info"] ??= "#3B82F6";
    t.colors = c;
  } else if (t.colors && Object.keys(t.colors).length > 0) {
    const c = { ...t.colors };
    const p = c["primary"] || c["brand"] || pickBrandColor(c) || "#3B82F6";
    c["primary"] ??= p;
    const accent =
      c["accent"] || c["secondary"] || pickBrandColor(c, [p]);
    c["secondary"] ??= accent ?? p;
    c["destructive"] ??= c["danger"] ?? "#DC2626";
    c["foreground"] ??= (darken(p, 0.8) || "#1A1A2E");
    c["background"] ??= "#FFFFFF";
    c["muted"] ??= lighten(p, 0.85);
    c["border"] ??= lighten(p, 0.7);
    c["success"] ??= "#16A34A";
    c["warning"] ??= "#F59E0B";
    c["info"] ??= "#3B82F6";
    t.colors = c;
  }

  // Fill typography — merge defaults so preview always has a visible scale
  t.typography = mergeTypographyTokens(
    DEFAULT_TYPOGRAPHY,
    (sharedFilled.typography as typeof t.typography) ?? t.typography,
  );

  // Fill rounded
  if (!t.rounded || Object.keys(t.rounded).length === 0) {
    t.rounded = { ...(sharedFilled.rounded ?? DEFAULT_ROUNDED) };
  }

  // Fill spacing
  if (!t.spacing || Object.keys(t.spacing).length === 0) {
    t.spacing = { ...(sharedFilled.spacing ?? DEFAULT_SPACING) };
  }

  // Fill elevation
  t.elevation = normalizeElevationTokens({
    ...ELEVATION_PRESETS,
    ...(t.elevation ?? {}),
  });

  // Fill components
  if (t.colors && (!t.components || Object.keys(t.components).length === 0)) {
    const c = t.colors;
    t.components = {
      "button-primary": { backgroundColor: c["tertiary"] || "#F4A261", textColor: "#FFFFFF", rounded: "{rounded.sm}", padding: "12px 20px", typography: "label-sm" },
      "button-secondary": { backgroundColor: c["primary"] || "#1A5F7A", textColor: "#FFFFFF", rounded: "{rounded.sm}", padding: "12px 20px", typography: "label-sm" },
      "button-ghost": { backgroundColor: "transparent", textColor: c["primary"] || "#1A5F7A", rounded: "{rounded.sm}", padding: "8px 16px" },
      "button-danger": { backgroundColor: "#DC2626", textColor: "#FFFFFF", rounded: "{rounded.sm}", padding: "12px 20px", typography: "label-sm" },
      card: { backgroundColor: c["neutral"] || "#F5F7FA", textColor: c["foreground"] || "#1A1A2E", rounded: "{rounded.md}", padding: "24px" },
      badge: { backgroundColor: c["tertiary"] || "#F4A261", textColor: "#FFFFFF", rounded: "{rounded.full}", padding: "4px 10px" },
      input: { backgroundColor: "#FFFFFF", textColor: c["foreground"] || "#1A1A2E", rounded: "{rounded.sm}", padding: "10px 14px" },
      modal: { backgroundColor: "#FFFFFF", rounded: "{rounded.lg}", padding: "24px" },
      toast: { backgroundColor: c["foreground"] || "#1A1A2E", textColor: "#FFFFFF", rounded: "{rounded.md}", padding: "12px 16px" },
      skeleton: { backgroundColor: c["muted"] || "#E8ECF0", rounded: "{rounded.sm}" },
    };
  }

  return t;
}


// ─── Componente principal ────────────────────────────────────

export function DesignMdPreview({ content }: { content: string }) {
  const frontMatter = useMemo(() => {
    const { frontMatter: yaml } = parseYamlFrontMatter(content);
    const bodyTokens = parseDesignMdContent(content);

    // Merge: YAML frontmatter takes precedence, body markdown fills gaps
    // (e.g. PrimaryHover, Surface, SurfaceHover, Accent defined in body tables)
    if (yaml && (yaml.colors || yaml.typography || yaml.components)) {
      // Merge body tokens into YAML — each section independently
      // (YAML may have typography but no colors, or vice versa)
      if (bodyTokens?.colors) {
        if (yaml.colors) {
          for (const [k, v] of Object.entries(bodyTokens.colors)) {
            if (!(k in yaml.colors)) yaml.colors[k] = v;
          }
        } else {
          yaml.colors = { ...bodyTokens.colors };
        }
      }
      if (bodyTokens?.typography) {
        if (yaml.typography) {
          for (const [k, v] of Object.entries(bodyTokens.typography)) {
            if (!(k in yaml.typography)) yaml.typography[k] = v;
          }
        } else {
          yaml.typography = { ...bodyTokens.typography };
        }
      }
      if (bodyTokens?.components) {
        if (yaml.components) {
          for (const [k, v] of Object.entries(bodyTokens.components)) {
            if (!(k in yaml.components)) yaml.components[k] = v;
          }
        } else {
          yaml.components = { ...bodyTokens.components };
        }
      }
      return fillDesignMdDefaults(yaml);
    }
    return fillDesignMdDefaults(bodyTokens);
  }, [content]);


  const title = useMemo(() => {
    if (frontMatter?.name) return frontMatter.name;
    const h1 = content.match(/^#\s+(.+)/m);
    return h1?.[1] ?? "Vista previa de diseño";
  }, [content, frontMatter]);

  const description = useMemo(() => {
    if (frontMatter?.description) return frontMatter.description;
    const overview = extractSection(content, ["overview", "introduction", "intro"]);
    if (overview) {
      const firstLine = overview.split("\n").slice(1).find(l => l.trim() && !l.startsWith("#"));
      return firstLine?.trim() ?? null;
    }
    return null;
  }, [content, frontMatter]);

  if (!frontMatter || (!frontMatter.colors && !frontMatter.typography && !frontMatter.components)) {
    return (
      <div className="flex min-h-[200px] items-center justify-center bg-[var(--background)] p-6 text-sm text-[var(--foreground-muted)]">
        No se encontraron tokens de diseño en formato DESIGN.md. Genera el Design System para ver la vista previa visual.
      </div>
    );
  }

  return (
    <DesignSystemCustomizer
      tokens={frontMatter}
      title={title ?? undefined}
      description={description}
    />
  );
}

export function extractDesignMdFrontMatter(content: string): DesignTokens | null {
  const { frontMatter: yaml } = parseYamlFrontMatter(content);
  const bodyTokens = parseDesignMdContent(content);

  if (yaml && (yaml.colors || yaml.typography || yaml.components)) {
    // Merge body tokens into YAML — each section independently
    if (bodyTokens?.colors) {
      if (yaml.colors) {
        for (const [k, v] of Object.entries(bodyTokens.colors)) {
          if (!(k in yaml.colors)) yaml.colors[k] = v;
        }
      } else {
        yaml.colors = { ...bodyTokens.colors };
      }
    }
    if (bodyTokens?.typography) {
      if (yaml.typography) {
        for (const [k, v] of Object.entries(bodyTokens.typography)) {
          if (!(k in yaml.typography)) yaml.typography[k] = v;
        }
      } else {
        yaml.typography = { ...bodyTokens.typography };
      }
    }
    if (bodyTokens?.components) {
      if (yaml.components) {
        for (const [k, v] of Object.entries(bodyTokens.components)) {
          if (!(k in yaml.components)) yaml.components[k] = v;
        }
      } else {
        yaml.components = { ...bodyTokens.components };
      }
    }
    return yaml;
  }
  return bodyTokens;
}

/**
 * Convierte DesignTokens a string YAML frontmatter para prepender al markdown.
 * Útil cuando el orquestador no devuelve YAML frontmatter en la guía UX/UI.
 */
export function tokensToYamlFrontMatter(tokens: DesignTokens): string {
  const lines: string[] = ["---"];
  if (tokens.name) lines.push(`name: ${JSON.stringify(tokens.name)}`);

  function writeSection(key: string, obj: Record<string, unknown> | undefined, indent = 0): void {
    if (!obj || Object.keys(obj).length === 0) return;
    const pad = "  ".repeat(indent);
    lines.push(`${pad}${key}:`);
    for (const [k, v] of Object.entries(obj)) {
      const innerPad = "  ".repeat(indent + 1);
      if (v !== null && typeof v === "object") {
        lines.push(`${innerPad}${k}:`);
        for (const [sk, sv] of Object.entries(v as Record<string, unknown>)) {
          if (typeof sv === "string" || typeof sv === "number") {
            if (typeof sv === "string" && (sv.includes(":") || sv.startsWith("{") || sv.startsWith("#") || sv.includes("'") || sv.includes('"'))) {
              lines.push(`${innerPad}  ${sk}: ${JSON.stringify(sv)}`);
            } else {
              lines.push(`${innerPad}  ${sk}: ${sv}`);
            }
          }
        }
      } else if (typeof v === "string" || typeof v === "number") {
        if (typeof v === "string" && (v.includes(":") || v.startsWith("{") || v.startsWith("#") || v.includes("'"))) {
          lines.push(`${innerPad}${k}: ${JSON.stringify(v)}`);
        } else {
          lines.push(`${innerPad}${k}: ${v}`);
        }
      }
    }
  }

  if (tokens.version) lines.push(`version: ${tokens.version}`);

  writeSection("colors", tokens.colors as Record<string, unknown>);
  writeSection("typography", tokens.typography as Record<string, unknown>);
  writeSection("rounded", tokens.rounded as Record<string, unknown>);
  writeSection("spacing", tokens.spacing as Record<string, unknown>);
  writeSection("elevation", tokens.elevation as Record<string, unknown>);
  writeSection("components", tokens.components as Record<string, unknown>);

  lines.push("---");
  return lines.join("\n");
}

/**
 * Reemplaza el YAML frontmatter del contenido de la guía UX/UI a partir del body markdown.
 * - Si ya tiene YAML frontmatter, lo extrae y regenera desde el body.
 * - Si no tiene YAML frontmatter, lo genera desde el markdown.
 * - Si no se pueden extraer tokens, devuelve el contenido original sin cambios.
 */
export function replaceYamlFrontMatter(content: string, projectName?: string): string {
  const { body } = parseYamlFrontMatter(content);
  let tokens = extractDesignMdFrontMatter(content);
  if (!tokens) {
    // Sin YAML ni tokens detectables — crear defaults desde el nombre del proyecto
    tokens = { name: projectName } as DesignTokens;
  }
  const filled = fillDesignMdDefaults(tokens);
  if (!filled) return content;
  if (projectName && !filled.name) filled.name = projectName;
  const yamlStr = tokensToYamlFrontMatter(filled);
  return yamlStr + "\n\n" + body;
}
