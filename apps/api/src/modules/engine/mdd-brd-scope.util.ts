/**
 * Señales de alcance BRD/MDD §1: fuera de alcance dashboard web y multi-tenant SaaS.
 */

const OUT_OF_SCOPE_MARKER =
  /fuera\s+de\s+alcance|out\s+of\s+scope|no\s+(?:incluye|contempla|hace)|excluido\s+del\s+(?:mvp|alcance)/i;

/** True si el corpus excluye explícitamente panel/dashboard web. */
export function corpusExcludesDashboardWeb(corpus: string): boolean {
  const text = corpus ?? "";
  if (
    /fuera\s+de\s+alcance[^\n]{0,140}(?:dashboard|panel\s+web|interfaz\s+web|ui\s+web|frontend\s+web|portal\s+web|aplicaci[oó]n\s+web)/i.test(
      text,
    ) ||
    /(?:dashboard|panel\s+web|portal\s+web)[^\n]{0,80}fuera\s+de\s+alcance/i.test(text) ||
    /no\s+(?:incluye|contempla)[^\n]{0,100}(?:dashboard|panel\s+web|interfaz\s+gr[aá]fica)/i.test(text)
  ) {
    return true;
  }
  return false;
}

/** True si fuera de alcance excluye multi-tenant SaaS / billing compartido. */
export function corpusExcludesMultiTenantSaaS(corpus: string): boolean {
  const text = corpus ?? "";
  if (!OUT_OF_SCOPE_MARKER.test(text)) return false;
  return /\bmulti[\s-]?tenant\b|\bsaas\b|facturaci[oó]n\s+multi|billing\s+multi|modelo\s+saas|arrendamiento\s+multi|multiinquilino/i.test(
    text,
  );
}

export function buildScopeCorpus(params: {
  mddMarkdown?: string | null;
  brdMarkdown?: string | null;
  dbgaMarkdown?: string | null;
}): string {
  return [params.brdMarkdown, params.dbgaMarkdown, params.mddMarkdown].filter(Boolean).join("\n");
}
