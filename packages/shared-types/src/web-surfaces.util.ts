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
  /\bradix\b/i,
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

const NO_WEB_SURFACE_LINE =
  /(?:sin|no)\s+(?:dashboard|frontend|ui|interfaz|panel\s+web)|(?:mvp|fase\s*1)[^\n]{0,120}(?:sin|no\s+incluye|excluye|fuera\s+de)\s+(?:dashboard|frontend|ui|panel\s+web)|api[\s-]?only|solo\s+api|backend\s+only|cli[\s-]?only/i;

function lineDeclaresWebSurface(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed || NO_WEB_SURFACE_LINE.test(trimmed)) return false;
  return WEB_SURFACE_PATTERNS.some((re) => re.test(trimmed));
}

/** True when constitution or blueprint declares a web/SPA/admin UI surface. */
export function detectWebSurfaces(
  mddMarkdown?: string | null,
  blueprintMarkdown?: string | null,
): boolean {
  const corpus = `${mddMarkdown ?? ""}\n${blueprintMarkdown ?? ""}`.trim();
  if (!corpus) return false;
  for (const line of corpus.split("\n")) {
    if (lineDeclaresWebSurface(line)) return true;
  }
  return false;
}
