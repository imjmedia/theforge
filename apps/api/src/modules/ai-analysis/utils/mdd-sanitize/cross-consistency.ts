import { extractMddSectionBody } from "./section-body.util.js";
import {
  draftUsesLdapPrimaryAuth,
  fixIntegrationMetadataCoherence,
  fixSecurityManifestCoherence,
} from "./security-manifest.js";
import {
  sanitizeAllSqlBlocksInDraft,
  sqlBlockContainsProseArtifact,
} from "./sql-repair.js";
import { stripStrayParenAfterJsonCodeBlocks } from "./persist-format.util.js";

const AUTHORITATIVE_BACKEND_PATTERNS: Array<[RegExp, string]> = [
  [/fastify/i, "Fastify"],
  [/fastapi/i, "FastAPI"],
  [/nestjs/i, "NestJS"],
  [/express/i, "Express"],
  [/django/i, "Django"],
];

/** Cláusulas alternativas de stack a eliminar en §1 cuando §2 ya fijó el backend. */
const ALTERNATE_BACKEND_CLAUSE_PATTERNS: Record<string, RegExp[]> = {
  Fastify: [
    /\s*(?:,\s*)?(?:o|or|\/|\|)\s*Python\s*\(\s*FastAPI\s*\)/gi,
    /\s*(?:,\s*)?(?:o|or|\/|\|)\s*FastAPI\b(?:\s*\([^)]*\))?/gi,
    /\s*(?:,\s*)?(?:o|or|\/|\|)\s*Python\b[^.\n;]*\bFastAPI\b/gi,
  ],
  FastAPI: [
    /\s*(?:,\s*)?(?:o|or|\/|\|)\s*Node\.js\s*\(\s*Fastify\s*\)/gi,
    /\s*(?:,\s*)?(?:o|or|\/|\|)\s*Fastify\b(?:\s*\([^)]*\))?/gi,
    /\s*(?:,\s*)?(?:o|or|\/|\|)\s*Node\.js\b[^.\n;]*\bFastify\b/gi,
  ],
  NestJS: [
    /\s*(?:,\s*)?(?:o|or|\/|\|)\s*(?:Python\s*\(\s*FastAPI\s*\)|FastAPI|Fastify|Express)\b[^.\n;]*/gi,
  ],
};

function resolveAuthoritativeBackendFromSection2(draft: string): string | undefined {
  const sec2 = extractMddSectionBody(draft, "## 2. Arquitectura y Stack");
  if (!sec2?.body.trim()) return undefined;
  for (const [re, label] of AUTHORITATIVE_BACKEND_PATTERNS) {
    if (re.test(sec2.body)) return label;
  }
  return undefined;
}

export function stripAlternateBackendFromSection1(draft: string): string {
  if (!draft?.trim()) return draft;
  const backend = resolveAuthoritativeBackendFromSection2(draft);
  const patterns = backend ? ALTERNATE_BACKEND_CLAUSE_PATTERNS[backend] : undefined;
  if (!patterns?.length) return draft;

  const sec1 = extractMddSectionBody(draft, "## 1. Contexto");
  if (!sec1) return draft;

  let body = sec1.body;
  for (const re of patterns) {
    body = body.replace(re, "");
  }
  body = body.replace(/\s{2,}/g, " ").replace(/ +\n/g, "\n");
  if (body === sec1.body) return draft;
  return draft.slice(0, sec1.start) + body + draft.slice(sec1.end);
}

/**
 * Correcciones deterministas de coherencia cross-sección (sin LLM): monolito vs microservicios,
 * prefijo API en manifest, retención de auditoría.
 */
export function fixDeterministicMddCoherence(draft: string): string {
  if (!draft || typeof draft !== "string") return draft;
  let out = draft;

  const arch = extractMddSectionBody(out, "## 2. Arquitectura y Stack");
  const isModularMonolith =
    arch != null &&
    /monolito\s+modular|única unidad de despliegue|single deployment|único despliegue/i.test(arch.body);

  if (isModularMonolith) {
    const infra = extractMddSectionBody(out, "## 7. Infraestructura");
    if (infra) {
      let body = infra.body;
      const replaced = body.replace(
        /\b(comunicaciones?|tráfico|conexiones?)\s+entre\s+microservicios?\b/gi,
        "$1 entre módulos internos del monolito",
      );
      const replaced2 = replaced.replace(
        /\bentre\s+microservicios?\b/gi,
        "entre módulos internos",
      );
      if (replaced2 !== body) {
        out = out.slice(0, infra.start) + replaced2 + out.slice(infra.end);
      }
    }
  }

  const manifestPrefixMatch = out.match(/"api_prefix"\s*:\s*"([^"]+)"/);
  const manifestPrefix = manifestPrefixMatch?.[1] ?? null;

  const contratos = extractMddSectionBody(out, "## 4. Contratos de API");
  if (contratos) {
    let body = contratos.body;
    const routeCounts = countSection4RoutePrefixes(body);
    const dominantPrefix = resolveDominantApiPrefix(routeCounts);

    if (manifestPrefix === "/api/v1") {
      if (routeCounts.bare > routeCounts.v1 && routeCounts.bare >= routeCounts.api) {
        body = prefixSection4TableRoutes(body, "/api/v1");
      }
      if (/\/api\/(?!v1[/"'])/i.test(body)) {
        body = upgradeSection4ApiRoutesToV1(body);
      }
    } else if (dominantPrefix && manifestPrefix && dominantPrefix !== manifestPrefix) {
      out = out.replace(
        /"api_prefix"\s*:\s*"[^"]*"/g,
        `"api_prefix": "${dominantPrefix}"`,
      );
    } else if (dominantPrefix && !manifestPrefix) {
      out = out.replace(
        /("integration_metadata"\s*:\s*\{)/,
        `$1\n    "api_prefix": "${dominantPrefix}",`,
      );
    }

    if (body !== contratos.body) {
      out = out.slice(0, contratos.start) + body + out.slice(contratos.end);
    }
  }

  const auditImmutableContext = [
    "## 5. Lógica y Edge Cases",
    "## 6. Seguridad",
    "## 7. Infraestructura",
  ].some((heading) => {
    const section = extractMddSectionBody(out, heading);
    return section != null && bodyImpliesImmutableAudit(section.body);
  });

  for (const heading of [
    "## 5. Lógica y Edge Cases",
    "## 6. Seguridad",
    "## 7. Infraestructura",
  ]) {
    const section = extractMddSectionBody(out, heading);
    if (!section) continue;
    const body = fixImmutableAuditRetentionInBody(section.body, auditImmutableContext);
    if (body !== section.body) {
      out = out.slice(0, section.start) + body + out.slice(section.end);
    }
  }

  out = fixLdapAuthCoherenceInDraft(out);
  out = fixSecurityManifestCoherence(out);
  out = fixIntegrationMetadataCoherence(out);
  out = alignJwtAlgorithmWithSection6(out);
  out = fixJwtEnvVarsInDraft(out);
  out = alignInfraNodeVersionWithSection2(out);
  out = stripStrayParenAfterJsonCodeBlocks(out);
  out = upgradeNonSection4ApiPathsToV1(out);
  out = deduplicateUatSections(out);
  out = stripAlternateBackendFromSection1(out);

  return out;
}

function fixLdapAuthCoherenceInDraft(draft: string): string {
  if (!draftUsesLdapPrimaryAuth(draft)) return draft;
  const section = extractMddSectionBody(draft, "## 6. Seguridad");
  if (!section) return draft;

  let body = section.body;
  const ldapUserPasswordRe =
    /Las contraseñas de los usuarios se almacenan hasheadas con Argon2id[^.\n]*\./i;
  if (ldapUserPasswordRe.test(body)) {
    body = body.replace(
      ldapUserPasswordRe,
      "Los usuarios corporativos no almacenan contraseña local; la validación se delega a LDAP/AD. Solo la cuenta bootstrap del super administrador usa hash local (Argon2id: memoria 64 MB, tiempo 3, paralelismo 4).",
    );
  }

  const genericHashRe =
    /El hashing de contraseñas usa Argon2id con sales aleatorias de 16 bytes\./i;
  if (genericHashRe.test(body)) {
    body = body.replace(
      genericHashRe,
      "El hashing local (Argon2id, sal 16 bytes) aplica únicamente al bootstrap del super administrador y a secretos de aplicación (client_secret_hash).",
    );
  }

  const manifestMfa = draft.match(/"mfa_strategy"\s*:\s*"([^"]+)"/i)?.[1];
  if (manifestMfa && !/\bMFA\b|\bTOTP\b/i.test(body)) {
    const mfaBullet = `- MFA obligatorio para roles privilegiados (admin_security, ciso) mediante ${manifestMfa} (RFC 6238), con registro en auditoría.`;
    const authHeading = body.search(/###\s+Autenticación/i);
    if (authHeading !== -1) {
      const lineEnd = body.indexOf("\n", authHeading);
      const insertAt = lineEnd === -1 ? body.length : lineEnd + 1;
      body = body.slice(0, insertAt) + mfaBullet + "\n" + body.slice(insertAt);
    } else {
      body = `${mfaBullet}\n${body}`;
    }
  }

  if (body === section.body) return draft;
  return draft.slice(0, section.start) + body + draft.slice(section.end);
}

/** True si §6 documenta JWT asimétrico (RS256, par de claves, JWKS). */
export function draftUsesRs256Jwt(draft: string): boolean {
  const sec6 = extractMddSectionBody(draft, "## 6. Seguridad");
  if (!sec6) return false;
  return /RS256|clave\s+pública|public\s+key|par\s+de\s+claves|JWKS|jwt.*asymmetr/i.test(sec6.body);
}

/** RS256 en MDD §6 o en entregables derivados (tasks, user stories) cuando §6 falta/truncada. */
export function corpusUsesRs256Jwt(mddMarkdown: string, extraCorpus = ""): boolean {
  if (draftUsesRs256Jwt(mddMarkdown)) return true;
  const extra = (extraCorpus ?? "").trim();
  if (!extra) return false;
  return /RS256|JWT_PRIVATE_KEY|JWT_PUBLIC_KEY|firmados?\s+con\s+RS256/i.test(extra);
}

function extractJwtAlgorithmFromSection6(draft: string): "RS256" | "HS256" | null {
  const sec6 = extractMddSectionBody(draft, "## 6. Seguridad");
  if (!sec6) return null;
  if (/RS256|JWKS|clave\s+pública|public\s+key|par\s+de\s+claves|asymmetr/i.test(sec6.body)) {
    return "RS256";
  }
  if (/HS256|JWT_SECRET|simétric|symmetric|HMAC/i.test(sec6.body)) return "HS256";
  return null;
}

/** Extrae algoritmo JWT inferido de §7 / manifest. */
function extractJwtAlgorithmFromSection7(draft: string): "RS256" | "HS256" | null {
  const manifestAlg = draft.match(/"jwt_algorithm"\s*:\s*"(RS256|HS256)"/i)?.[1];
  if (manifestAlg) return manifestAlg.toUpperCase() as "RS256" | "HS256";
  const infra = extractMddSectionBody(draft, "## 7. Infraestructura");
  const body = infra?.body ?? draft;
  if (/JWT_PRIVATE_KEY|JWKS|RS256/i.test(body) && !/\bJWT_SECRET\b/.test(body)) return "RS256";
  if (/\bJWT_SECRET\b/.test(body) && !/JWT_PRIVATE_KEY/.test(body)) return "HS256";
  if (/jwks_enabled"\s*:\s*true/i.test(body)) return "RS256";
  if (/\(\s*HS256\s*\)/i.test(body)) return "HS256";
  if (/\(\s*RS256\s*\)/i.test(body)) return "RS256";
  return null;
}

/** True si §6 y §7 documentan algoritmos JWT distintos. */
export function detectJwtAlgorithmMismatch(draft: string): boolean {
  const s6 = extractJwtAlgorithmFromSection6(draft);
  const s7 = extractJwtAlgorithmFromSection7(draft);
  return s6 != null && s7 != null && s6 !== s7;
}

/** Alinea §7 al algoritmo JWT de §6 (SSOT). */
export function fixJwtAlgorithmCoherence(draft: string): string {
  return alignJwtAlgorithmWithSection6(draft);
}

/** Alinea §7 al algoritmo JWT de §6 (SSOT). */
function alignJwtAlgorithmWithSection6(draft: string): string {
  const s6Alg = extractJwtAlgorithmFromSection6(draft);
  if (!s6Alg || !detectJwtAlgorithmMismatch(draft)) return draft;
  let out = draft;

  const infra = extractMddSectionBody(out, "## 7. Infraestructura");
  if (infra) {
    let body = infra.body;
    if (s6Alg === "RS256") {
      body = body
        .replace(/\(\s*HS256\s*\)/gi, "(RS256)")
        .replace(/\bHS256\b/g, "RS256")
        .replace(/\bJWT_SECRET\b/g, "JWT_PRIVATE_KEY, JWT_PUBLIC_KEY");
      if (/"jwt_algorithm"\s*:\s*"HS256"/i.test(body)) {
        body = body.replace(/"jwt_algorithm"\s*:\s*"HS256"/gi, '"jwt_algorithm": "RS256"');
      } else if (!/"jwt_algorithm"\s*:/i.test(body)) {
        body = body.replace(
          /("security"\s*:\s*\{)/i,
          '$1\n      "jwt_algorithm": "RS256",',
        );
      }
      if (/"jwks_enabled"\s*:\s*false/i.test(body)) {
        body = body.replace(/"jwks_enabled"\s*:\s*false/gi, '"jwks_enabled": true');
      }
    } else {
      body = body
        .replace(/\(\s*RS256\s*\)/gi, "(HS256)")
        .replace(/JWT_PRIVATE_KEY,\s*JWT_PUBLIC_KEY/gi, "JWT_SECRET")
        .replace(/"jwt_algorithm"\s*:\s*"RS256"/gi, '"jwt_algorithm": "HS256"');
    }
    if (body !== infra.body) {
      out = out.slice(0, infra.start) + body + out.slice(infra.end);
    }
  }
  return out;
}

/** Extrae versión mayor de Node.js declarada en §2. */
export function extractNodeVersionFromSection2(draft: string): string | null {
  const arch = extractMddSectionBody(draft, "## 2. Arquitectura y Stack");
  if (!arch) return null;
  const patterns = [
    /Node\.?js\s*(?:LTS\s*)?(\d{2}(?:\.\d+)?)/i,
    /\|\s*Node(?:\.js)?\s*\|\s*(\d{2}(?:\.\d+)?)/i,
    /runtime\s+Node\s*(\d{2})/i,
  ];
  for (const re of patterns) {
    const m = arch.body.match(re);
    if (m?.[1]) return m[1].split(".")[0]!;
  }
  return null;
}

/** Corrige `node:XX` en §7/manifest para coincidir con la versión Node de §2. */
export function alignInfraNodeVersionWithSection2(draft: string): string {
  const nodeVer = extractNodeVersionFromSection2(draft);
  if (!nodeVer) return draft;
  let out = draft.replace(/node:(\d+)(-alpine)?/gi, (_, _v: string, suffix: string) =>
    `node:${nodeVer}${suffix ?? ""}`,
  );
  out = out.replace(/\bNode\s+(\d+)(-alpine)?\b/gi, (_, _v: string, suffix: string) =>
    `Node ${nodeVer}${suffix ?? ""}`,
  );
  return out;
}

function extractInfraSectionBodyForNodeCheck(draft: string): string | null {
  const sec7 = extractMddSectionBody(draft, "## 7. Infraestructura");
  if (sec7?.body?.trim()) return sec7.body;
  const integration = extractMddSectionBody(draft, "## Integración");
  return integration?.body?.trim() ? integration.body : null;
}

/** Devuelve el mensaje de blocker si §7 cita `node:XX` distinto al declarado en §2. */
export function detectSection2Section7NodeVersionMismatchIssue(draft: string): string | null {
  const nodeVer = extractNodeVersionFromSection2(draft);
  if (!nodeVer) return null;
  const infraBody = extractInfraSectionBodyForNodeCheck(draft);
  if (infraBody == null) return null;
  const nodeMismatch =
    /node:(\d+)/i.test(infraBody) &&
    !new RegExp(`node:${nodeVer}(?:-|$)`, "i").test(infraBody);
  if (!nodeMismatch) return null;
  return `§7/manifest: versión Node distinta a §2 (esperado node:${nodeVer}-alpine).`;
}

/** Sustituye JWT_SECRET por JWT_PRIVATE_KEY/JWT_PUBLIC_KEY cuando §6 exige RS256. */
function fixJwtEnvVarsInDraft(draft: string): string {
  if (!draftUsesRs256Jwt(draft)) return draft;
  let out = draft;
  for (const heading of ["## 7. Infraestructura", "## Integración"]) {
    const section = extractMddSectionBody(out, heading);
    if (!section) continue;
    let body = section.body;
    const updated = body
      .replace(/\bJWT_SECRET\b/g, "JWT_PRIVATE_KEY, JWT_PUBLIC_KEY")
      .replace(
        /NODE_ENV,\s*JWT_PRIVATE_KEY,\s*JWT_PUBLIC_KEY,\s*JWT_EXPIRES_IN/gi,
        "NODE_ENV, JWT_PRIVATE_KEY, JWT_PUBLIC_KEY, JWT_EXPIRES_IN",
      );
    if (updated !== body) {
      out = out.slice(0, section.start) + updated + out.slice(section.end);
    }
  }
  return out;
}

function upgradeNonSection4ApiPathsToV1(draft: string): string {
  const manifestPrefix = draft.match(/"api_prefix"\s*:\s*"([^"]+)"/)?.[1];
  if (manifestPrefix !== "/api/v1") return draft;

  let out = draft;
  for (const heading of [
    "## 5. Lógica y Edge Cases",
    "## 6. Seguridad",
    "## 7. Infraestructura",
  ]) {
    const section = extractMddSectionBody(out, heading);
    if (!section || !/\/api\/(?!v1\/)/i.test(section.body)) continue;
    const body = section.body.replace(/\/api\/(?!v1[/"'])/gi, "/api/v1/");
    out = out.slice(0, section.start) + body + out.slice(section.end);
  }
  return out;
}

function countSection4RoutePrefixes(body: string): { bare: number; api: number; v1: number } {
  const counts = { bare: 0, api: 0, v1: 0 };
  const routes = body.matchAll(/\|\s*(?:GET|POST|PUT|DELETE|PATCH)\s*\|\s*(\/[^\s|]+)/gi);
  for (const match of routes) {
    const path = match[1] ?? "";
    if (path.startsWith("/api/v1/") || path === "/api/v1") counts.v1++;
    else if (path.startsWith("/api/") || path === "/api") counts.api++;
    else counts.bare++;
  }
  return counts;
}

function resolveDominantApiPrefix(counts: { bare: number; api: number; v1: number }): string | null {
  const { bare, api, v1 } = counts;
  const total = bare + api + v1;
  if (total === 0) return null;
  if (v1 >= api && v1 >= bare) return "/api/v1";
  if (api >= bare) return "/api";
  return "/";
}

/** Antepone prefijo a rutas de la tabla resumen §4 que no llevan /api. */
function prefixSection4TableRoutes(body: string, prefix: string): string {
  const normalized = prefix.endsWith("/") ? prefix.slice(0, -1) : prefix;
  return body.replace(
    /(\|\s*(?:GET|POST|PUT|DELETE|PATCH)\s*\|\s*)(\/(?!api\/)([^\s|]+))/gi,
    (_, lead: string, path: string) => `${lead}${normalized}${path}`,
  );
}

/** Promueve rutas `/api/...` a `/api/v1/...` en tabla y headings de §4 (manifest declara v1). */
function upgradeSection4ApiRoutesToV1(body: string): string {
  const toV1 = (path: string) => path.replace(/\/api\/(?!v1[/"'])/gi, "/api/v1/");
  let out = body.replace(
    /(\|\s*(?:GET|POST|PUT|DELETE|PATCH)\s*\|\s*)(`?)(\/api\/(?!v1[/"'])[^\s`|]+)(`?)/gi,
    (_m, lead: string, q1: string, path: string, q2: string) =>
      `${lead}${q1}${toV1(path)}${q2}`,
  );
  out = out.replace(
    /(#{2,6}\s*(?:GET|POST|PUT|DELETE|PATCH)\s+)(\/api\/(?!v1[/"'])[^\s\n]+)/gi,
    (_m, lead: string, path: string) => `${lead}${toV1(path)}`,
  );
  return out;
}

function bodyImpliesImmutableAudit(body: string): boolean {
  return /inmutable|append-only|no pueden ser modificados ni eliminados|previene\s+UPDATE\s+y\s+DELETE|nunca\s+UPDATE|solo\s+INSERT/i.test(
    body,
  );
}

function bodyHasDestructiveAuditRetention(body: string): boolean {
  return /elimina(?:r)?\s+particiones|drop\s+de\s+particiones|drop\s+particiones|dropea\s+la\s+partici[oó]n|dropea\s+de\s+la\s+base|purga(?:n)?\s+autom[aá]ticamente|purga\s+controlada|purga\s+la\s+base\s+de\s+datos|job\s+de\s+drop|drop\s+de\s+partici[oó]n|dropea\s+la\s+partici[oó]n\s+correspondiente|elimina\s+de\s+la\s+tabla\s+[`']?audit_events[`']?|elimina\s+de\s+audit_events|se\s+elimina\s+de\s+la\s+tabla/i.test(
    body,
  );
}

/** Sustituye purga/drop destructivo cuando el texto exige auditoría inmutable. */
function fixImmutableAuditRetentionInBody(
  body: string,
  draftHasImmutableAuditContext = false,
): string {
  if (
    !bodyHasDestructiveAuditRetention(body) ||
    (!draftHasImmutableAuditContext && !bodyImpliesImmutableAudit(body))
  ) {
    return body;
  }
  return body
    .replace(
      /Los eventos solo se purga(?:n)?\s+autom[aá]ticamente[^.\n]*/gi,
      "Los eventos solo se archivan a cold storage inmutable al cumplir 5 años (detach de partición, sin DELETE de filas)",
    )
    .replace(
      /purga(?:n)?\s+autom[aá]ticamente[^.\n]*/gi,
      "archiva particiones completas a cold storage inmutable tras exportación verificada",
    )
    .replace(
      /purga\s+controlada[^.\n]*/gi,
      "archivado a cold storage inmutable (sin DELETE en filas de auditoría)",
    )
    .replace(
      /dropea\s+la\s+partici[oó]n\s+correspondiente[^.\n]*/gi,
      "archiva la partición correspondiente a cold storage inmutable tras exportación verificada",
    )
    .replace(
      /exporta\s+la\s+partici[oó]n\s+a\s+backup\s+fr[ií]o[^.\n]*\s+y\s+la\s+dropea[^.\n]*/gi,
      "exporta la partición a backup frío (S3/Blob) y la desacopla (DETACH) sin borrar el archivo inmutable",
    )
    .replace(
      /elimina(?:r)?\s+particiones[^.\n]*/gi,
      "archiva particiones completas a almacenamiento cold storage inmutable",
    )
    .replace(
      /drop\s+de\s+particiones[^.\n]*/gi,
      "archiva particiones completas a almacenamiento cold storage inmutable",
    )
    .replace(
      /drop\s+particiones[^.\n]*/gi,
      "archiva particiones completas a almacenamiento cold storage inmutable",
    )
    .replace(
      /job\s+de\s+drop\s+de\s+partici[oó]n[^.\n]*/gi,
      "job de archivado y detach de partición a cold storage inmutable",
    )
    .replace(
      /elimina\s+de\s+la\s+tabla\s+[`']?audit_events[`']?[^.\n]*/gi,
      "archiva filas de audit_events a cold storage inmutable (detach de partición, sin DELETE)",
    )
    .replace(
      /elimina\s+de\s+audit_events[^.\n]*/gi,
      "archiva registros de audit_events a cold storage inmutable (sin DELETE en filas)",
    )
    .replace(
      /se\s+elimina\s+de\s+la\s+tabla[^.\n]*/gi,
      "se archiva a cold storage inmutable (detach de partición, sin DELETE en filas de auditoría)",
    )
    .replace(
      /purga\s+la\s+base\s+de\s+datos[^.\n]*/gi,
      "archiva datos de auditoría a cold storage inmutable (sin purga destructiva de filas)",
    );
}

const OUTBOX_TABLE_DDL = `
-- =====================================================
-- Outbox (Outbox Pattern) — eventos pendientes de publicar
-- =====================================================
CREATE TABLE outbox (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  aggregate_type VARCHAR(100) NOT NULL,
  aggregate_id UUID,
  event_type VARCHAR(100) NOT NULL,
  payload JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  published_at TIMESTAMPTZ,
  retry_count INTEGER NOT NULL DEFAULT 0,
  last_error TEXT
);
CREATE INDEX idx_outbox_unpublished ON outbox (created_at) WHERE published_at IS NULL;
`;

const OUTBOX_LIKE_STATUS_COLUMN_RE =
  /\b(procesado|processed_at|published_at|retry_count|event_type|tipo_evento|evento_tipo)\b/i;

function isOutboxLikeTableDef(tableName: string, colsBody: string): boolean {
  const bare = tableName.includes(".") ? tableName.split(".").pop()! : tableName;
  const lower = bare.toLowerCase();
  if (/^(outbox_events|eventos_outbox|outbox)$/.test(lower)) return true;
  if (lower === "eventos") {
    const hasPayload = /\bpayload(_json)?\b/i.test(colsBody);
    const hasStatus =
      OUTBOX_LIKE_STATUS_COLUMN_RE.test(colsBody) || /\bidempotency_key\b/i.test(colsBody);
    return hasPayload && hasStatus;
  }
  return /\bpayload(_json)?\b/i.test(colsBody) && OUTBOX_LIKE_STATUS_COLUMN_RE.test(colsBody);
}

function listOutboxLikeTablesInSql(sql: string): string[] {
  const found: string[] = [];
  const tableRe =
    /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:([\w]+)\.)?([\w]+)\s*\(([\s\S]*?)\)\s*;/gi;
  let m: RegExpExecArray | null;
  while ((m = tableRe.exec(sql)) !== null) {
    const schema = m[1];
    const name = m[2]!;
    const cols = m[3]!;
    const qualified = (schema ? `${schema}.${name}` : name).toLowerCase();
    if (isOutboxLikeTableDef(qualified, cols)) found.push(qualified);
  }
  return found;
}

function listOutboxLikeTablesInDraft(draft: string): string[] {
  const section = extractMddSectionBody(draft, "## 3. Modelo de Datos");
  if (!section) return [];
  const tables: string[] = [];
  for (const [, inner] of section.body.matchAll(/```sql\s*([\s\S]*?)```/gi)) {
    if (!inner) continue;
    for (const t of listOutboxLikeTablesInSql(inner)) {
      if (!tables.includes(t)) tables.push(t);
    }
  }
  return tables;
}

function bareOutboxTableName(qualified: string): string {
  return qualified.includes(".") ? qualified.split(".").pop()! : qualified;
}

function resolveCanonicalOutboxTableName(draft: string, tables: string[]): string {
  for (const heading of [
    "## 2. Arquitectura y Stack",
    "## 5. Lógica y Edge Cases",
    "## 7. Infraestructura",
  ]) {
    const section = extractMddSectionBody(draft, heading);
    if (!section) continue;
    for (const t of tables) {
      const bare = bareOutboxTableName(t);
      if (new RegExp(`\\btabla\\s+${bare}\\b|\\b${bare}\\b`, "i").test(section.body)) return t;
    }
  }
  const priority = ["outbox_events", "eventos_outbox", "eventos", "outbox"];
  for (const p of priority) {
    const match = tables.find((t) => t === p || t.endsWith(`.${p}`));
    if (match) return match;
  }
  return tables[0]!;
}

function removeOutboxLikeTableFromSql(sql: string, tableToRemove: string): string {
  const bare = bareOutboxTableName(tableToRemove);
  const escaped = bare.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const schemaPrefix = tableToRemove.includes(".")
    ? `${tableToRemove.split(".")[0]!.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\.`
    : "";
  const tableRe = new RegExp(
    `(?:--[^\\n]*Outbox[^\\n]*\\n(?:--[^\\n]*\\n)*)?CREATE\\s+TABLE\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?${schemaPrefix}${escaped}\\s*\\([\\s\\S]*?\\)\\s*;\\s*(?:CREATE\\s+INDEX\\s+idx_${escaped}[^\\n]*;\\s*)?`,
    "gi",
  );
  return sql.replace(tableRe, "").replace(/\n{3,}/g, "\n\n").trim();
}

function unifyOutboxReferencesInDraft(draft: string, canonicalBare: string): string {
  const aliases = ["outbox", "outbox_events", "eventos_outbox", "eventos"];
  let out = draft;
  for (const alias of aliases) {
    if (alias === canonicalBare) continue;
    for (const heading of [
      "## 2. Arquitectura y Stack",
      "## 5. Lógica y Edge Cases",
      "## 7. Infraestructura",
    ]) {
      const section = extractMddSectionBody(out, heading);
      if (!section) continue;
      const re = new RegExp(`(\\btabla\\s+)${alias}\\b`, "gi");
      const body = section.body.replace(re, `$1${canonicalBare}`);
      if (body !== section.body) {
        out = out.slice(0, section.start) + body + out.slice(section.end);
      }
    }
  }
  return out;
}

function draftReferencesOutboxTable(draft: string): boolean {
  return /tabla\s+(?:outbox_events|eventos_outbox|outbox|eventos)\b|eventos\s+no\s+publicados\s+de\s+la\s+tabla\s+(?:outbox_events|eventos_outbox|outbox|eventos)|lee\s+los\s+eventos\s+no\s+publicados|Outbox\s+Pattern/i.test(
    draft,
  );
}

function draftHasOutboxTable(draft: string): boolean {
  return listOutboxLikeTablesInDraft(draft).length > 0;
}

/** True si §3 define 2+ tablas outbox-like (outbox, eventos+payload, outbox_events, etc.). */
export function detectDuplicateOutboxTables(draft: string): boolean {
  return listOutboxLikeTablesInDraft(draft).length >= 2;
}

/**
 * Elimina tablas outbox-like duplicadas cuando ya existe una canónica referenciada en §2/§5/§7.
 */
export function deduplicateOutboxTablesInDraft(draft: string): string {
  if (!draft || !detectDuplicateOutboxTables(draft)) return draft;

  const tables = listOutboxLikeTablesInDraft(draft);
  const canonical = resolveCanonicalOutboxTableName(draft, tables);
  const toRemove = tables.filter((t) => t !== canonical);
  if (toRemove.length === 0) return draft;

  const section = extractMddSectionBody(draft, "## 3. Modelo de Datos");
  if (!section) return draft;

  let body = section.body;
  const sqlRe = /```sql\s*([\s\S]*?)```/gi;
  let changed = false;
  body = body.replace(sqlRe, (full, inner: string) => {
    let cleaned = inner;
    let blockChanged = false;
    for (const table of toRemove) {
      const next = removeOutboxLikeTableFromSql(cleaned, table);
      if (next !== cleaned) {
        cleaned = next;
        blockChanged = true;
      }
    }
    if (!blockChanged || cleaned === inner.trim()) return full;
    changed = true;
    return "```sql\n" + cleaned + "\n```";
  });

  if (!changed) return draft;
  let out = draft.slice(0, section.start) + body + draft.slice(section.end);
  out = unifyOutboxReferencesInDraft(out, bareOutboxTableName(canonical));
  return out;
}

/**
 * Alinea narrativa §7 (y §2/§5) con la tabla outbox canónica de §3.
 */
export function fixSection7OutboxNarrative(draft: string): string {
  if (!draft?.trim()) return draft;
  const tables = listOutboxLikeTablesInDraft(draft);
  if (tables.length === 0) return draft;
  const canonical = resolveCanonicalOutboxTableName(draft, tables);
  const bare = bareOutboxTableName(canonical);
  let out = unifyOutboxReferencesInDraft(draft, bare);
  const aliases = ["outbox", "outbox_events", "eventos_outbox"];
  for (const alias of aliases) {
    if (alias === bare) continue;
    const tablaRe = new RegExp(`(\\btabla\\s+)${alias}\\b`, "gi");
    out = out.replace(tablaRe, `$1${bare}`);
    const genericOutboxRe = /\btabla\s+outbox\b(?!\w)/gi;
    if (bare !== "outbox") {
      out = out.replace(genericOutboxRe, `tabla ${bare}`);
    }
  }
  return out;
}

/** Añade CREATE TABLE outbox en §3 si §7/§2 la mencionan y falta cualquier tabla outbox-like. */
export function ensureOutboxTableInDraft(draft: string): string {
  if (!draft || !draftReferencesOutboxTable(draft) || draftHasOutboxTable(draft)) return draft;
  const section = extractMddSectionBody(draft, "## 3. Modelo de Datos");
  if (!section) return draft;

  let body = section.body;
  const sqlRe = /```sql\s*([\s\S]*?)```/i;
  if (!sqlRe.test(body)) return draft;

  body = body.replace(sqlRe, (full, inner: string) => {
    if (listOutboxLikeTablesInSql(inner).length > 0) {
      return full;
    }
    return "```sql\n" + inner.trimEnd() + OUTBOX_TABLE_DDL + "\n```";
  });

  if (body === section.body) return draft;
  return draft.slice(0, section.start) + body + draft.slice(section.end);
}

/**
 * Patrón dual alternativo: un mismo POST …/:requestId/approve (1.ª/2.ª) + execute/reject.
 * Válido cuando el flujo documenta estados y 409 por mismo aprobador.
 */
export function draftHasRequestIdDualApprovalApi(draft: string): boolean {
  const contratos = extractMddSectionBody(draft, "## 4. Contratos de API");
  if (!contratos) return false;
  const body = contratos.body;
  const hasRequestApprove =
    /\/:requestId\/approve\b|\/:requestId\/approve/i.test(body) ||
    /\/export\/[^/\s\n]*:requestId\/approve/i.test(body);
  const hasExecuteOrReject =
    /\/:requestId\/(?:execute|reject)\b|\/:requestId\/(?:execute|reject)/i.test(body);
  return hasRequestApprove && hasExecuteOrReject;
}

const DUAL_APPROVAL_TABLES = ["approval_requests", "export_requests"] as const;

/** True si §1, §4 o §5 exigen aprobación dual / control dual. */
export function draftRequiresDualApproval(draft: string): boolean {
  if (!draft) return false;
  const pattern =
    /aprobación\s+dual|dual\s+control|dos\s+administradores|two\s+approvers|segunda\s+aprobación/i;
  for (const heading of ["## 1. Contexto", "## 4. Contratos de API", "## 5. Lógica y Edge Cases"]) {
    const section = extractMddSectionBody(draft, heading);
    if (section && pattern.test(section.body)) return true;
  }
  return pattern.test(draft);
}

function fixDualApprovalTableSqlBlock(sqlBlock: string): string {
  let out = sqlBlock;
  for (const table of DUAL_APPROVAL_TABLES) {
    const tableRe = new RegExp(
      `(CREATE\\s+TABLE\\s+${table}\\s*\\([\\s\\S]*?\\)\\s*;)`,
      "gi",
    );
    out = out.replace(tableRe, (block) => {
      if (/second_approver_id/i.test(block)) return block;
      let fixed = block;
      if (/\bapproved_by\b/i.test(fixed) && !/first_approver_id/i.test(fixed)) {
        fixed = fixed.replace(/\bapproved_by\b/gi, "first_approver_id");
      }
      if (/first_approver_id/i.test(fixed)) {
        if (/(first_approver_id\s+UUID[^,\n]*,)/i.test(fixed)) {
          fixed = fixed.replace(
            /(first_approver_id\s+UUID[^,\n]*,)/i,
            "$1\n  second_approver_id UUID REFERENCES users(id),",
          );
        } else {
          fixed = fixed.replace(
            /(first_approver_id\s+UUID(?:\s+REFERENCES\s+users\(id\))?)(\s*)(?=\n)/i,
            "$1,\n  second_approver_id UUID REFERENCES users(id)$2",
          );
        }
      }
      fixed = fixed.replace(
        /CHECK\s*\(\s*status\s+IN\s*\(\s*'pending'\s*,\s*'approved'\s*,\s*'rejected'\s*\)\s*\)/i,
        "CHECK (status IN ('pending', 'first_approved', 'approved', 'rejected', 'expired', 'completed'))",
      );
      return fixed;
    });
  }
  return out;
}

function fixDualApprovalMermaidBlock(mermaid: string): string {
  let out = mermaid;
  for (const table of DUAL_APPROVAL_TABLES) {
    const entityRe = new RegExp(`(${table}\\s*\\{[\\s\\S]*?\\})`, "gi");
    out = out.replace(entityRe, (entity) => {
      if (/second_approver_id/i.test(entity)) return entity;
      if (!/\bapproved_by\b/i.test(entity) && !/first_approver_id/i.test(entity)) return entity;
      let fixed = entity.replace(/\buuid\s+approved_by\s+FK\b/gi, "uuid first_approver_id FK");
      if (!/first_approver_id/i.test(fixed)) {
        fixed = fixed.replace(/\bapproved_by\b/gi, "first_approver_id");
      }
      if (!/second_approver_id/i.test(fixed)) {
        fixed = fixed.replace(/(first_approver_id\s+FK\s*\n)/i, "$1    uuid second_approver_id FK\n");
      }
      return fixed;
    });
  }
  return out;
}

/** Repara filas de tabla §4 rotas tras división approve-first / approve-second. */
function normalizeDualApprovalSection4TableRows(body: string): string {
  let out = body.replace(
    /^\|\s*POST\s*\|\s*`?([^|`\n]+approve-first)`?\s*\|\s*$/gim,
    "| POST | `$1` | Primera aprobación (dual) | JWT (admin_security) |",
  );
  out = out.replace(
    /^\|\s*POST\s*\|\s*`?([^|`\n]+approve-second)`?\s*\|[^|\n]*(?:\|[^|\n]*)+/gim,
    "| POST | `$1` | Segunda aprobación (409 si mismo aprobador) | JWT (admin_security) |",
  );
  return out;
}

/** Sustituye un único endpoint de aprobación por approve-first / approve-second en §4. */
function fixDualApprovalSection4Endpoints(draft: string): string {
  if (!draftRequiresDualApproval(draft)) return draft;
  if (draftHasRequestIdDualApprovalApi(draft)) return draft;
  const section = extractMddSectionBody(draft, "## 4. Contratos de API");
  if (!section) return draft;

  let body = section.body;
  const hasSplitEndpoints = /approve-first/i.test(body) && /approve-second/i.test(body);
  const exportApprovePathRe =
    /\/export(?:-requests\/:requestId)?\/approve(?!-first|-second)/i;
  const hasSingleApprove =
    (/\|\s*POST\s*\|/i.test(body) && exportApprovePathRe.test(body)) ||
    /#{2,6}\s*POST\s+\/[^\s\n]*\/export(?:-requests\/:requestId)?\/approve(?!-first|-second)/i.test(
      body,
    );

  if (hasSplitEndpoints && !hasSingleApprove) {
    body = normalizeDualApprovalSection4TableRows(body);
    body = splitDualApprovalEndpointDetailHeadings(body);
    if (body !== section.body) {
      return draft.slice(0, section.start) + body + draft.slice(section.end);
    }
    return draft;
  }

  body = body.replace(
    /^\|\s*POST\s*\|\s*[`']?(\/[^\s`'\n|]*\/export(?:-requests\/:requestId)?\/)approve[`']?\s*\|[^\n]*$/gim,
    (_line, prefix: string) =>
      `| POST | \`${prefix}approve-first\` | Primera aprobación (dual) | JWT (admin_security) |\n| POST | \`${prefix}approve-second\` | Segunda aprobación (409 si mismo aprobador) | JWT (admin_security) |`,
  );
  body = normalizeDualApprovalSection4TableRows(body);
  body = splitDualApprovalEndpointDetailHeadings(body);

  if (body === section.body) return draft;
  return draft.slice(0, section.start) + body + draft.slice(section.end);
}

/** Divide el bloque detalle `#### POST …/export/approve` en approve-first y approve-second. */
function splitDualApprovalEndpointDetailHeadings(body: string): string {
  const headingRe =
    /####\s*POST\s+(\/[^\s\n]*\/export(?:-requests\/:requestId)?\/)approve(?!-first|-second)[^\n]*\n+([\s\S]*?)(?=\n####\s*POST\s+\/|\n##\s+|\n---\s*\n|$)/i;
  if (!headingRe.test(body)) return body;
  return body.replace(headingRe, (_m, prefix: string, detail: string) => {
    const trimmed = detail.trim();
    return (
      `#### POST ${prefix}approve-first\n\nPrimera aprobación. Cambia estado a \`first_approved\`.\n\n${trimmed}\n\n` +
      `#### POST ${prefix}approve-second\n\nSegunda aprobación (distinto del primero). Cambia a \`approved\` y ejecuta exportación.\n\n${trimmed}\n\n`
    );
  });
}

/** Corrige esquema de aprobación dual (2 aprobadores) en SQL, diagramas ER y §4. */
export function fixDualApprovalSchemaInDraft(draft: string): string {
  if (!draft || !draftRequiresDualApproval(draft)) return draft;
  const hasApprovalTable = DUAL_APPROVAL_TABLES.some((t) =>
    new RegExp(`CREATE\\s+TABLE\\s+${t}\\b`, "i").test(draft),
  );

  let out = draft;
  if (hasApprovalTable) {
    out = out.replace(/```sql\s*([\s\S]*?)```/gi, (_full, inner: string) => {
      const fixed = fixDualApprovalTableSqlBlock(inner);
      return fixed === inner ? _full : "```sql\n" + fixed + "\n```";
    });
    out = out.replace(/```mermaid\s*([\s\S]*?)```/gi, (_full, inner: string) => {
      if (!/erDiagram/i.test(inner)) return _full;
      const fixed = fixDualApprovalMermaidBlock(inner);
      return fixed === inner ? _full : "```mermaid\n" + fixed + "\n```";
    });
  }
  out = fixDualApprovalSection4Endpoints(out);
  return out;
}

export type CrossConsistencyPatch = { find: string; replace: string };

/**
 * Aplica parches find/replace del revisor LLM con límites de seguridad.
 * Solo aplica si `find` aparece exactamente una vez.
 */
export function applyCrossConsistencyPatches(
  draft: string,
  patches: CrossConsistencyPatch[],
): string {
  if (!draft || !patches?.length) return draft;
  let out = draft;
  const maxPatches = 12;
  for (const patch of patches.slice(0, maxPatches)) {
    const find = patch?.find?.trim();
    const replace = patch?.replace ?? "";
    if (!find || find.length < 8 || find.length > 4_000) continue;
    if (replace.length > 8_000) continue;
    const count = out.split(find).length - 1;
    if (count === 1) {
      out = out.replace(find, replace);
    }
  }
  return out;
}

/** Extrae array JSON de parches desde la respuesta del LLM. */
export function parseCrossConsistencyPatches(text: string): CrossConsistencyPatch[] {
  if (!text?.trim()) return [];
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const raw = fenced?.[1]?.trim() ?? text.trim();
  const arrayStart = raw.indexOf("[");
  const arrayEnd = raw.lastIndexOf("]");
  if (arrayStart === -1 || arrayEnd <= arrayStart) return [];
  try {
    const parsed = JSON.parse(raw.slice(arrayStart, arrayEnd + 1)) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (p): p is CrossConsistencyPatch =>
          p != null &&
          typeof p === "object" &&
          typeof (p as CrossConsistencyPatch).find === "string" &&
          typeof (p as CrossConsistencyPatch).replace === "string",
      )
      .map((p) => ({ find: p.find, replace: p.replace }));
  } catch {
    return [];
  }
}

/**
 * Detecta incoherencias que pueden requerir parche LLM tras el paso determinista.
 */

const SEC6_EXPECTED_TABLES = ["security_events", "refresh_tokens", "mfa_backup_codes"] as const;

/** OWASP ASVS V3.1.1 — bloqueo por intentos fallidos cuando §5 lo exige y §6 no lo detalla. */
export const SECURITY_LOCKOUT_DEFAULT_PARAGRAPH =
  "Bloqueo de cuenta tras 5 intentos fallidos de login en ventana de 15 minutos; lockout 5 minutos (OWASP ASVS V3.1.1).";

const LOCKOUT_DETAIL_RE =
  /\d+\s*intentos?|\d+\s*attempts?|intentos?\s*:\s*\d+|máximo\s+\d+|fallos?\s*:\s*\d+|lockout|bloqueo\s+tras\s+\d+/i;

const LOGIC_LOCKOUT_TRIGGER_RE =
  /\b(bloqueo\s+de\s+cuenta|lock\s+account|intentos\s+fallidos|failed\s+attempts|máximo\s+de\s+intentos|fallos?\b|lockout\b)/i;

/** Inyecta párrafo OWASP de lockout en §6 si §5 lo requiere y falta número de intentos. */
export function ensureSecurityLockoutInSection6(draft: string): string {
  if (!draft?.trim()) return draft;
  const logicSec = extractMddSectionBody(draft, "## 5. Lógica y Edge Cases");
  if (!logicSec || !LOGIC_LOCKOUT_TRIGGER_RE.test(logicSec.body)) return draft;

  const sec6 = extractMddSectionBody(draft, "## 6. Seguridad");
  if (!sec6) return draft;
  if (LOCKOUT_DETAIL_RE.test(sec6.body)) return draft;

  const injection = `\n\n${SECURITY_LOCKOUT_DEFAULT_PARAGRAPH}\n`;
  const updatedBody = sec6.body.trimEnd() + injection;
  return draft.slice(0, sec6.start) + updatedBody + draft.slice(sec6.end);
}

function detectSecurityTablesMissingInSection3(draft: string): string[] {
  const sec6 = extractMddSectionBody(draft, "## 6. Seguridad");
  if (!sec6) return [];
  const section3 = extractMddSectionBody(draft, "## 3. Modelo de Datos");
  const sql = section3?.body ?? "";
  const missing: string[] = [];
  for (const table of SEC6_EXPECTED_TABLES) {
    if (!new RegExp(`\\b${table}\\b`, "i").test(sec6.body)) continue;
    if (!new RegExp(`CREATE\\s+TABLE\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?${table}\\b`, "i").test(sql)) {
      missing.push(table);
    }
  }
  return missing;
}

const SECURITY_TABLE_STUB_DDL: Record<(typeof SEC6_EXPECTED_TABLES)[number], string> = {
  security_events: `
CREATE TABLE security_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID,
  event_type VARCHAR(100) NOT NULL,
  ip_address INET,
  details JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);`,
  refresh_tokens: `
CREATE TABLE refresh_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  token_hash VARCHAR(255) NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);`,
  mfa_backup_codes: `
CREATE TABLE mfa_backup_codes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  code_hash VARCHAR(255) NOT NULL,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);`,
};

function section6RequiresTotpSecretColumn(draft: string): boolean {
  const sec6 = extractMddSectionBody(draft, "## 6. Seguridad");
  if (!sec6) return false;
  const body = sec6.body;
  if (/\b(sin\s+mfa|no\s+mfa|no\s+se\s+(?:implementa|requiere|usa)\s+mfa|mfa\s+no\s+(?:obligatorio|requerido|aplica))\b/i.test(body)) {
    return false;
  }
  const mandatesMfa =
    /\b(mfa\s+obligatorio|totp\s+obligatorio|2fa\s+obligatorio|requiere\s+mfa|implementa\s+(?:mfa|totp|2fa)|autenticaci[oó]n\s+multifactor)\b/i.test(
      body,
    );
  if (!mandatesMfa) return false;
  if (!/\btotp_secret\b/i.test(body) && !/\bmfa_secrets?\b/i.test(body)) return false;
  const section3 = extractMddSectionBody(draft, "## 3. Modelo de Datos");
  if (!section3) return false;
  const sqlMatch = section3.body.match(/```sql\s*([\s\S]*?)```/i);
  if (!sqlMatch?.[1]) return false;
  return !/\btotp_secret\b/i.test(sqlMatch[1]) && !/\bmfa_secrets\b/i.test(sqlMatch[1]);
}

function findCreateTableBlock(
  sql: string,
  tableNames: string[],
): { start: number; end: number; tableName: string; cols: string } | null {
  const re = new RegExp(
    `CREATE\\s+TABLE\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?(${tableNames.join("|")})\\s*\\(`,
    "i",
  );
  const m = re.exec(sql);
  if (!m || m.index == null) return null;
  const openParen = m.index + m[0].length - 1;
  let depth = 0;
  for (let i = openParen; i < sql.length; i++) {
    const ch = sql[i];
    if (ch === "(") depth++;
    else if (ch === ")") {
      depth--;
      if (depth === 0) {
        return {
          start: m.index,
          end: i + 1,
          tableName: m[1]!,
          cols: sql.slice(openParen + 1, i),
        };
      }
    }
  }
  return null;
}

function injectTotpSecretColumnIntoUserTable(sql: string): string {
  const block = findCreateTableBlock(sql, ["users", "usuarios", "user"]);
  if (!block || /\btotp_secret\b/i.test(block.cols)) return sql;
  const trimmedCols = block.cols.trimEnd().replace(/,\s*$/, "");
  const newCols = `${trimmedCols},\n  totp_secret BYTEA`;
  const newBlock = `CREATE TABLE ${block.tableName} (\n${newCols}\n)`;
  return sql.slice(0, block.start) + newBlock + sql.slice(block.end);
}

/**
 * Añade stubs DDL mínimos en §3 solo para tablas/columnas mencionadas en §6 y ausentes en SQL.
 */
export function ensureSecurityTableStubsFromSection6(draft: string): string {
  if (!draft?.trim()) return draft;
  const missing = detectSecurityTablesMissingInSection3(draft);
  const needsTotp = section6RequiresTotpSecretColumn(draft);
  if (missing.length === 0 && !needsTotp) return draft;

  const section = extractMddSectionBody(draft, "## 3. Modelo de Datos");
  if (!section) return draft;

  let body = section.body;
  const sqlRe = /```sql\s*([\s\S]*?)```/i;
  if (!sqlRe.test(body)) return draft;

  body = body.replace(sqlRe, (full, inner: string) => {
    let sql = inner.trimEnd();
    for (const table of missing) {
      const stub = SECURITY_TABLE_STUB_DDL[table as (typeof SEC6_EXPECTED_TABLES)[number]];
      if (stub) sql += `\n${stub}`;
    }
    if (needsTotp) sql = injectTotpSecretColumnIntoUserTable(sql);
    return sql === inner.trimEnd() ? full : "```sql\n" + sql + "\n```";
  });

  if (body === section.body) return draft;
  return draft.slice(0, section.start) + body + draft.slice(section.end);
}

/** Heurística: UNIQUE compuesto de estado sin índice parcial. */
export function detectSuspiciousUniqueConstraints(draft: string): string[] {
  const issues: string[] = [];
  const section = extractMddSectionBody(draft, "## 3. Modelo de Datos");
  if (!section) return issues;
  const uniqueRe = /UNIQUE\s*\(\s*([^)]+)\s*\)/gi;
  let m: RegExpExecArray | null;
  while ((m = uniqueRe.exec(section.body)) !== null) {
    const cols = m[1].replace(/\s/g, "").toLowerCase();
    if (
      /negocio_id.*cliente_id.*estado|cliente_id.*negocio_id.*estado/.test(cols) &&
      !/WHERE/i.test(section.body.slice(m.index, m.index + 240))
    ) {
      issues.push(
        "§3: UNIQUE(negocio_id, cliente_id, estado) sin WHERE — considerar índice parcial único por estado activo.",
      );
      break;
    }
  }
  return issues;
}

function extractUatBulletLines(body: string): string[] {
  return body
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => /^[-*]\s+/.test(l))
    .map((l) => l.replace(/^[-*]\s+/, "").toLowerCase());
}

/** True si §1 y §5 repiten criterios UAT (warning de entrega, no bloqueante). */
export function detectDuplicateUatSections(draft: string): boolean {
  const sec1 = extractMddSectionBody(draft, "## 1. Contexto");
  const sec5 = extractMddSectionBody(draft, "## 5. Lógica y Edge Cases");
  if (!sec1 || !sec5) return false;
  return uatSectionsAreSimilar(sec1.body, sec5.body);
}

function uatSectionsAreSimilar(sec1Body: string, sec5Body: string): boolean {
  if (!/\bUAT\b|criterios\s+de\s+aceptaci[oó]n/i.test(sec1Body)) return false;
  if (!/\bUAT\b|criterios\s+de\s+aceptaci[oó]n/i.test(sec5Body)) return false;
  const lines1 = extractUatBulletLines(sec1Body);
  const lines5 = extractUatBulletLines(sec5Body);
  if (lines1.length < 2 || lines5.length < 2) return false;
  const shared = lines1.filter((l) => lines5.includes(l));
  return shared.length >= Math.min(3, Math.min(lines1.length, lines5.length));
}

/** Si §1 y §5 repiten criterios UAT, §5 referencia §1 en lugar de duplicar. */
export function deduplicateUatSections(draft: string): string {
  const sec1 = extractMddSectionBody(draft, "## 1. Contexto");
  const sec5 = extractMddSectionBody(draft, "## 5. Lógica y Edge Cases");
  if (!sec1 || !sec5 || !uatSectionsAreSimilar(sec1.body, sec5.body)) return draft;

  const uatHeadingRe =
    /(\n###[^\n]*(?:UAT|criterios\s+de\s+aceptaci[oó]n)[^\n]*\n)([\s\S]*?)(?=\n###|\n##|$)/i;
  const match = sec5.body.match(uatHeadingRe);
  if (!match || /Ver\s+§1/i.test(match[2] ?? "")) return draft;

  const bodyWithoutUat = sec5.body.replace(uatHeadingRe, "").trim();
  if (bodyWithoutUat.length < 100 && sec5.body.length >= 200) {
    return draft;
  }

  const replacement = `${match[1]}\n- Ver §1 (Criterios UAT / aceptación).\n`;
  const newBody = sec5.body.replace(uatHeadingRe, replacement);
  if (newBody.length < 100 && sec5.body.length >= 200) return draft;
  if (newBody === sec5.body) return draft;
  return draft.slice(0, sec5.start) + newBody + draft.slice(sec5.end);
}

export function detectCrossConsistencyIssues(draft: string): string[] {
  if (!draft) return [];
  const issues: string[] = [];

  if (draftRequiresDualApproval(draft)) {
    const contratosDual = extractMddSectionBody(draft, "## 4. Contratos de API");
    if (contratosDual && !draftHasRequestIdDualApprovalApi(draft)) {
      const hasSingleApprove =
        /\/export(?:-requests)?\/[^|\s\n]*\/approve(?!-first|-second)/i.test(
          contratosDual.body,
        );
      const hasSplit =
        /approve-first/i.test(contratosDual.body) && /approve-second/i.test(contratosDual.body);
      if (hasSingleApprove && !hasSplit) {
        issues.push(
          "§4: aprobación dual requiere endpoints approve-first y approve-second (no un único /approve).",
        );
      }
    }
    const spanishExport = draft.match(
      /CREATE\s+TABLE\s+solicitudes_exportacion\s*\([\s\S]*?\)\s*;/i,
    );
    if (spanishExport && !/segundo_aprobador_id/i.test(spanishExport[0])) {
      issues.push(
        "Tabla solicitudes_exportacion: falta segundo_aprobador_id pese a aprobación dual.",
      );
    }
    for (const table of DUAL_APPROVAL_TABLES) {
      const tableRe = new RegExp(`CREATE\\s+TABLE\\s+${table}\\s*\\([\\s\\S]*?\\)\\s*;`, "i");
      const match = draft.match(tableRe);
      if (!match) continue;
      const block = match[0];
      if (!/second_approver_id/i.test(block)) {
        issues.push(
          `Tabla ${table}: falta second_approver_id pese a aprobación dual en el alcance.`,
        );
      }
      if (/\bapproved_by\b/i.test(block) && !/first_approver_id/i.test(block)) {
        issues.push(`Tabla ${table}: usa approved_by en lugar de first_approver_id/second_approver_id.`);
      }
    }
  }

  const arch = extractMddSectionBody(draft, "## 2. Arquitectura y Stack");
  const isModularMonolith =
    arch != null &&
    /monolito\s+modular|única unidad de despliegue|single deployment|único despliegue/i.test(
      arch.body,
    );
  if (isModularMonolith) {
    const infra = extractMddSectionBody(draft, "## 7. Infraestructura");
    if (infra && /entre\s+microservicios?/i.test(infra.body)) {
      issues.push("§7 menciona microservicios pero §2 define monolito modular.");
    }
  }

  const contratos = extractMddSectionBody(draft, "## 4. Contratos de API");
  if (contratos) {
    const v1Routes = (contratos.body.match(/\/api\/v1\/[a-zA-Z0-9_/-]+/g) ?? []).length;
    const plainRoutes = (contratos.body.match(/\/api\/(?!v1\/)[a-zA-Z0-9_/-]+/g) ?? []).length;
    const dominantPrefix = v1Routes > plainRoutes ? "/api/v1" : plainRoutes > 0 ? "/api" : null;
    if (dominantPrefix) {
      const manifestMatch = draft.match(/"api_prefix"\s*:\s*"([^"]+)"/);
      if (manifestMatch && manifestMatch[1] !== dominantPrefix) {
        issues.push(
          `Manifest api_prefix "${manifestMatch[1]}" no coincide con rutas dominantes (${dominantPrefix}).`,
        );
      }
    }
  }

  if (draftUsesLdapPrimaryAuth(draft)) {
    const sec6 = extractMddSectionBody(draft, "## 6. Seguridad");
    if (
      sec6 &&
      /contraseñas de los usuarios se almacenan hasheadas|hashing de contraseñas usa Argon2id/i.test(
        sec6.body,
      ) &&
      !/bootstrap|solo la cuenta/i.test(sec6.body)
    ) {
      issues.push(
        "§6: LDAP/AD es auth principal pero el texto aún documenta hash local de contraseñas de usuarios.",
      );
    }
    const manifestHash = draft.match(/"hashing_algorithm"\s*:\s*"([^"]+)"/i)?.[1];
    if (manifestHash?.toLowerCase() === "bcrypt") {
      issues.push('Manifest §7: hashing_algorithm "bcrypt" incoherente con LDAP/AD (usar Argon2id solo bootstrap).');
    }
  }

  if (draftReferencesOutboxTable(draft) && !draftHasOutboxTable(draft)) {
    issues.push("Se menciona tabla outbox (Outbox Pattern) pero falta CREATE TABLE outbox en §3.");
  }

  if (detectDuplicateOutboxTables(draft)) {
    const tables = listOutboxLikeTablesInDraft(draft);
    issues.push(
      `§3: tablas outbox-like duplicadas (${tables.join(", ")}); conservar una sola tabla canónica.`,
    );
  }

  if (detectJwtAlgorithmMismatch(draft)) {
    const s6 = extractJwtAlgorithmFromSection6(draft);
    const s7 = extractJwtAlgorithmFromSection7(draft);
    issues.push(
      `§6/§7: algoritmo JWT incoherente (§6=${s6}, §7=${s7}); §6 es SSOT.`,
    );
  }

  const nodeMismatchIssue = detectSection2Section7NodeVersionMismatchIssue(draft);
  if (nodeMismatchIssue) issues.push(nodeMismatchIssue);

  for (const table of detectSecurityTablesMissingInSection3(draft)) {
    issues.push(
      `§6 menciona tabla \`${table}\` pero falta CREATE TABLE correspondiente en §3.`,
    );
  }

  issues.push(...detectSuspiciousUniqueConstraints(draft));

  const sec6Argon2 = extractMddSectionBody(draft, "## 6. Seguridad");
  if (sec6Argon2 && /Argon2(?:id)?/i.test(sec6Argon2.body)) {
    const manifestHashArgon = draft.match(/"hashing_algorithm"\s*:\s*"([^"]+)"/i)?.[1];
    if (manifestHashArgon?.toLowerCase() === "bcrypt") {
      issues.push(
        'Manifest §7: hashing_algorithm "bcrypt" incoherente con Argon2id documentado en §6.',
      );
    }
  }

  const sqlBlocks = [...draft.matchAll(/```sql\s*([\s\S]*?)```/gi)];
  for (const [, inner] of sqlBlocks) {
    if (!inner) continue;
    if (sqlBlockContainsProseArtifact(inner)) {
      issues.push("Bloque SQL contiene prosa inválida (línea sin DDL válido).");
    }
  }

  return issues;
}

/**
 * Paso determinista de consistencia cruzada (sin LLM): SQL, dual approval, coherencia §2/§4/§5/§7.
 */
export function applyDeterministicCrossConsistencyFixes(draft: string): string {
  if (!draft) return draft;
  let out = sanitizeAllSqlBlocksInDraft(draft);
  out = ensureOutboxTableInDraft(out);
  out = deduplicateOutboxTablesInDraft(out);
  out = fixSection7OutboxNarrative(out);
  out = fixDualApprovalSchemaInDraft(out);
  out = fixDeterministicMddCoherence(out);
  out = fixJwtAlgorithmCoherence(out);
  // Segunda pasada: rutas ya en /api/v1 y headings detalle pendientes
  if (draftRequiresDualApproval(out)) {
    out = fixDualApprovalSchemaInDraft(out);
  }
  return out;
}
