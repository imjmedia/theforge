/**
 * Post-proceso determinista de design-system.md / uxUiGuide YAML.
 */

import {
  fillSemanticTokens,
  resolveStackPreset,
  type PartialDesignTokens,
} from "@theforge/shared-types";

function parseFrontmatterBlock(content: string): { yaml: string; rest: string } | null {
  const match = content.match(/^---\n([\s\S]*?)\n---(\n[\s\S]*)?$/);
  if (!match) return null;
  return { yaml: match[1]!, rest: match[2] ?? "" };
}

function parsePartialTokens(yaml: string): PartialDesignTokens {
  const colors: Record<string, string> = {};
  let colorSource: PartialDesignTokens["colorSource"];
  let inColors = false;
  for (const line of yaml.split("\n")) {
    if (/^colors:\s*$/.test(line)) {
      inColors = true;
      continue;
    }
    if (inColors && /^\S/.test(line) && !/^\s/.test(line)) inColors = false;
    const cs = line.match(/^colorSource:\s*(\S+)/);
    if (cs?.[1]) colorSource = cs[1] as PartialDesignTokens["colorSource"];
    if (inColors) {
      const m = line.match(/^\s{2}([a-zA-Z0-9_-]+):\s*"?([^"\n]+)"?\s*$/);
      if (m?.[1] && m[2]) colors[m[1]] = m[2].trim();
    }
  }
  return { colors: Object.keys(colors).length > 0 ? colors : undefined, colorSource };
}

function serializeColorsYaml(colors: Record<string, string>): string {
  return Object.entries(colors)
    .map(([k, v]) => `  ${k}: "${v}"`)
    .join("\n");
}

/** Fills missing semantic tokens and colorSource in UX guide frontmatter. */
export function postProcessUxGuideDesignTokens(
  content: string,
  mddMarkdown?: string | null,
  blueprintMarkdown?: string | null,
): string {
  const block = parseFrontmatterBlock(content.trim());
  if (!block) return content;

  const preset = resolveStackPreset(mddMarkdown, blueprintMarkdown);
  const partial = parsePartialTokens(block.yaml);
  const filled = fillSemanticTokens(partial, preset);
  const colors = filled.colors ?? {};

  let yaml = block.yaml;
  if (!/^colorSource:/m.test(yaml)) {
    yaml = `colorSource: ${filled.colorSource}\n${yaml}`;
  } else {
    yaml = yaml.replace(/^colorSource:\s*\S+/m, `colorSource: ${filled.colorSource}`);
  }

  if (/^colors:\s*$/m.test(yaml)) {
    yaml = yaml.replace(/^colors:\s*$/m, `colors:\n${serializeColorsYaml(colors)}`);
  } else if (!/^colors:/m.test(yaml)) {
    yaml = `${yaml.trimEnd()}\ncolors:\n${serializeColorsYaml(colors)}`;
  } else {
    for (const [key, value] of Object.entries(colors)) {
      if (!new RegExp(`^\\s{2}${key}:`, "m").test(yaml)) {
        yaml = yaml.replace(/^colors:\s*$/m, `colors:\n  ${key}: "${value}"`);
      }
    }
  }

  const body = block.rest.trimStart();
  const themeSection =
    body.includes("## Tema canónico") || body.includes("## Layout & Responsive")
      ? ""
      : `\n\n## Tema canónico\n\n- **mode:** system\n- **stackBase:** ${preset.adapterLabel}\n- **colorSource:** ${filled.colorSource}\n\n## Layout & Responsive\n\n- Mobile-first; breakpoints sm/md/lg/xl.\n- Grid 8px; sin scroll horizontal.\n`;

  return `---\n${yaml.trim()}\n---${themeSection ? themeSection : "\n"}${body}`.trimEnd() + "\n";
}
