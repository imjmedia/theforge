/**
 * Server-side design-system token lint (warn-only; complements @google/design.md CLI).
 */

import {
  fillSemanticTokens,
  findLooseHexColors,
  resolveStackPreset,
  type PartialDesignTokens,
} from "@theforge/shared-types";

export type DesignSystemLintFinding = {
  severity: "warning" | "info";
  message: string;
};

export type DesignSystemLintResult = {
  ok: boolean;
  findings: DesignSystemLintFinding[];
};

const REQUIRED_COLOR_KEYS = [
  "primary",
  "background",
  "foreground",
  "muted",
  "border",
  "destructive",
  "success",
  "warning",
];

function parseYamlFrontmatter(content: string): PartialDesignTokens | null {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return null;
  const yaml = match[1]!;
  const colors: Record<string, string> = {};
  for (const line of yaml.split("\n")) {
    const m = line.match(/^\s{2}([a-zA-Z0-9_-]+):\s*"?([^"#\n]+)"?\s*$/);
    if (m?.[1] && m[2]) colors[m[1]] = m[2].trim();
  }
  const colorSourceMatch = yaml.match(/^colorSource:\s*(\S+)/m);
  return {
    colors: Object.keys(colors).length > 0 ? colors : undefined,
    colorSource: colorSourceMatch?.[1] as PartialDesignTokens["colorSource"],
  };
}

/** Warn when semantic tokens missing or loose hex outside preset. */
export function lintDesignSystemTokens(
  content: string,
  mddMarkdown?: string | null,
  blueprintMarkdown?: string | null,
): DesignSystemLintResult {
  const findings: DesignSystemLintFinding[] = [];
  const preset = resolveStackPreset(mddMarkdown, blueprintMarkdown);
  const partial = parseYamlFrontmatter(content);
  const filled = fillSemanticTokens(partial, preset);

  for (const key of REQUIRED_COLOR_KEYS) {
    if (!filled.colors?.[key]) {
      findings.push({
        severity: "warning",
        message: `Token semántico obligatorio ausente: ${key}`,
      });
    }
  }

  if (!partial?.colorSource && filled.colorSource === "system-default") {
    findings.push({
      severity: "info",
      message: "colorSource: system-default aplicado (marca no determinada)",
    });
  }

  const looseHex = findLooseHexColors(content, preset);
  for (const hex of looseHex.slice(0, 5)) {
    findings.push({
      severity: "warning",
      message: `Hex suelto fuera del preset del stack: ${hex}`,
    });
  }

  return { ok: findings.every((f) => f.severity !== "warning"), findings };
}

export function formatDesignSystemLintSummary(result: DesignSystemLintResult): string {
  if (result.findings.length === 0) return "design-system lint: ok";
  const warnings = result.findings.filter((f) => f.severity === "warning").length;
  return `design-system lint: ${warnings} advertencia(s)`;
}
