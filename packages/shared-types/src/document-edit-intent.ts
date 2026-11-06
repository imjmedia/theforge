/**
 * Heurísticas compartidas API/web: distinguir edición explícita de documento vs plática o preguntas del asistente.
 */

const DBGA_DOMAIN_EDIT_RE =
  /\b(kill\s*switch|tablero\s+de\s+aprob|firma\s+digital|validaci[oó]n\s+previa)\b/i;

const DBGA_VERB_WITH_DOC_RE =
  /\b(?:modific|actualiz|añad|agreg|quitar|cambiar|ajust|integrar|incorpor|reescrib|eliminar|corrige|aplica(?:r)?)\b[^.?!\n]{0,96}\b(?:documento|dbga|benchmark|fase\s*0|panel|an[aá]lisis\s*\(dbga\))\b/i;

const DBGA_DOC_TARGET_RE =
  /\b(?:al|en\s+el|del|sobre\s+el)\s+(?:documento|dbga|benchmark|panel|an[aá]lisis)\b/i;

const DBGA_IMPERATIVE_RE =
  /\b(?:haz\s+(?:las\s+modific|los\s+cambios|el\s+cambio|los\s+ajustes)|aplica\s+(?:los\s+)?cambios|aplica\s+el\s+cambio|persiste\s+en\s+el\s+panel|guarda\s+en\s+el\s+panel)\b/i;

/** Renombre / etiquetado explícito (p. ej. «llamarlos PAT Wasender» / «llámalo ya así»). */
const DBGA_RENAME_INTENT_RE =
  /\b(?:llamarl[oa]s|ll[aá]mal[oa]|renombr(?:ar|a|e)|n[oó]mbral[oa]s|denomin(?:ar|a)|para\s+evitar\s+confusiones)\b/i;

const DBGA_DOMAIN_WITH_VERB_RE =
  /\b(?:modific|actualiz|añad|agreg|ajust|incorpor|integr|corrige|cubr|elimina|saca|quita)/i;

/** Bloque markdown largo pegado por el usuario (spec externa, portal de licencias, etc.). */
export function hasEmbeddedSpecificationBlock(message: string): boolean {
  const m = message.trim();
  if (m.length < 500) return false;
  // Catálogo puro de endpoints REST (POST/GET…) no es un DBGA completo ni “spec” a sustituir el panel.
  if (looksLikeApiEndpointCatalog(m) && !/^#\s+(?:Domain\s+Benchmark|Fase\s+0|Research\s+Report)/im.test(m)) {
    return false;
  }
  return (
    /#\s+Especificaci[oó]n/i.test(m) ||
    /##\s+1\.\s+Visi[oó]n/i.test(m) ||
    /POST\s+[`'"]\/licenses/i.test(m) ||
    (/^---\s*$/m.test(m) && /\n##\s+\d+\./m.test(m)) ||
    ((m.match(/\n##\s+/g)?.length ?? 0) >= 3 && m.length >= 1200)
  );
}

/**
 * Lista numerada de rutas HTTP (POST/GET/…) — fragmento a integrar, no documento DBGA completo.
 * Evita que Fase 0 persista solo el catálogo y borre el panel.
 * Specs largas con título/secciones (p. ej. Portal de Licencias) no cuentan como catálogo.
 */
export function looksLikeApiEndpointCatalog(text: string): boolean {
  const t = text.trim();
  if (t.length < 80 || t.length > 12_000) return false;
  // Documento de especificación / DBGA con estructura real — no es un dump de endpoints.
  if (/#\s+Especificaci[oó]n/i.test(t)) return false;
  if (/##\s+1\.\s+Visi[oó]n/i.test(t)) return false;
  if ((t.match(/\n##\s+/g)?.length ?? 0) >= 3 && t.length >= 1200) return false;
  const methodHits = (t.match(/\b(?:GET|POST|PUT|PATCH|DELETE)\s+\/[v\w{}/:_-]+/gi) ?? []).length;
  if (methodHits < 3) return false;
  const numbered = (t.match(/(?:^|\n)\d+\.\s+/g) ?? []).length;
  const hasBenchmarkTitle =
    /^#\s+(?:Domain\s+Benchmark|Fase\s+0\s+[—–-]|Research\s+Report|Benchmark\s*&\s*Gap)/im.test(t);
  if (hasBenchmarkTitle && t.length > 4000) return false;
  // Catálogo corto dominado por verbos HTTP + outline 1/2/3
  return methodHits >= 4 || (methodHits >= 3 && numbered >= 2 && t.length < 3500);
}

/** Usuario pide integrar una spec pegada en el DBGA (no brainstorming). */
export function looksLikeDbgaSpecIntegrationRequest(message: string): boolean {
  const m = message.trim();
  if (!hasEmbeddedSpecificationBlock(m)) return false;
  return /\b(?:estas?\s+especificaci[oó]n|pudier[ae]\s+cumplir|debe\s+cumplir|lo\s+ideal\s+es\s+que|cumplir\s+con\s+est|integra(?:r)?\s+(?:en\s+el\s+)?(?:documento|dbga|panel)|incorpora(?:r)?\s+(?:en\s+el\s+)?(?:documento|dbga))\b/i.test(
    m,
  );
}

/** Cuerpo de documento DBGA en texto de chat (no debe mostrarse en chatLog). */
export function looksLikeDbgaDocumentBody(text: string): boolean {
  const t = text.trim();
  if (t.length < 450) return false;
  if (looksLikeApiEndpointCatalog(t)) return false;
  if (
    /^#\s+(?:Domain\s+Benchmark|Fase\s+0\s+[—–-]|Benchmark\s*&\s*Gap|Research\s+Report)/im.test(t)
  ) {
    return true;
  }
  if ((t.match(/\n##\s+/g)?.length ?? 0) >= 2) return true;
  if (/^\d+\.\s+Resumen Ejecutivo/im.test(t)) return true;
  if (/\n\d+\.\s+(?:Benchmark|Análisis|Oportunidades|Conclusiones)\b/im.test(t)) return true;
  if (/\n##\s+Registro de cambios del documento/im.test(t) && t.length >= 800) return true;
  return false;
}

/** Pregunta, propuesta condicional o brainstorming — no persistir DBGA todavía. */
export function isUserExploringDbgaIntent(message: string): boolean {
  const m = message.trim();
  if (!m) return false;

  if (isHypotheticalDocumentEditOffer(m)) return true;

  if (/\b(?:qu[eé]\s+suger|qu[eé]\s+tal|c[oó]mo\s+suger|c[oó]mo\s+manejar|c[oó]mo\s+lo\s+har[ií]as)\b/i.test(m)) {
    return true;
  }

  // Aclaración plugin vs motor / quién impone límites (charla antes de editar).
  if (
    /\b(?:los|esos|estos)\s+l[ií]mites?\b/i.test(m) &&
    /\b(?:plugin|motor|evd)\b/i.test(m)
  ) {
    return true;
  }
  if (/\b(?:impone|imponen)\b/i.test(m) && /\b(?:plugin|motor|evd)\b/i.test(m)) {
    return true;
  }
  if (/\b(?:plugin|evd)\b[^.?!\n]{0,160}\b(?:motor de licenc|nuestro motor)\b/i.test(m)) {
    return true;
  }

  if (/\b(?:¿te\s+parece\s+bien|te\s+parece\s+bien\s+esta|¿te\s+parece\s+correcto)\b/i.test(m)) {
    return true;
  }

  if (/\bsi\s+es\s+as[ií]\b/i.test(m) && /\b(integr|incorpor|añad|agreg|actualiz|modific|sac)\w*/i.test(m)) {
    return true;
  }

  if (/\?\s*$/.test(m) && !DBGA_IMPERATIVE_RE.test(m) && !/^(agrega|integra|actualiza|modifica|cubre|elimina|saca|quita)\b/i.test(m)) {
    return true;
  }

  return false;
}

/** Verbos de ubicación / nombrado / uso que presentan un dato del proyecto. */
const PROJECT_FACT_VERB_RE =
  /\b(?:se\s+encuentra(?:n)?\s+en|est[aá](?:n)?\s+(?:en|alojad[oa]s?\s+en|ubicad[oa]s?\s+en|desplegad[oa]s?\s+en|publicad[oa]s?\s+en|hospedad[oa]s?\s+en)|viv(?:e|en)\s+en|corre(?:n)?\s+en|se\s+llama(?:n)?|se\s+(?:usa|usar[aá]|utiliza|utilizar[aá])\b|usamos|utilizamos|usaremos|utilizaremos|el\s+dominio\s+(?:es|ser[aá])|la\s+url\s+(?:es|ser[aá])|el\s+(?:host|servidor|endpoint|puerto|repositorio|repo)\s+(?:es|ser[aá]))\b/i;

/** URL o dominio con TLD (sso.obp.mx, api.ejemplo.com, https://…). */
const PROJECT_FACT_URL_RE =
  /\bhttps?:\/\/\S+|\b[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:mx|com|net|org|io|dev|app|cloud|ai|co|es|lat|local|internal)\b/i;

/** Opinión, duda o condicional: no es un hecho que persistir sin confirmar. */
const PROJECT_FACT_HEDGE_RE =
  /\b(?:creo|pienso|me\s+parece|supongo|quiz[aá]s?|tal\s+vez|a\s+lo\s+mejor|podr[ií]a(?:n|mos)?|deber[ií]a(?:n|mos)?|ser[ií]a|no\s+s[eé]|no\s+estoy\s+segur[oa]|si\s+(?:fuera|fuese)|probablemente|posiblemente)\b/i;

/**
 * Afirmación corta que aporta un dato concreto del proyecto («el SSO corporativo se
 * encuentra en sso.obp.mx», «usamos Keycloak», «el dominio es app.acme.mx»).
 * Con documento en el panel, el usuario espera que ese dato quede reflejado sin tener
 * que añadir «haz los cambios al documento». No cubre preguntas, condicionales ni
 * mensajes largos (esos los resuelve el router LLM).
 */
export function looksLikeProjectFactStatement(message: string): boolean {
  const m = message.trim();
  if (m.length < 12 || m.length > 400) return false;
  if (/[?¿]/.test(m)) return false;
  if ((m.match(/\n/g)?.length ?? 0) > 2) return false;
  if (isUserExploringDbgaIntent(m)) return false;
  if (PROJECT_FACT_HEDGE_RE.test(m)) return false;
  return PROJECT_FACT_VERB_RE.test(m) || PROJECT_FACT_URL_RE.test(m);
}

/** El usuario pide persistir cambios en el DBGA/Fase 0 (no brainstorming ni Q&A). */
export function looksLikeDbgaEditRequest(message: string): boolean {
  const m = message.trim();
  if (!m || m.length < 12) return false;

  if (isUserExploringDbgaIntent(m)) return false;

  // Respuesta a pregunta pendiente con catálogo HTTP → editar documento (sin “integra en el DBGA”).
  if (looksLikeApiEndpointCatalog(m)) return true;

  if (looksLikeDbgaSpecIntegrationRequest(m)) return true;

  if (/^\s*¿/.test(m) && !DBGA_IMPERATIVE_RE.test(m) && !DBGA_VERB_WITH_DOC_RE.test(m)) {
    return false;
  }

  if (DBGA_VERB_WITH_DOC_RE.test(m) || DBGA_IMPERATIVE_RE.test(m)) {
    return true;
  }

  // «existen 2 PAT… llamarlos PAT Wasender y PAT SSO» + «haz los cambios»
  if (DBGA_RENAME_INTENT_RE.test(m) && (DBGA_DOC_TARGET_RE.test(m) || DBGA_IMPERATIVE_RE.test(m) || /\bPAT\b|\btoken\b|\bsecret\b/i.test(m))) {
    return true;
  }

  if (DBGA_DOC_TARGET_RE.test(m) && DBGA_DOMAIN_WITH_VERB_RE.test(m)) {
    return true;
  }

  if (DBGA_DOMAIN_WITH_VERB_RE.test(m) && /\b(?:gap|omisiones?\s+cr[ií]ticas?)\b/i.test(m)) {
    return true;
  }

  if (DBGA_DOMAIN_EDIT_RE.test(m)) return true;

  if (
    DBGA_DOMAIN_WITH_VERB_RE.test(m) &&
    /\b(?:tenant(?:_id)?|multi-?\s*tenant|espejo|catálogo|catalogo|obp4?mo)\b/i.test(m)
  ) {
    return true;
  }

  if (/\b(?:hay que|debe|necesit)\b/i.test(m) && DBGA_DOC_TARGET_RE.test(m)) return true;

  // Revisión/auditoría con gaps o enfoque de dominio → actualizar panel (no solo Q&A en chat).
  if (
    /\b(?:revis(?:a|ar|alo|en)|verific(?:a|ar|alo)|audit(?:a|ar|alo)|comprueb(?:a|ar|alo)|aseg[uú]r(?:a|ar|ate))\b/i.test(
      m,
    ) &&
    /\b(?:gap|brecha|gaps?|no\s+tenga\s+gaps?|sin\s+gaps?|agn[oó]stic|coherente|completo|omisiones?|motor\s+de\s+licenciamiento)\b/i.test(
      m,
    )
  ) {
    return true;
  }

  return false;
}

/** Oferta o pregunta del asistente («¿incorpore al DBGA?»), no afirmación de persistencia. */
export function isHypotheticalDocumentEditOffer(text: string): boolean {
  const t = (text ?? "").trim();
  if (!t) return false;

  if (
    /\b(?:prefieres|quieres|deseas|te\s+gustar[ií]a|puedo|podemos|deber[ií]a)\s+que\b[^.?!\n]{0,160}\b(?:incorpore|integre|añada|agregue|actualice|modifique|aplique|profundice)\b/i.test(
      t,
    )
  ) {
    return true;
  }

  if (
    /(?:^|[.!?]\s*|\n)\s*¿[^?\n]{0,240}\b(?:incorpore|integre|añada|agregue|actualice|modifique|aplique|profundice)\b/i.test(
      t,
    )
  ) {
    return true;
  }

  if (/\b(?:o\s+)?¿quieres\s+(?:mantenerlo|dejarlo)\s+fuera\s+del\s+documento\b/i.test(t)) {
    return true;
  }

  if (/\b¿te parece correcto\b/i.test(t)) return true;

  if (
    /\bsi es as[ií]\b/i.test(t) &&
    /\b(?:actualizar[eé]|integrar[eé]|incorporar[eé]|lo actualizar[eé]|lo integrar[eé])\b[^.?!\n]{0,120}\b(?:dbga|documento|panel|fase\s*0|benchmark)\b/i.test(
      t,
    )
  ) {
    return true;
  }

  if (
    /\b(?:actualizar[eé]|integrar[eé]|incorporar[eé])\s+(?:el\s+)?(?:dbga|documento|panel)\b/i.test(t) &&
    /\?/.test(t)
  ) {
    return true;
  }

  return false;
}

/** El asistente propone un cambio al documento y espera confirmación del usuario. */
export function isAssistantAwaitingDocumentEditApproval(text: string): boolean {
  return isHypotheticalDocumentEditOffer(text);
}
