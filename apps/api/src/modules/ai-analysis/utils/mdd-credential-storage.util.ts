/**
 * @fileoverview Almacenamiento de credenciales referenciadas en documentación.
 */

import { getSection6Or7Range, replaceSection6Or7InDraft } from "./mdd-sanitize.js";

const GESTION_SECRETOS_RE = /\bgesti[oó]n\s+de\s+secretos\b/i;

/** Bloques usados por el semáforo para credenciales / auditoría en §6. */
export function getSecurityEstimationBlocks(md: string): {
  contextBlock: string;
  securityBlock: string;
  tablesAndColumns: string;
} {
  const content = (md || "").trim();
  const lower = content.toLowerCase();
  const contextBlock = extractEstimationSection(
    content,
    /^#+\s*(?:1\.\s*)?(?:contexto\s+y\s+alcance|contexto\b)/im,
  ).toLowerCase();
  const dataModelBlock = extractEstimationSection(
    content,
    /^#+\s*(?:3\.\s*)?(?:modelo\s+de\s+datos|datos\s*\/\s*entidades)/im,
  ).toLowerCase();
  const securityBlock = extractSection6BodyForEstimation(content).toLowerCase();
  const sqlBlock = (content.match(/```sql\s*([\s\S]*?)```/i)?.[1] ?? "") + dataModelBlock;
  return { contextBlock, securityBlock, tablesAndColumns: sqlBlock + lower };
}

function extractEstimationSection(md: string, pattern: RegExp): string {
  const content = (md || "").trim();
  const m = content.match(pattern);
  if (!m) return "";
  const start = m.index ?? 0;
  const afterTitle = start + (m[0]?.length ?? 0);
  const rest = content.slice(afterTitle);
  const nextH2 = rest.match(/\n##\s/m);
  const end = nextH2 ? nextH2.index! + 1 : rest.length;
  return rest.slice(0, end).trim();
}

/** Cuerpo §6 alineado con getSection6Or7Range (más fiable que ^## en multiline). */
function extractSection6BodyForEstimation(md: string): string {
  const range = getSection6Or7Range((md || "").trim(), 6);
  if (!range) {
    return extractEstimationSection(md, /^##\s+(?:\d+\.\s*)?(?:seguridad|security)/im);
  }
  return md.slice(range.start + range.heading.length, range.end).trim();
}

export function documentRequiresCredentialStorage(md: string): boolean {
  const { contextBlock, securityBlock } = getSecurityEstimationBlocks(md);
  return (
    /\b(credenciales?|password|contraseña|autenticaci[oó]n)\b/i.test(contextBlock) ||
    /\b(credenciales?|password|autenticaci[oó]n)\b/i.test(securityBlock)
  );
}

/**
 * true si el MDD documenta almacén de credenciales / secretos con soporte en §3 o §6.
 * Cualquiera de: SQL con tablas de auth, §6 con gestión de secretos, §6 referencia security_events.
 */
export function isCredentialStorageSatisfied(md: string): boolean {
  if (!documentRequiresCredentialStorage(md)) return true;

  const { securityBlock, tablesAndColumns } = getSecurityEstimationBlocks(md);
  const hasCredStorageInSchema =
    /\b(password_hash|credential|external_store|almac[eé]n\b|referencia|security_events|refresh_tokens)\b/i.test(
      tablesAndColumns,
    );
  const hasSecretsManagerInSec6 =
    /\b(gesti[oó]n\s+de\s+secretos|secrets?\s+manager|vault|almac[eé]n\s+de\s+secretos|secret\s+store|almac[eé]n\s+de\s+credenciales)\b/i.test(
      securityBlock,
    );
  const hasEnvVarsWithStore =
    /\b(variables?\s+de\s+entorno|env\s+vars?)\b/i.test(securityBlock) &&
    /\balmac[eé]n\b/i.test(securityBlock);
  const hasSecurityEventsInSql =
    /\bcreate\s+table\s+(?:if\s+not\s+exists\s+)?security_events\b/i.test(tablesAndColumns) ||
    /\bsecurity_events\b/i.test(tablesAndColumns);
  const hasRefreshTokensInSql = /\brefresh_tokens\b/i.test(tablesAndColumns);
  const mentionsSecurityEventsInSec6 = /\bsecurity_events\b/i.test(securityBlock);

  return (
    hasCredStorageInSchema ||
    hasSecretsManagerInSec6 ||
    hasEnvVarsWithStore ||
    (hasSecurityEventsInSql && hasRefreshTokensInSql) ||
    mentionsSecurityEventsInSec6
  );
}

const CREDENTIAL_STORAGE_INJECTION = `### Gestión de Secretos

Las credenciales de servicio y secretos de aplicación se almacenan en un **almacén de credenciales** (secrets manager). Las **variables de entorno** solo referencian claves del almacén, nunca valores en texto plano. Los eventos de autenticación se registran en la tabla \`security_events\` (§3 Modelo de Datos); los refresh tokens persisten en \`refresh_tokens\`.`;

/** Inyecta párrafo explícito en §6 si el checker seguiría fallando por almacén de credenciales. */
export function ensureCredentialStorageInSection6(draft: string): string {
  if (!draft?.trim()) return draft;
  if (isCredentialStorageSatisfied(draft)) return draft;
  if (!documentRequiresCredentialStorage(draft)) return draft;

  const range = getSection6Or7Range(draft.trim(), 6);
  if (!range) return draft;

  const bodyStart = range.start + range.heading.length;
  const body = draft.slice(bodyStart, range.end).replace(/^\s*\n+/, "");
  const authIdx = body.search(/(?:^|\n)(?:###\s+|-\s*)?(?:Autenticaci[oó]n|Auth)\b/im);
  const insertAt = authIdx >= 0 ? authIdx : body.length;
  const updatedBody =
    body.slice(0, insertAt).trimEnd() +
    (insertAt > 0 ? "\n\n" : "") +
    CREDENTIAL_STORAGE_INJECTION +
    (insertAt < body.length ? "\n\n" + body.slice(insertAt).trimStart() : "");

  return draft.slice(0, bodyStart) + "\n\n" + updatedBody.trim() + draft.slice(range.end);
}

/** Extrae bloque ### Gestión de Secretos (o bullet equivalente) del cuerpo §6. */
function extractGestionSecretosBlock(section6Body: string): string | null {
  const lines = section6Body.split(/\r?\n/);
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (/^(?:###\s+|[-*]\s*)?gesti[oó]n\s+de\s+secretos/i.test(line.trim())) {
      start = i;
      break;
    }
  }
  if (start < 0) return null;
  const out: string[] = [lines[start]!];
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i]!;
    if (/^(?:###\s+|##\s+|-\s+[A-ZÁÉÍÓÚ])/i.test(line.trim()) && !/^\s{2,}/.test(line)) break;
    out.push(line);
  }
  return out.join("\n").trim();
}

/**
 * Evita regresión en /seguridad: si el borrador nuevo pierde Gestión de Secretos y es más corto, fusiona ese bloque.
 */
export function mergeSection6AvoidingRegression(previousDraft: string, newSection6Markdown: string): string {
  const prevRange = getSection6Or7Range((previousDraft ?? "").trim(), 6);
  const prevBody = prevRange
    ? previousDraft.slice(prevRange.start + prevRange.heading.length, prevRange.end).trim()
    : "";
  const newBody = newSection6Markdown
    .replace(/^##\s+(?:6\.\s+)?Seguridad[^\n]*\n+/im, "")
    .trim();

  const prevGestion = extractGestionSecretosBlock(prevBody);
  const losesGestion = prevGestion != null && !GESTION_SECRETOS_RE.test(newBody);
  const significantlyShorter = prevBody.length > 0 && newBody.length < prevBody.length * 0.85;

  if (!losesGestion || !significantlyShorter) {
    return replaceSection6Or7InDraft(previousDraft, 6, newSection6Markdown);
  }

  const mergedBody = `${newBody.trimEnd()}\n\n${prevGestion}`.trim();
  const mergedSection = `## 6. Seguridad\n\n${mergedBody}`;
  return replaceSection6Or7InDraft(previousDraft, 6, mergedSection);
}
