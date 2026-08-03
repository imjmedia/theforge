/**
 * Detects web/SPA/admin UI surfaces from MDD §2 and Blueprint.
 */

const WEB_SURFACE_PATTERNS: RegExp[] = [
  /\breact\b/i,
  /\bvue\b/i,
  /\bangular\b/i,
  /\bsvelte\b/i,
  /\bnext\.?js\b/i,
  /\bvite\b/i,
  /\bspa\b/i,
  /\bpwa\b/i,
  /\btailwind\b/i,
  /\bshadcn\b/i,
  /\bfrontend\b/i,
  /\bapps\/(?:web|frontend|client)\b/i,
  /\badmin\s+panel\b/i,
  /\bpanel\s+administr/i,
  /\binterfaz\s+web\b/i,
  /\bweb\s+app\b/i,
  /\b###\s*2\.2\s+Frontend\b/i,
  /\b###\s+Frontend\b/i,
  /\b@imj_media\/ui\b/i,
  /\b@mui\/material\b/i,
  /\bmaterial-ui\b/i,
  /\bpackages\/ui\b/i,
  /\b@scope\/ui\b/i,
  /\b@org\/ui\b/i,
];

/** True when constitution or blueprint declares a web/SPA/admin UI surface. */
export function detectWebSurfaces(
  mddMarkdown?: string | null,
  blueprintMarkdown?: string | null,
): boolean {
  const corpus = `${mddMarkdown ?? ""}\n${blueprintMarkdown ?? ""}`.trim();
  if (!corpus) return false;
  return WEB_SURFACE_PATTERNS.some((re) => re.test(corpus));
}
