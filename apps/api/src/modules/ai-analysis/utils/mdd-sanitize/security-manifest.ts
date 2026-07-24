import { extractMddSectionBody } from "./section-body.util.js";
import { corpusExcludesMultiTenantSaaS } from "../../../engine/mdd-brd-scope.util.js";

/** True si LDAP/AD es autenticación principal de usuarios humanos (§1, §2 o §6). */
export function draftUsesLdapPrimaryAuth(draft: string): boolean {
  if (!draft) return false;
  const ldapRe =
    /LDAP\/AD|Active\s+Directory|directorio\s+activo|autenticación\s+corporativa/i;
  for (const heading of ["## 1. Contexto", "## 2. Arquitectura y Stack", "## 6. Seguridad"]) {
    const section = extractMddSectionBody(draft, heading);
    if (section && ldapRe.test(section.body)) return true;
  }
  return ldapRe.test(draft);
}

/** Alinea manifest §7 (security) con LDAP y estrategia MFA del borrador. */
export function fixSecurityManifestCoherence(draft: string): string {
  const infra = extractMddSectionBody(draft, "## 7. Infraestructura");
  if (!infra || !/```json/i.test(infra.body)) return draft;

  let body = infra.body;
  const usesLdap = draftUsesLdapPrimaryAuth(draft);
  const sec6 = extractMddSectionBody(draft, "## 6. Seguridad");
  const mfaInSec6 = sec6 != null && /\bMFA\b|\bTOTP\b/i.test(sec6.body);
  const manifestMfa = draft.match(/"mfa_strategy"\s*:\s*"([^"]+)"/i)?.[1];
  const sec6MentionsArgon2 = sec6 != null && /Argon2(?:id)?/i.test(sec6.body);
  const sec6MentionsBcryptOnly =
    sec6 != null && /\bbcrypt\b/i.test(sec6.body) && !/Argon2(?:id)?/i.test(sec6.body);

  if (usesLdap) {
    if (!/"auth_provider"\s*:/i.test(body)) {
      body = body.replace(
        /("security"\s*:\s*\{)/i,
        '$1\n      "auth_provider": "LDAP/AD",',
      );
    }
    if (sec6MentionsBcryptOnly) {
      body = body.replace(/"hashing_algorithm"\s*:\s*"Argon2id"/gi, '"hashing_algorithm": "bcrypt"');
      if (!/"hashing_scope"\s*:/i.test(body)) {
        body = body.replace(
          /"hashing_algorithm"\s*:\s*"[^"]*"/i,
          (m) => `${m},\n      "hashing_scope": "bootstrap_and_service_secrets_only"`,
        );
      }
    } else if (sec6MentionsArgon2) {
      body = body.replace(/"hashing_algorithm"\s*:\s*"bcrypt"/gi, '"hashing_algorithm": "Argon2id"');
      if (!/"hashing_scope"\s*:/i.test(body)) {
        body = body.replace(
          /"hashing_algorithm"\s*:\s*"[^"]*"/i,
          (m) => `${m},\n      "hashing_scope": "bootstrap_and_service_secrets_only"`,
        );
      }
    }
  }

  if (mfaInSec6 && manifestMfa && !/"mfa_strategy"\s*:/i.test(body)) {
    body = body.replace(
      /("security"\s*:\s*\{)/i,
      `$1\n      "mfa_strategy": "${manifestMfa}",`,
    );
  }

  if (sec6MentionsBcryptOnly && /"hashing_algorithm"\s*:\s*"Argon2id"/i.test(body)) {
    body = body.replace(/"hashing_algorithm"\s*:\s*"Argon2id"/gi, '"hashing_algorithm": "bcrypt"');
  }
  if (sec6MentionsArgon2 && /"hashing_algorithm"\s*:\s*"bcrypt"/i.test(body)) {
    body = body.replace(/"hashing_algorithm"\s*:\s*"bcrypt"/gi, '"hashing_algorithm": "Argon2id"');
    if (!/"hashing_scope"\s*:/i.test(body)) {
      body = body.replace(
        /"hashing_algorithm"\s*:\s*"[^"]*"/i,
        (m) => `${m},\n      "hashing_scope": "local_passwords_and_bootstrap"`,
      );
    }
  }

  if (body === infra.body) return draft;
  return draft.slice(0, infra.start) + body + draft.slice(infra.end);
}

/** True si el MDD exige multi-tenant (TechnicalMetadata, §2, §3 o §6). */
function mddRequiresMultiTenant(draft: string): boolean {
  const sec1 =
    extractMddSectionBody(draft, "## 1. Contexto y alcance") ??
    extractMddSectionBody(draft, "## 1. Contexto");
  if (sec1?.body && corpusExcludesMultiTenantSaaS(sec1.body)) return false;
  if (/\[multi_tenant\]/i.test(draft)) return true;
  if (/```TechnicalMetadata[\s\S]*?\[multi_tenant\]/i.test(draft)) return true;
  const sec2 = extractMddSectionBody(draft, "## 2. Arquitectura y Stack");
  const sec3 = extractMddSectionBody(draft, "## 3. Modelo de Datos");
  const sec6 = extractMddSectionBody(draft, "## 6. Seguridad");
  const corpus = [sec2?.body, sec3?.body, sec6?.body].filter(Boolean).join("\n");
  if (/multi[\s-]?tenant|multitenanc|\btenant_id\b|multiinquilino|aislamiento\s+multi[\s-]?inquilino/i.test(corpus)) {
    return true;
  }
  if (sec3?.body && countNegocioIdMultiTenantSignals(sec3.body)) return true;
  return false;
}

/** Heurística: negocio_id en la mayoría de tablas §3 implica multi-tenant. */
function countNegocioIdMultiTenantSignals(section3Body: string): boolean {
  const createTableCount = (section3Body.match(/CREATE\s+TABLE/gi) ?? []).length;
  const negocioIdCount = (section3Body.match(/\bnegocio_id\b/gi) ?? []).length;
  return createTableCount >= 2 && negocioIdCount >= 3 && negocioIdCount >= createTableCount * 0.5;
}

/** Alinea integration_metadata.multi_tenant_support con TechnicalMetadata y §2/§3. */
export function fixIntegrationMetadataCoherence(draft: string): string {
  const infra = extractMddSectionBody(draft, "## 7. Infraestructura");
  if (!infra || !/"multi_tenant_support"/i.test(infra.body)) return draft;
  const requiresMultiTenant = mddRequiresMultiTenant(draft);
  let body = infra.body;
  if (requiresMultiTenant) {
    body = body.replace(/"multi_tenant_support"\s*:\s*false/gi, '"multi_tenant_support": true');
  }
  if (body === infra.body) return draft;
  return draft.slice(0, infra.start) + body + draft.slice(infra.end);
}
