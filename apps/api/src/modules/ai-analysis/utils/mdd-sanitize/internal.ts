import { corpusExcludesDashboardWeb, corpusExcludesMultiTenantSaaS } from "../../../engine/mdd-brd-scope.util.js";
import { extractMddSectionBody } from "./section-body.util.js";
import {
  formatSqlBlockWithNewlines,
  sanitizeSqlBrokenCommentsAndProse,
} from "./sql-repair.js";
import {
  extractContextSectionBody,
  getMddDraftSummary,
} from "./section-merge.js";
import { findBalancedBrace, findBalancedBraceRespectingStrings } from "./brace.util.js";
import { stripMermaidFences } from "./mermaid-fences.js";
import { corpusUsesRs256Jwt } from "./cross-consistency.js";
import { nestedSectionKeysToMarkdown, unbulletAndJoinForJson } from "./draft-normalize.js";

/**
 * Parche por concepto (no por dominio): cuando el documento describe autenticación con credenciales
 * (login/password) o con secretos (MFA/TOTP), asegura que el SQL tenga almacén para credencial y/o
 * secreto si falta. Nombres usados son convención estándar (password_hash, tabla de secretos);
 * aplica a cualquier documento que describa esos conceptos, no solo a un dominio concreto.
 */
export function ensureSection2HasAuthAndMfa(section2Content: string, scopeText: string): string {
  if (!section2Content || typeof section2Content !== "string") return section2Content;
  const scope = (scopeText || "").trim().toLowerCase();
  const hasCredentialAuth = /\b(login|password|credencial|autenticaci[oó]n|usuario\s+y\s+contraseña|hash\s+de\s+contraseña)\b/i.test(scope);
  const hasSecretAuth = /\b(mfa|totp|2fa|google\s+authenticator|segundo\s+factor|secreto\s+(de\s+)?(mfa|totp))\b/i.test(scope);
  if (!hasCredentialAuth && !hasSecretAuth) return section2Content;

  const sqlBlockMatch = section2Content.match(/```sql\s*([\s\S]*?)```/);
  if (!sqlBlockMatch) return section2Content;
  let sql = sqlBlockMatch[1];
  const beforeSql = section2Content.slice(0, sqlBlockMatch.index);
  const afterSql = section2Content.slice((sqlBlockMatch.index ?? 0) + sqlBlockMatch[0].length);
  let changed = false;

  if (hasCredentialAuth && !/\b(password_hash|credential_hash|password_hash)\b/i.test(sql)) {
    const usersMatch = sql.match(/CREATE\s+TABLE\s+users\s*\([\s\S]*?\)\s*;/i);
    if (usersMatch) {
      const block = usersMatch[0];
      if (!/\bpassword_hash\b/i.test(block)) {
        const withHash = block.replace(
          /(\n\s*created_at\s+TIMESTAMPTZ[^\n]*)/i,
          "  password_hash VARCHAR(255) NOT NULL,\n$1",
        );
        if (withHash === block) {
          sql = sql.replace(block, block.replace(/(\)\s*;)\s*$/, "  password_hash VARCHAR(255) NOT NULL,\n$1"));
        } else {
          sql = sql.replace(block, withHash);
        }
        changed = true;
      }
    }
  }
  if (hasSecretAuth && !/\b(mfa_secrets|totp_secret|mfa_secret|otp_secret)\b/i.test(sql)) {
    const userTable = /CREATE\s+TABLE\s+(users|usuarios|user)\s*\(/i.exec(sql)?.[1] ?? "users";
    const mfaTable =
      `\n\nCREATE TABLE mfa_secrets (\n  user_id UUID NOT NULL REFERENCES ${userTable}(id) ON DELETE CASCADE,\n  totp_secret VARCHAR(255) NOT NULL,\n  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),\n  PRIMARY KEY (user_id)\n);`;
    sql = sql.trimEnd() + mfaTable;
    changed = true;
  }
  if (!changed) return section2Content;
  return beforeSql + "```sql\n" + sql + "\n```" + afterSql;
}


/** Cuenta CREATE TABLE en §3 (autoridad para recuentos de entidades en export). */
export function countMddSection3CreateTables(mddMarkdown: string): number {
  const sec3 = extractMddSectionBody(mddMarkdown, "## 3. Modelo de Datos");
  if (!sec3?.body.trim()) return 0;
  return (
    sec3.body.match(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?[a-zA-Z_][a-zA-Z0-9_]*/gi) ??
    []
  ).length;
}

/** Detecta MDD truncado (fence JSON sin cerrar al final). */
export function detectTruncatedMddMarkdown(mdd: string): boolean {
  const trimmed = (mdd ?? "").trim();
  if (!trimmed) return false;
  const fenceCount = (trimmed.match(/```/g) ?? []).length;
  if (fenceCount % 2 !== 0) return true;
  const tail = trimmed.slice(-400);
  if (/```json[\s\S]*"[^"\n]{0,12}$/i.test(tail)) return true;
  return false;
}

/** Inyecta bloque TechnicalMetadata en §3 si falta (etiquetas inferidas del corpus). */
export function ensureTechnicalMetadataBlockInDraft(draft: string): string {
  if (
    /TechnicalMetadata|\[(?:high_security|external_api|multi_tenant|cicd_pipeline|real_time)\]/i.test(
      draft,
    )
  ) {
    return draft;
  }
  const section = extractMddSectionBody(draft, "## 3. Modelo de Datos");
  if (!section?.body?.trim()) return draft;

  const tags: string[] = [];
  if (/Argon2|JWT|MFA|TOTP|RS256|oauth|seguridad/i.test(draft)) tags.push("[high_security]");
  if (/webhook|api externa|terceros|integraci[oó]n externa/i.test(draft)) tags.push("[external_api]");
  if (/tenant|multi.?tenant/i.test(draft) && !corpusExcludesMultiTenantSaaS(draft)) {
    tags.push("[multi_tenant]");
  }
  if (/docker|ci\/cd|pipeline|deploy|github actions/i.test(draft)) tags.push("[cicd_pipeline]");
  if (/websocket|real.?time|streaming/i.test(draft)) tags.push("[real_time]");
  if (tags.length === 0) tags.push("[high_security]");

  const metaBlock = `\n\n\`\`\`TechnicalMetadata\n${tags.join(" ")}\n\`\`\``;
  const headingLen = "## 3. Modelo de Datos".length;
  const bodyStart = section.start + headingLen;
  const newBody = section.body.trimEnd() + metaBlock + "\n";
  return draft.slice(0, bodyStart) + newBody + draft.slice(section.end);
}

export const POST_MVP_UI_SURFACE_BANNER =
  "> **Alcance MVP:** Esta guía UX/UI y el design system son **post-MVP**. El MVP implementa solo API REST y CLI (Node/Commander); no hay panel web en el alcance actual.\n";

const NO_UI_SURFACE_FOR_BANNER =
  /(?:sin|no)\s+(?:dashboard|frontend|ui|interfaz|pantalla|panel\s+web)|no\s+incluye[^\n]{0,48}panel\s+web|fuera\s+del\s+alcance[^\n]{0,60}(?:mvp|panel\s+web)|solo\s+interfaces?\s+de\s+integraci[oó]n|solo\s+APIs?\s+y\s+CLI|api[\s-]?only|mvp\s+api|cli[\s-]?only|solo\s+api|backend\s+only|l[ií]nea\s+de\s+comandos/i;

/** §1/§2 indican MVP API+CLI sin panel web (autoridad para omitir UI/UX en MDD). */
export function mddExcludesWebUiSurface(mddMarkdown: string): boolean {
  const sec1Body = extractContextSectionBody(mddMarkdown);
  const sec2 = extractMddSectionBody(mddMarkdown, "## 2. Arquitectura y Stack");
  const authority = [sec1Body, sec2?.body].filter(Boolean).join("\n");
  if (corpusExcludesDashboardWeb(authority)) return true;
  return NO_UI_SURFACE_FOR_BANNER.test(authority);
}

/** Antepone banner post-MVP en guías UX/design-system cuando el MDD excluye panel web. */
export function ensurePostMvpUiSurfaceBanner(mddMarkdown: string, content: string): string {
  const trimmed = (content ?? "").trim();
  if (!trimmed) return content;
  if (/post-?mvp/i.test(trimmed.slice(0, 400))) return content;
  if (!mddExcludesWebUiSurface(mddMarkdown)) return content;
  return `${POST_MVP_UI_SURFACE_BANNER}\n---\n${trimmed}\n`;
}

/** Sustituye JWT_SECRET por par RS256 en listas, tablas y bloques `.env`. */
function replaceJwtSecretWithRs256KeyPair(text: string): string {
  let out = text;
  out = out.replace(/^(\s*)(JWT_SECRET)(\s*=\s*)(.*)$/gim, (_, indent, _key, eq, val) => {
    const value = (val as string).trim() || "<PEM>";
    const publicVal = /<PEM/i.test(value) ? "<PEM public>" : value;
    return `${indent}JWT_PRIVATE_KEY${eq}${value}\n${indent}JWT_PUBLIC_KEY${eq}${publicVal}`;
  });
  out = out.replace(
    /^(\s*)([-*]\s+)?JWT_PRIVATE_KEY\s*,\s*JWT_PUBLIC_KEY(.*)$/gim,
    (_, indent, bullet, rest) =>
      `${indent}${bullet ?? ""}JWT_PRIVATE_KEY${rest}\n${indent}${bullet ?? ""}JWT_PUBLIC_KEY${rest}`,
  );
  out = out.replace(/\bJWT_SECRET\b/g, "JWT_PRIVATE_KEY, JWT_PUBLIC_KEY");
  out = out.replace(
    /\|\s*`JWT_SECRET`\s*\|[^\n]*/gi,
    "| `JWT_PRIVATE_KEY`, `JWT_PUBLIC_KEY` | Par RSA PEM para firma/validación JWT (RS256); `JWT_SECRET` deprecado |",
  );
  return out;
}

/** Alinea variables JWT en entregables (infra, architecture) con RS256 del MDD §6. */
export function alignDeliverableMarkdownWithMddSecurity(
  mddMarkdown: string,
  deliverableMarkdown: string,
  options?: { extraCorpus?: string },
): string {
  if (!corpusUsesRs256Jwt(mddMarkdown, options?.extraCorpus ?? "")) return deliverableMarkdown;
  return replaceJwtSecretWithRs256KeyPair(deliverableMarkdown);
}


/**
 * Asegura que el bloque ```sql de la sección 2 esté cerrado con ``` antes de ```mermaid, ```TechnicalMetadata o ###.
 * Así formatSqlBlockWithNewlines puede encontrar el bloque y formatear columnas por línea.
 */
export function ensureSection2SqlBlockClosed(draft: string): string {
  const modeloHeading = "## 3. Modelo de Datos";
  const modeloIdx = draft.indexOf(modeloHeading);
  if (modeloIdx === -1) return draft;
  const sectionStart = modeloIdx + modeloHeading.length;
  const rest = draft.slice(sectionStart);
  const nextH2 = rest.search(/\n##\s+/);
  const body = nextH2 !== -1 ? rest.slice(0, nextH2) : rest;
  const sqlMatch = body.match(/```sql\s*/i);
  if (!sqlMatch || sqlMatch.index == null) return draft;
  const sqlOpen = sqlMatch.index + sqlMatch[0].length;
  const afterSql = body.slice(sqlOpen);
  const nextFence = afterSql.search(/```/);
  if (nextFence === -1) {
    const beforeDiagram = afterSql.search(/\n###\s*Diagrama|\n```(?:mermaid|TechnicalMetadata)/i);
    if (beforeDiagram === -1) return draft;
    const insertPos = sqlOpen + beforeDiagram;
    const newBody = body.slice(0, insertPos) + "\n```\n\n" + body.slice(insertPos);
    const afterSection = nextH2 !== -1 ? rest.slice(nextH2) : "";
    return draft.slice(0, sectionStart) + newBody + afterSection;
  }
  const fencePosInBody = sqlOpen + nextFence;
  const afterBackticks = body.slice(fencePosInBody + 3, fencePosInBody + 20);
  const isClosingFence = /^\s*\n|^\s*$/.test(afterBackticks) || afterBackticks === "";
  if (isClosingFence) return draft;
  const isOpenOfOther = /^\s*mermaid|^\s*TechnicalMetadata|^\s*sql\s/i.test(afterBackticks);
  if (!isOpenOfOther) return draft;
  const newBody = body.slice(0, fencePosInBody) + "\n```\n\n" + body.slice(fencePosInBody);
  const afterSection = nextH2 !== -1 ? rest.slice(nextH2) : "";
  return draft.slice(0, sectionStart) + newBody + afterSection;
}

/**
 * Asegura que en la sección 2 el bloque ```sql tenga saltos de línea (cada CREATE TABLE y cada columna).
 * Si el bloque no está cerrado con ```, lo cierra antes de ### Diagrama o ```mermaid/TechnicalMetadata y luego formatea.
 */
export function ensureSection2SqlFormattedInSection(draft: string): string {
  let sqlBlockMatch = draft.match(/```sql\s*([\s\S]*?)```/);
  let sqlStart = 0;
  let inner = "";
  let sqlEnd = 0;

  if (sqlBlockMatch && sqlBlockMatch.index != null) {
    sqlStart = sqlBlockMatch.index;
    inner = sqlBlockMatch[1];
    sqlEnd = sqlBlockMatch.index + sqlBlockMatch[0].length;
  } else {
    const openMatch = draft.match(/```sql\s*/i);
    if (!openMatch || openMatch.index == null) return draft;
    const afterOpen = draft.slice(openMatch.index + openMatch[0].length);
    const endMatch = afterOpen.match(/\n(```(?:mermaid|TechnicalMetadata)|\s*###\s*Diagrama)/i);
    const endPos = endMatch ? endMatch.index! : afterOpen.length;
    inner = afterOpen.slice(0, endPos).trimEnd();
    if (!inner || !/CREATE\s+TABLE/i.test(inner)) return draft;
    sqlStart = openMatch.index;
    sqlEnd = openMatch.index + openMatch[0].length + endPos;
  }

  const sanitized = sanitizeSqlBrokenCommentsAndProse(inner);
  const formatted = formatSqlBlockWithNewlines(sanitized);
  const before = draft.slice(0, sqlStart + "```sql\n".length);
  const after = draft.slice(sqlEnd);
  return before + formatted + "\n```\n\n" + after;
}

/**
 * Corrige formato de sección Integración cuando el LLM devolvió cada línea como viñeta (ej. "- ### 6.1" -> "### 6.1").
 */
export function fixIntegrationSectionBullets(sectionBody: string): string {
  if (!sectionBody || typeof sectionBody !== "string") return sectionBody;
  return sectionBody
    .replace(/^-\s*(###\s)/gm, "$1")
    .replace(/^-\s*(\*\*[^*]+\*\*:)/gm, "$1")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Convierte cuerpo de §6 que es JSON con viñetas (ej. "- \"## Seguridad\": { - \"Key\": \"value\" - }")
 * a markdown legible (### Key, - value). Devuelve null si no aplica o el parse falla.
 */
export function fixSection6BulletedJsonToMarkdown(sectionBody: string): string | null {
  if (!sectionBody || typeof sectionBody !== "string") return null;
  let trimmed = sectionBody
    .replace(/^\s*\{:?\s*\n?/, "")
    .replace(/(\n\s*-\s*)+$/, "")
    .replace(/\n\s*---\s*$/, "")
    .trim();
  trimmed = trimmed
    .replace(/\n\s*-\s*}\s*\n\s*-\s*}\s*$/, "\n}\n}")
    .replace(/\n\s*-\s*}\s*$/, "\n}")
    .replace(/\n\s*-\s*}\s*(?=\n)/g, "\n}\n")
    .trim();
  const candidate = unbulletAndJoinForJson(trimmed);
  const firstBrace = candidate.indexOf("{");
  if (firstBrace === -1) return null;
  const braceEnd = findBalancedBraceRespectingStrings(candidate, firstBrace);
  if (braceEnd === -1) return null;
  try {
    const jsonStr = candidate.slice(firstBrace, braceEnd + 1);
    const obj = JSON.parse(jsonStr) as Record<string, unknown>;
    if (!obj || typeof obj !== "object" || Array.isArray(obj)) return null;
    const inner = obj["## Seguridad"] ?? obj["6. Seguridad"] ?? obj["6.Seguridad"];
    const toConvert =
      inner !== null && typeof inner === "object" && !Array.isArray(inner)
        ? (inner as Record<string, unknown>)
        : obj;
    const md = nestedSectionKeysToMarkdown(toConvert);
    return md || null;
  } catch {
    return null;
  }
}

/**
 * Corrige formato de sección 6 Seguridad cuando el LLM devolvió subsecciones como viñetas (ej. "- 6.1 X" -> "### 6.1 X").
 */

/** Colapsa `--- --- ---` en la misma línea o consecutivos; normaliza `--`/`-` sueltos como separadores. */

/**
 * Cierra fences ``` sin cierre antes de `---` + ## o de otro H2 (manifest §7, SQL §3).
 */

/** Elimina fences ``` vacíos o de apertura suelta antes de H2/---. */

/** Desenvuelve fences ``` sin lenguaje que encierran prosa tras un encabezado. */

/** Quita `)` suelto en línea propia antes de §7 o cualquier H2. */

/**
 * Si el cuerpo de la sección Integración tiene un manifest JSON con stack no vacío y sin "pending",
 * reemplaza encabezados "### Nota/Pendiente", "### Nota", "### Pendiente" por "### Manifest de Infraestructura".
 * Así no se etiqueta como pendiente cuando el manifest ya está definido.
 */
export function stripNotaPendienteHeadingInIntegrationSection(sectionBody: string): string {
  if (!sectionBody || typeof sectionBody !== "string") return sectionBody;
  const jsonMatch = sectionBody.match(/```json\s*\n([\s\S]*?)```/);
  if (!jsonMatch?.[1]) return sectionBody;
  try {
    const obj = JSON.parse(jsonMatch[1]) as Record<string, unknown>;
    const stack = obj.stack;
    const pending = obj.pending;
    const hasStack = Array.isArray(stack) && stack.length > 0;
    const hasNoPending = pending == null || (typeof pending === "string" && !pending.trim());
    if (!hasStack || !hasNoPending) return sectionBody;
  } catch {
    return sectionBody;
  }
  return sectionBody
    .replace(/###\s*Nota\s*\/\s*Pendiente\s*$/gim, "### Manifest de Infraestructura")
    .replace(/###\s*Nota\s*\/?\s*Pendiente\s*$/gim, "### Manifest de Infraestructura")
    .replace(/###\s*Pendiente\s*$/gim, "### Manifest de Infraestructura")
    .replace(/###\s*Nota\s*$/gim, "### Manifest de Infraestructura");
}

/**
 * Si la sección 7 (Infraestructura) tiene ###/#### Manifest seguido de "stack"/"pending" sin ```json
 * (o como lista - "stack": [] / - "pending": "..."), lo envuelve en ```json válido.
 */
export function ensureManifestInJsonBlock(draft: string): string {
  if (!draft || typeof draft !== "string") return draft;
  const infrHeading = draft.search(/\n##\s+(?:7\.\s+)?(?:Infraestructura|Integración)\b/i);
  if (infrHeading === -1) return draft;
  const sectionStart = draft.indexOf("\n", infrHeading) + 1;
  const rest = draft.slice(sectionStart);
  const nextH2 = rest.search(/\n##\s+/);
  const body = nextH2 !== -1 ? rest.slice(0, nextH2) : rest;
  const manifestMatch = body.match(/\n(#{3,4})\s+Manifest(?:\s+de\s+Infraestructura)?\s*\n+/i);
  if (!manifestMatch || manifestMatch.index == null) return draft;
  const manifestH3 = manifestMatch.index;
  const afterManifest = body.slice(manifestH3 + manifestMatch[0].length).trim();
  if (/```json\s/i.test(afterManifest.slice(0, 100))) return draft;
  // Si el contenido es JSON crudo (empieza con {), envolver en ```json
  if (afterManifest.startsWith("{")) {
    const braceEnd = findBalancedBrace(afterManifest, 0);
    if (braceEnd !== -1) {
      try {
        const obj = JSON.parse(afterManifest.slice(0, braceEnd + 1)) as Record<string, unknown>;
        const jsonBlock = "```json\n" + JSON.stringify(obj, null, 2) + "\n```";
        const restAfter = afterManifest.slice(braceEnd + 1).trim();
        const beforeManifest = body.slice(0, manifestH3) + "\n### Manifest\n\n";
        const newBody = beforeManifest + jsonBlock + (restAfter ? "\n\n" + restAfter : "");
        return draft.slice(0, sectionStart) + newBody + draft.slice(sectionStart + body.length);
      } catch {
        /* fall through to stack/pending extraction */
      }
    }
  }
  // Contenido en líneas sueltas o lista: "stack": [] / "pending": "..."
  const raw = afterManifest.replace(/^-\s*/gm, "").replace(/\n-\s*/g, "\n");
  const stackMatch = raw.match(/"stack"\s*:\s*(\[[\s\S]*?\])/);
  const pendingMatch = raw.match(/"pending"\s*:\s*"((?:[^"\\]|\\.)*)"/);
  if (!stackMatch && !pendingMatch) return draft;
  let stack: unknown[] = [];
  if (stackMatch) {
    try {
      stack = JSON.parse(stackMatch[1].replace(/\s+/g, " "));
    } catch {
      stack = [];
    }
  }
  const pending = pendingMatch ? pendingMatch[1].replace(/\\"/g, '"') : "Definir con el usuario: orquestación y despliegue";
  const jsonBlock = "```json\n" + JSON.stringify({ stack, pending }, null, 2) + "\n```";
  const beforeManifest = body.slice(0, manifestH3) + "\n### Manifest\n\n";
  const afterManifestEnd = afterManifest.search(/\n#{3,4}\s+|\n##\s+|$/);
  const restAfter = afterManifestEnd !== -1 ? afterManifest.slice(afterManifestEnd) : "";
  const newBody = beforeManifest + jsonBlock + (restAfter ? "\n\n" + restAfter.trim() : "");
  const bodyEnd = sectionStart + body.length;
  return draft.slice(0, sectionStart) + newBody + draft.slice(bodyEnd);
}

/**
 * Aplica stripNotaPendienteHeadingInIntegrationSection al cuerpo de ## 7. Infraestructura / ## Integración.
 */
export function stripNotaPendienteHeadingWhenManifestComplete(draft: string): string {
  if (!draft || typeof draft !== "string") return draft;
  const match = draft.match(/\n(##\s+(?:7\.\s+)?(?:Infraestructura|Integración)\b[^\n]*)/i);
  if (!match || match.index == null) return draft;
  const sectionStart = match.index + match[0].length;
  const rest = draft.slice(sectionStart);
  const nextH2 = rest.search(/\n##\s+/);
  const body = nextH2 !== -1 ? rest.slice(0, nextH2) : rest;
  const newBody = stripNotaPendienteHeadingInIntegrationSection(body);
  if (newBody === body) return draft;
  const sectionEnd = nextH2 !== -1 ? sectionStart + nextH2 : draft.length;
  return draft.slice(0, sectionStart) + newBody + draft.slice(sectionEnd);
}





/**
 * Quita del contenido de un diagrama Mermaid cualquier fence sobrante (```mermaid o ```).
 * Así al envolver con ```mermaid\n...\n``` nunca queda doble apertura/cierre.
 */

/**
 * Dado un objeto parseado con SQL/DiagramaER/TechnicalMetadata, devuelve el markdown canónico de la sección 2.
 * Acepta SQL como string (todo el bloque) o como array de strings.
 */
function section2ObjectToMarkdown(obj: Record<string, unknown>): string {
  const sqlArr = obj.SQL ?? obj.sql;
  const sqlContent =
    typeof sqlArr === "string"
      ? sqlArr.trim()
      : Array.isArray(sqlArr)
        ? (sqlArr as string[]).map((s) => (typeof s === "string" ? s.trim() : "")).filter(Boolean).join("\n\n")
        : "";
  if (!sqlContent || !/CREATE\s+TABLE/i.test(sqlContent)) return "";
  const sqlBlock = "\n\n```sql\n" + sqlContent + "\n```";
  const diagramRaw = (obj.DiagramaER ?? obj.diagramaER ?? obj.diagrama_er ?? obj.erDiagram) as string | undefined;
  let diagramBlock = "";
  if (typeof diagramRaw === "string" && diagramRaw.trim()) {
    const m = diagramRaw.trim().match(/```mermaid\s*([\s\S]*?)```/i);
    const innerContent = m?.[1] ? m[1].trim() : diagramRaw.replace(/^[\s\S]*?```mermaid\s*/i, "").replace(/```\s*$/i, "").trim();
    const content = stripMermaidFences(innerContent || diagramRaw);
    if (content || /erDiagram/i.test(diagramRaw))
      diagramBlock = "\n\n### Diagrama entidad-relación\n\n```mermaid\n" + (content || "erDiagram\n  \n") + "\n```";
  }
  const metaRaw = (obj.technicalMetadata ?? obj.TechnicalMetadata) as string | undefined;
  const metaBlock =
    typeof metaRaw === "string" && metaRaw.trim()
      ? "\n\n```TechnicalMetadata\n" + metaRaw.trim() + "\n```"
      : "\n\n```TechnicalMetadata\n[high_security]\n```";
  return sqlBlock + diagramBlock + metaBlock + "\n\n";
}

/**
 * Convierte sección 2 cuando el cuerpo es JSON con "SQL": string|[] y/o "DiagramaER": "..." (salida mal formada del Experto).
 * Devuelve markdown correcto o null si el cuerpo no es ese JSON.
 */
export function convertSection2JsonBodyToMarkdown(body: string): string | null {
  const t = body.trim();
  if (!t.startsWith("{") || !t.includes("SQL") || !t.includes("CREATE")) return null;
  try {
    const obj = JSON.parse(t) as Record<string, unknown>;
    const out = section2ObjectToMarkdown(obj);
    return out || null;
  } catch {
    return null;
  }
}

/** Unescape JSON string (\\n -> newline, \\" -> ", etc.) para contenido extraído por regex. */
function unescapeJsonString(s: string): string {
  return s.replace(/\\n/g, "\n").replace(/\\r/g, "\r").replace(/\\"/g, '"').replace(/\\\\/g, "\\");
}

/**
 * Cuando el JSON dentro de ```sql es inválido (p. ej. newlines literales en strings), extrae SQL/DiagramaER/TechnicalMetadata por regex.
 */
function section2ObjectFromMalformedJson(inner: string): Record<string, unknown> | null {
  const sqlKey = /"SQL"\s*:\s*"/i.exec(inner)?.[0];
  if (!sqlKey) return null;
  const sqlStart = inner.indexOf(sqlKey) + sqlKey.length;
  const afterSql = inner.slice(sqlStart);
  const sqlEndRe = /"\s*,\s*"(?:DiagramaER|TechnicalMetadata)"/i;
  const sqlEndMatch = afterSql.match(sqlEndRe);
  const rawSql = sqlEndMatch
    ? afterSql.slice(0, sqlEndMatch.index).trim()
    : afterSql.trim().replace(/"\s*\}\s*$/, "").trim();
  const sqlContent = unescapeJsonString(rawSql);
  if (!sqlContent || !/CREATE\s+TABLE/i.test(sqlContent)) return null;
  let diagramRaw = "";
  const diagramKey = /"DiagramaER"\s*:\s*"/i.exec(inner);
  if (diagramKey) {
    const diagramStart = inner.indexOf(diagramKey[0]) + diagramKey[0].length;
    const afterDiagram = inner.slice(diagramStart);
    const diagramEndMatch = afterDiagram.match(/"\s*,\s*"TechnicalMetadata"/i) ?? afterDiagram.match(/"\s*\}/);
    diagramRaw = diagramEndMatch
      ? unescapeJsonString(afterDiagram.slice(0, diagramEndMatch.index).trim())
      : unescapeJsonString(afterDiagram.trim().replace(/"\s*\}$/, ""));
  }
  let metaRaw = "[high_security]";
  const metaMatch = inner.match(/"TechnicalMetadata"\s*:\s*"([^"]*)"\s*\}/i) ?? inner.match(/"TechnicalMetadata"\s*:\s*"([^"]*)"/i);
  if (metaMatch?.[1]) metaRaw = metaMatch[1].trim() || metaRaw;
  return { SQL: sqlContent, DiagramaER: diagramRaw || undefined, TechnicalMetadata: metaRaw };
}

/**
 * Si en la sección 2 el bloque ```sql contiene un objeto JSON ({"SQL": "...", "DiagramaER": "...", ...}),
 * lo extrae y reemplaza por la estructura canónica: ```sql + SQL crudo + ``` + ### Diagrama + ```mermaid + ```TechnicalMetadata.
 */
export function unwrapSection2SqlBlockContainingJson(draft: string): string {
  const modeloHeading = "## 3. Modelo de Datos";
  const modeloIdx = draft.indexOf(modeloHeading);
  if (modeloIdx === -1) return draft;
  const sectionStart = modeloIdx + modeloHeading.length;
  const rest = draft.slice(sectionStart);
  const nextH2 = rest.search(/\n##\s+/);
  const body = nextH2 !== -1 ? rest.slice(0, nextH2) : rest;
  const sqlBlockMatch = body.match(/```sql\s*([\s\S]*?)```/i);
  if (!sqlBlockMatch || sqlBlockMatch.index == null) return draft;
  const inner = sqlBlockMatch[1].trim();
  if (!inner.startsWith("{") || !/SQL|DiagramaER/i.test(inner)) return draft;
  let obj: Record<string, unknown> | null = null;
  try {
    obj = JSON.parse(inner) as Record<string, unknown>;
  } catch {
    obj = section2ObjectFromMalformedJson(inner);
  }
  if (!obj) return draft;
  const markdown = section2ObjectToMarkdown(obj);
  if (!markdown) return draft;
  const before = body.slice(0, sqlBlockMatch.index);
  const after = body.slice(sqlBlockMatch.index + sqlBlockMatch[0].length);
  const newBody = before + markdown.trim() + after;
  const afterSection = nextH2 !== -1 ? rest.slice(nextH2) : "";
  return draft.slice(0, sectionStart) + newBody + afterSection;
}

/**
 * Normaliza el contenido de la sección 2 cuando viene con JSON dentro de ```sql (salida mal formada del Experto).
 * Acepta string que empieza por "## 3. Modelo de Datos" o solo el cuerpo; devuelve sección 2 con bloques canónicos.
 */
export function unwrapSection2ContentIfJsonInsideSql(section2: string): string {
  const sqlBlockMatch = section2.match(/```sql\s*([\s\S]*?)```/i);
  if (!sqlBlockMatch || sqlBlockMatch.index == null) return section2;
  const inner = sqlBlockMatch[1].trim();
  if (!inner.startsWith("{") || !/SQL|DiagramaER/i.test(inner)) return section2;
  let obj: Record<string, unknown> | null = null;
  try {
    obj = JSON.parse(inner) as Record<string, unknown>;
  } catch {
    obj = section2ObjectFromMalformedJson(inner);
  }
  if (!obj) return section2;
  const markdown = section2ObjectToMarkdown(obj);
  if (!markdown) return section2;
  const before = section2.slice(0, sqlBlockMatch.index);
  const after = section2.slice(sqlBlockMatch.index + sqlBlockMatch[0].length);
  return before + markdown.trim() + after;
}

/** Asegura que la sección 2 termine con bloque TechnicalMetadata. Si falta, lo añade al final del cuerpo. */
export function ensureTechnicalMetadataAtEndOfSection2(draft: string): string {
  const modeloHeading = "## 3. Modelo de Datos";
  const modeloIdx = draft.indexOf(modeloHeading);
  if (modeloIdx === -1) return draft;
  const sectionStart = modeloIdx + modeloHeading.length;
  const rest = draft.slice(sectionStart);
  const nextH2 = rest.search(/\n##\s+/);
  const body = nextH2 !== -1 ? rest.slice(0, nextH2) : rest;
  if (/```TechnicalMetadata\s*[\s\S]*?```/i.test(body)) return draft;
  const defaultMeta = "\n\n```TechnicalMetadata\n[high_security]\n```\n\n";
  const newBody = body.trimEnd() + defaultMeta;
  const newRest = nextH2 !== -1 ? newBody + rest.slice(nextH2) : newBody;
  return draft.slice(0, sectionStart) + newRest;
}

/**
 * Devuelve el rango [start, end) del bloque §2–§5 (Arquitectura hasta antes de Seguridad) en el draft.
 * Usado para reemplazar solo §2–§5 al regenerar desde el arquitecto.
 */
export function getSections2To5Range(draft: string): { start: number; end: number } | null {
  const trimmed = (draft ?? "").trim();
  const startRe = /\n?(##\s*2\.\s*Arquitectura[^\n]*)/i;
  const startM = trimmed.match(startRe);
  if (!startM || startM.index == null) return null;
  const start = startM.index + (startM[0].startsWith("\n") ? 1 : 0);
  const afterStart = start + (startM[1]?.length ?? 0);
  const rest = trimmed.slice(afterStart);
  const endH2 = rest.search(/\n##\s+(?:6\.\s+)?Seguridad/i);
  const end = endH2 >= 0 ? afterStart + endH2 : trimmed.length;
  return { start, end };
}

/** Extrae el contenido de §2–§5 (desde ## 2. Arquitectura hasta antes de ## 6. Seguridad) de un draft. */
export function extractSections2To5Content(draft: string): string | null {
  const range = getSections2To5Range((draft ?? "").trim());
  if (!range) return null;
  return (draft ?? "").trim().slice(range.start, range.end).trim() || null;
}

/**
 * Reemplaza solo el bloque §2–§5 en currentDraft por newSections2To5Markdown.
 * newSections2To5Markdown debe incluir ## 2. Arquitectura … hasta el final de §5 (sin ## 6.).
 */
export function replaceSections2To5InDraft(
  currentDraft: string,
  newSections2To5Markdown: string,
): string {
  const trimmed = (currentDraft ?? "").trim();
  const range = getSections2To5Range(trimmed);
  if (range) {
    const before = trimmed.slice(0, range.start);
    const after = range.end < trimmed.length ? trimmed.slice(range.end).trimStart() : "";
    return (before + "\n\n" + newSections2To5Markdown.trim() + (after ? "\n\n" + after : "")).trim();
  }
  const sec6 = trimmed.match(/\n##\s+(?:6\.\s+)?Seguridad/i);
  if (sec6 && sec6.index != null) {
    return (trimmed.slice(0, sec6.index).trim() + "\n\n" + newSections2To5Markdown.trim() + "\n\n" + trimmed.slice(sec6.index).trim()).trim();
  }
  return (trimmed + "\n\n" + newSections2To5Markdown.trim()).trim();
}

const OUTPUT_PREFIX_LEN = 200;

/** Log resumido de la salida de un nodo (len, §3 status, prefijo) para depurar pipeline MDD. */
export function logMddNodeOutput(nodeName: string, draft: string): void {
  const trimmed = (draft ?? "").trim();
  const sum = getMddDraftSummary(trimmed);
  const prefix = trimmed.slice(0, OUTPUT_PREFIX_LEN).replace(/\s+/g, " ").trim();
  const suffix = trimmed.length > OUTPUT_PREFIX_LEN ? "…" : "";
  console.log(
    `[MDD:${nodeName}] output len=${sum.length} section3=${sum.section3} prefix=${JSON.stringify(prefix + suffix)}`
  );
}
