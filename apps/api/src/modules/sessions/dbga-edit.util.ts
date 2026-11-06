import {
  looksLikeDbgaEditRequest,
  looksLikeDbgaDocumentBody,
  looksLikeApiEndpointCatalog,
} from "@theforge/shared-types";

export { looksLikeDbgaEditRequest };

const DBGA_EDIT_STOPWORDS = new Set([
  "para",
  "como",
  "este",
  "esta",
  "esto",
  "todo",
  "toda",
  "todos",
  "todas",
  "debe",
  "deben",
  "hacer",
  "haz",
  "las",
  "los",
  "una",
  "uno",
  "con",
  "sin",
  "que",
  "del",
  "documento",
  "panel",
  "benchmark",
  "fase",
  "etapa",
  "principal",
  "cambios",
  "cambio",
  "encuentra",
  "encuentran",
]);

/** Acrónimos / etiquetas cortas que sí importan en renombres (PAT, SSO, API…). */
const DBGA_SHORT_TOKEN_ALLOW =
  /^(?:pat|sso|api|jwt|oidc|oauth|mfa|rbac|rds|eks|alb|iam|sql|http|https|ws|wss)$/i;

/** Palabras significativas del pedido del usuario (para reintentos y validación laxa). */
export function extractDbgaEditKeywords(message: string, max = 10): string[] {
  const words =
    message
      .toLowerCase()
      .match(/\b[\p{L}\p{N}]{3,}\b/gu) ?? [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const w of words) {
    if (DBGA_EDIT_STOPWORDS.has(w) || seen.has(w)) continue;
    if (w.length < 4 && !DBGA_SHORT_TOKEN_ALLOW.test(w)) continue;
    seen.add(w);
    out.push(w);
    if (out.length >= max) break;
  }
  return out;
}

/**
 * Nombres propuestos en renombres («llamarlos X y Y», «el TOKEN de Vendor»).
 * Si el usuario pide etiquetar conceptos, el doc debe contener esas etiquetas.
 */
export function extractDbgaProposedLabels(message: string, max = 6): string[] {
  const m = message.trim();
  if (!m) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (raw: string) => {
    const t = raw.replace(/\s+/g, " ").trim();
    if (t.length < 3 || t.length > 48) return;
    // Etiqueta = pocas palabras; rechazar cláusulas («es de la cuenta…»).
    if (t.split(/\s+/).length > 4) return;
    if (/^(?:es|de|la|el|para|con|un|una|que|y|o)\b/i.test(t)) return;
    const key = t.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push(t);
  };

  // «llámalo/la ya así» confirma un nombre ya dicho; no capturar la prosa que sigue.
  const isConfirmRenameOnly = /\bll[aá]mal[oa]\s+ya\s+as[ií]\b/i.test(m);

  // «llamarlos X y Y» / «renómbralo a X»
  if (!isConfirmRenameOnly) {
    const renameTail =
      m.match(
        /\b(?:llamarl[oa]s|ll[aá]mal[oa]|renombr(?:ar|a|e)|n[oó]mbral[oa]s|denomin(?:ar|a))\s+(?:como\s+|a\s+)?(.+?)(?:\.|$|\n|para\s+evitar)/isu,
      )?.[1] ?? "";
    const cleanedTail = renameTail.replace(/^["'«»()\s]+|["'«»()\s]+$/g, "").trim();
    if (cleanedTail && !/^ya\s+as[ií]\b/i.test(cleanedTail)) {
      for (const part of cleanedTail.split(/\s+y\s+|\s*,\s*|\s+o\s+/i)) {
        push(part.replace(/["'«»()]/g, "").trim());
      }
    }
  }

  // «el ACRÓNIMO de Vendor» / «ACRÓNIMO Vendor» (PAT, SSO, API, JWT…).
  for (const hit of m.matchAll(
    /\b((?:PAT|SSO|API|JWT|OIDC|OAuth|MFA|RBAC))\s+(?:de\s+)?([A-Za-zÁÉÍÓÚÜÑ][\wÁÉÍÓÚÜÑ-]{1,32})\b/giu,
  )) {
    const acronym = hit[1]!;
    const brand = hit[2]!;
    if (/^(?:de|del|la|el|un|una|para|con|que|y)$/i.test(brand)) continue;
    push(`${acronym.toUpperCase()} ${brand}`);
  }

  return out.slice(0, max);
}

export function dbgaContainsUserEditKeywords(doc: string, userMessage: string): boolean {
  const d = doc.toLowerCase();
  const keywords = extractDbgaEditKeywords(userMessage, 12);
  if (keywords.length === 0) return false;
  const matched = keywords.filter((k) => d.includes(k)).length;
  return matched >= Math.min(2, keywords.length);
}

export function normalizeDbgaForCompare(content: string): string {
  return content.replace(/\s+/g, " ").trim();
}

export function isDbgaContentNearlyIdentical(next: string, current: string): boolean {
  const a = normalizeDbgaForCompare(next);
  const b = normalizeDbgaForCompare(current);
  if (a === b) return true;
  const lenDiff = Math.abs(a.length - b.length);
  // Tolerancia ACOTADA. El factor proporcional anterior (`b.length * 0.008`) crecía
  // con el tamaño del documento: en un DBGA de ~90 KB el umbral llegaba a ~720 chars,
  // así que una aclaración legítima de 1–2 frases se descartaba como "sin cambios" y
  // el panel nunca se actualizaba (mensaje "No se guardaron cambios en Fase 0"). Con
  // el cap, cualquier edición real (> ~90–200 chars) se persiste; solo se considera
  // idéntico un eco casi textual del documento.
  const tolerance = Math.min(Math.max(64, b.length * 0.001), 200);
  return lenDiff < tolerance;
}

/**
 * Comprueba si el documento parece incorporar requisitos explícitos del mensaje del usuario.
 * Evita persistir un "DBGA actualizado" que solo repite el texto anterior.
 */
export function dbgaReflectsUserEditIntent(doc: string, userMessage: string): boolean {
  const d = doc.toLowerCase();
  const u = userMessage.toLowerCase();

  if (/\btenant[_\s-]?id\b|multi-?tenant|multi tenant/.test(u)) {
    if (!/\btenant_id\b/.test(d)) return false;
    if (/multi-?tenant|multi tenant/.test(u) && !/multi-?tenant|multi tenant|multi-tenancy/.test(d)) {
      return false;
    }
  }

  if (/catálogo de costos|catalogo de costos/.test(u) && /obp4?mo|obp\b/.test(u)) {
    if (/alimentad|espej|origen|tenant/.test(u) && !/tenant_id|espej|obp4?mo/.test(d)) {
      return false;
    }
  }

  if (/módulo\s*0?1|modulo\s*0?1/.test(u) && /aplicacion|aplicaciones|obp/.test(u)) {
    if (!/módulo\s*0?1|modulo\s*0?1|catálogo de costos/.test(d)) return false;
  }

  if (/\bespejo\b|tablas?\s+espejo|id\s+(de\s+)?origen|id\s+propio/i.test(u)) {
    const mirrorCols =
      /\borigen_id\b|\bsource_id\b|\bid_origen\b|\bid_fuente\b|\bid_espejo\b|\bmirror_id\b|\bid_propio\b|\bexternal_id\b|\btenant_id\b|CREATE\s+TABLE/i;
    if (!mirrorCols.test(d)) return false;
    if (/\borigen\b/i.test(u) && !/\borigen|origin|source|fuente|external/i.test(d)) return false;
    if (/\bpropio\b/i.test(u) && !/\bpropio|mirror_id|id_espejo|PRIMARY/i.test(d)) return false;
  }

  const geoMirror =
    /\b(pa[ií]s|paises|estados?|ciudades?|colonias?|c[oó]digos?\s*postales?|geograf|espejo)\b/i.test(
      u,
    );
  if (geoMirror) {
    const needsPaises = /\bpa[ií]s|paises\b/i.test(u);
    const needsEstados = /\bestados?\b/i.test(u);
    const needsCiudades = /\bciudades?\b/i.test(u);
    if (needsPaises && !/\bpaises\b|\bpa[ií]s\b/i.test(d)) return false;
    if (needsEstados && !/\bestados?\b/i.test(d)) return false;
    if (needsCiudades && !/\bciudades?\b/i.test(d)) return false;
    if (/\bespejo\b/i.test(u) && !/\bespejo\b|CREATE\s+TABLE/i.test(d)) return false;
  }

  if (/kill\s*switch|tablero\s+de\s+aprob|aprobaci[oó]n\s+humana|firma\s+digital|google\s+ads/i.test(u)) {
    if (
      !/kill\s*switch|tablero\s+de\s+aprob|aprobaci[oó]n\s+humana|firma\s+digital|validaci[oó]n\s+previa/i.test(
        d,
      )
    ) {
      return false;
    }
  }

  // Catálogo de endpoints pegado: exigir §11 / rutas de chat, no keywords sueltas.
  if (looksLikeApiEndpointCatalog(userMessage)) {
    return /##\s*11\.\s+|\/v1\/chats|API de Integraci[oó]n con Chat/i.test(d);
  }

  // Renombres: basta con que las etiquetas propuestas aparezcan en el doc.
  const proposed = extractDbgaProposedLabels(userMessage);
  if (proposed.length >= 1) {
    const hit = proposed.filter((label) => d.includes(label.toLowerCase())).length;
    if (hit >= Math.min(2, proposed.length) || (proposed.length === 1 && hit === 1)) {
      return true;
    }
    // Si pidió 2+ nombres y ninguno está, falla; si está 1 de 2, aún no basta.
    if (hit === 0) return false;
  }

  if (extractDbgaEditKeywords(userMessage, 8).length >= 2 && !dbgaContainsUserEditKeywords(doc, userMessage)) {
    return false;
  }

  return true;
}

/**
 * ¿Debemos tratar `next` como "sin cambios" respecto a `current`?
 * Renombres (p. ej. PAT Wasender) cambian poco el tamaño y antes se descartaban
 * por `isDbgaContentNearlyIdentical` aunque sí reflejaran el pedido.
 */
export function isDbgaEditEffectivelyUnchanged(
  next: string,
  current: string,
  userMessage: string,
): boolean {
  if (normalizeDbgaForCompare(next) === normalizeDbgaForCompare(current)) return true;
  if (!isDbgaContentNearlyIdentical(next, current)) return false;

  const proposed = extractDbgaProposedLabels(userMessage);
  if (proposed.length > 0) {
    const cur = current.toLowerCase();
    const nxt = next.toLowerCase();
    const newlyPresent = proposed.some(
      (label) => !cur.includes(label.toLowerCase()) && nxt.includes(label.toLowerCase()),
    );
    if (newlyPresent) return false;
  }

  if (
    dbgaReflectsUserEditIntent(next, userMessage) &&
    dbgaContainsUserEditKeywords(next, userMessage) &&
    !dbgaContainsUserEditKeywords(current, userMessage)
  ) {
    return false;
  }

  return true;
}

export const BENCHMARK_CHAT_ACK =
  "Fase 0 (DBGA) actualizado. Revisa el panel «Análisis (DBGA)».";

export const BENCHMARK_CHAT_NO_CHANGE =
  "No se guardaron cambios en Fase 0 (DBGA). El asistente no devolvió el documento completo listo para persistir, ni siquiera tras el reintento automático. Vuelve a pedirlo indicando qué sección cambiar (p. ej. «en Arquitectura, agrega que el SSO corporativo está en sso.obp.mx»).";

/** Evita mensaje de éxito en chat cuando el panel no se persistió. */
export function benchmarkAssistantChatMessage(
  rawChat: string,
  finalDbga: string | undefined,
): string {
  const chat = rawChat.trim();
  if (finalDbga?.trim()) {
    if (!chat || chat === BENCHMARK_CHAT_ACK || looksLikeDbgaDocumentBody(chat)) {
      return BENCHMARK_CHAT_ACK;
    }
    if (chat.length > 280 && looksLikeDbgaDocumentBody(chat.slice(0, Math.min(chat.length, 1200)))) {
      return BENCHMARK_CHAT_ACK;
    }
    return chat;
  }
  if (
    !chat ||
    chat === BENCHMARK_CHAT_ACK ||
    /^benchmark actualizado/i.test(chat) ||
    /^fase 0 \(dbga\) actualizado/i.test(chat) ||
    /\b(he|hemos)\s+(actualizado|modificado|integrado|incorporado|añadido)\b.*\b(documento|benchmark|dbga|fase\s*0|panel)\b/i.test(
      chat,
    ) ||
    /\bel\s+cambio\s+ya\s+est[aá]\s+reflejado\b/i.test(chat)
  ) {
    return BENCHMARK_CHAT_NO_CHANGE;
  }
  return chat;
}

/**
 * Marcador `---FIN_DBGA---` tolerante a las variantes que emiten los modelos:
 * - Con guiones a ambos lados (`---FIN_DBGA---`), solo a la izquierda (`---FIN_DBGA`)
 *   o solo a la derecha (`FIN_DBGA---`). Antes se exigía `-{1,}` en AMBOS lados, así
 *   que un cierre sin guiones finales (muy común) no se detectaba y el panel no se
 *   persistía.
 * - En su propia línea, opcionalmente envuelto por `#`, `*`, `>` o espacios
 *   (`## FIN_DBGA`, `**FIN_DBGA**`), con o sin salto de línea final.
 */
const FIN_DBGA_MARKER_RE =
  /-{1,}[ \t]*FIN_DBGA[ \t]*-*|FIN_DBGA[ \t]*-{1,}|(?:^|\n)[ \t>*#]*FIN_DBGA[ \t*]*(?=\r?\n|$)/i;

/** Separa documento DBGA del mensaje de chat (tolerante a `---FIN_DBGA---` pegado al texto). */
export function parseBenchmarkResponse(
  response: string,
): { docPart: string; chatPart: string } | null {
  const trimmed = response.trim();
  if (!trimmed) return null;
  const normalized = trimmed.replace(/[\u2010\u2011\u2012\u2013\u2014\u2015\u2212\uFE58\uFE63\uFF0D]/g, "-");
  const match = FIN_DBGA_MARKER_RE.exec(normalized);
  if (!match || match.index == null) return null;
  const idx = match.index;
  const docPart = trimmed.slice(0, idx).trim();
  const chatPart = trimmed.slice(idx + match[0].length).trim() || BENCHMARK_CHAT_ACK;
  if (!docPart) return null;
  return { docPart, chatPart };
}

/**
 * Gemma y otros modelos a menudo omiten `---FIN_DBGA---` aunque sí devuelvan el DBGA completo.
 * Acepta ese cuerpo solo si parece un documento de benchmark sustancial (no un stub de chat).
 */
export function acceptCompleteDbgaWithoutFinMarker(
  response: string,
  currentDbga?: string,
): { docPart: string; chatPart: string } | null {
  const trimmed = response.trim();
  if (!trimmed || parseBenchmarkResponse(trimmed)) return null;
  if (looksLikeApiEndpointCatalog(trimmed)) return null;

  const hasBenchmarkTitle =
    /^#\s+(?:Domain\s+Benchmark|Fase\s+0\s+[—–-]|Benchmark\s*&\s*Gap|Research\s+Report)/im.test(
      trimmed,
    );
  if (!hasBenchmarkTitle && !looksLikeDbgaDocumentBody(trimmed)) return null;

  const cur = (currentDbga ?? "").trim();
  const minLen = cur.length >= 4000 ? Math.floor(cur.length * 0.35) : 800;
  if (trimmed.length < minLen) return null;
  if (cur && wouldShrinkDbgaDangerously(cur, trimmed)) return null;

  return { docPart: trimmed, chatPart: BENCHMARK_CHAT_ACK };
}

/** El modelo a veces devuelve solo un fragmento (### Módulos…) sin el `# Research Report` inicial. */
export function isPartialBenchmarkDoc(docPart: string, current?: string): boolean {
  const p = docPart.trim();
  const cur = (current ?? "").trim();
  if (!p || !cur) return false;
  return !/^#\s/m.test(p) && (/^#\s/m.test(cur) || cur.length > 800);
}

/**
 * Integra un fragmento parcial en el DBGA completo (conserva cabecera / metadata del panel).
 */
export function mergeBenchmarkPartialDoc(current: string, partial: string): string {
  const cur = current.trim();
  let par = partial.trim();
  if (!par) return cur;
  if (/^#\s/m.test(par)) return par;

  // El modelo a veces antepone "Etapa: …" al fragmento; no debe sobrescribir la cabecera del panel.
  if (/^Etapa:\s*/im.test(par) && /###\s+Módulos del proyecto/im.test(par)) {
    par = par.replace(/^Etapa:\s*[^\n]+\n+/im, "").trim();
  }

  const anchors = [
    /^###\s+Módulos del proyecto/im,
    /^##\s+Dos objetivos centrales/im,
    /^##\s+Arquitectura/im,
    /^#\s+Research Report/im,
    /^#\s+Domain Benchmark/im,
  ] as const;

  for (const anchor of anchors) {
    const parMatch = par.match(anchor);
    if (!parMatch || parMatch.index == null) continue;
    const curIdx = cur.search(anchor);
    if (curIdx >= 0) {
      return `${cur.slice(0, curIdx).trimEnd()}\n\n${par.slice(parMatch.index).trim()}`.trim();
    }
  }

  const headEnd = cur.search(/\n(?:##|###)\s+/);
  if (headEnd > 0) {
    return `${cur.slice(0, headEnd).trimEnd()}\n\n${par}`.trim();
  }
  return `${cur}\n\n---\n\n${par}`.trim();
}

const BENCHMARK_BODY_MARKERS = [
  /^#\s+Research Report/im,
  /^#\s+Domain Benchmark/im,
  /^#\s+Fase 0 —/im,
  /^##\s+Dos objetivos centrales/im,
  /^##\s+1\.\s+Referencia de Industria/im,
  /^##\s+2\.\s+Funcionalidades/im,
  /^###\s+Módulos del proyecto/im,
  /^##\s+Arquitectura/im,
] as const;

function countBenchmarkBodySections(text: string): number {
  return BENCHMARK_BODY_MARKERS.filter((re) => re.test(text)).length;
}

/** Rechaza persistir un DBGA que borra la mayor parte del documento actual (p. ej. fragmento sin merge). */
export function wouldShrinkDbgaDangerously(
  current: string,
  next: string,
  minRatio = 0.55,
): boolean {
  const c = current.trim();
  const n = next.trim();
  if (!c || c.length < 400) return false;
  if (!n) return true;

  const bodyBefore = countBenchmarkBodySections(c);
  const bodyAfter = countBenchmarkBodySections(n);
  if (
    bodyBefore >= 2 &&
    bodyAfter < bodyBefore - 1 &&
    n.length < c.length * 0.75
  ) {
    return true;
  }
  if (
    /^#\s+Research Report/im.test(c) &&
    !/^#\s+Research Report/im.test(n) &&
    /^##\s+Registro de cambios/im.test(n) &&
    n.length < c.length * 0.7
  ) {
    return true;
  }
  if (
    (/^#\s+Domain Benchmark/im.test(c) || /^#\s+Fase 0 —/im.test(c)) &&
    !/^#\s+Domain Benchmark/im.test(n) &&
    !/^#\s+Fase 0 —/im.test(n) &&
    /^##\s+Registro de cambios/im.test(n) &&
    n.length < c.length * 0.7
  ) {
    return true;
  }

  // Catálogo de endpoints / lista corta no sustituye un DBGA largo
  if (n.length < c.length * minRatio) {
    if (/^#\s/m.test(n) && n.length >= c.length * 0.7) return false;
    return true;
  }
  return false;
}
