import { detectSection2Section7NodeVersionMismatchIssue } from "../ai-analysis/utils/mdd-sanitize.js";

/**
 * Deterministic MDD internal audit helpers (§1↔§3↔§4↔§6↔§7, SQL↔Mermaid).
 * Shared by EstimationService and the MDD Auditor node.
 */

/** Extract body of the first section matching pattern (until next ##). */
export function extractMddSection(md: string, pattern: RegExp): string {
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

function toSnakeCase(s: string): string {
  return s
    .replace(/([A-Z])/g, "_$1")
    .toLowerCase()
    .replace(/^_/, "")
    .replace(/-/g, "_");
}

function extractSqlColumnNames(sqlBlock: string): Set<string> {
  const set = new Set<string>();
  const createMatch = sqlBlock.matchAll(
    /\bcreate\s+table\s+(?:if\s+not\s+exists\s+)?["`]?([a-z_][a-z0-9_]*)["`]?\s*\(([\s\S]*?)\)\s*;/gi,
  );
  for (const m of createMatch) {
    const body = m[2] ?? "";
    const tokens = body.split(/[\s,]+/);
    for (const t of tokens) {
      if (
        t &&
        /^[a-z_][a-z0-9_]*$/i.test(t) &&
        !/^(primary|key|references|constraint|unique|check|default|not|null|uuid|integer|varchar|text|boolean|timestamptz|timestamp|int|bigint|real|serial|on|delete|cascade|set|true|false|in|between|and|or|as|from|where|having|group|order|by|asc|desc|like|is|exists|any|all|some|off|a|pgp_sym_encrypt|jsonb|inet|jwt|bcrypt|nivel|cifrado|cost|soft)$/i.test(
          t,
        )
      ) {
        set.add(t.toLowerCase());
      }
    }
  }
  return set;
}

function extractJsonKeysFromSection(text: string): Set<string> {
  const set = new Set<string>();
  const jsonBlocks = text.matchAll(/```json\s*([\s\S]*?)```/gi);
  for (const m of jsonBlocks) {
    try {
      const parsed = JSON.parse(m[1]?.trim() ?? "{}") as Record<string, unknown>;
      for (const k of Object.keys(parsed)) set.add(toSnakeCase(k));
    } catch {
      // skip malformed JSON
    }
  }
  return set;
}

function extractMermaidEntityAndAttrNames(md: string): { entities: Set<string>; attributes: Set<string> } {
  const entities = new Set<string>();
  const attributes = new Set<string>();
  const m = md.match(/```mermaid\s*([\s\S]*?)```/i);
  const inner = m?.[1]?.trim() ?? "";
  if (!/erDiagram/i.test(inner)) return { entities, attributes };
  const lines = inner.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const entityMatch = line.match(/^\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\{\s*$/);
    if (entityMatch) {
      entities.add(entityMatch[1].toLowerCase());
      i++;
      while (i < lines.length && !/^\s*\}\s*$/.test(lines[i]!)) {
        const attrMatch = lines[i]!.match(/\s*(\w+)\s+([a-zA-Z_][a-zA-Z0-9_]*)/);
        if (
          attrMatch &&
          !/^(uuid|default|pk|fk|index|unique|key|null|not|set|check|primary|references)$/i.test(attrMatch[2])
        ) {
          attributes.add(attrMatch[2].toLowerCase());
        }
        i++;
      }
      continue;
    }
  }
  return { entities, attributes };
}

const MFA_TOKEN_RE = /\b(?:mfa|totp|2fa|two[- ]?factor|segundo factor|google\s+authenticator)\b/gi;
const MFA_NEGATION_WORDS = new Set(["no", "sin"]);
/** Tras la mención: "MFA no se implementa/incluye en v1", "MFA fuera de alcance". */
const MFA_POST_NEGATION_RE =
  /^[^.;\n]{0,24}?\b(?:no\s+(?:se\s+)?(?:implementa|incluye|soporta|contempla|habr[aá]|usar[aá])|fuera\s+de\s+alcance|no\s+aplica)/i;

/**
 * true si el texto menciona MFA/TOTP/2FA de forma afirmativa: se descartan las menciones precedidas por
 * "no|sin" (hasta 4 palabras antes, en la misma oración) o seguidas de "no se implementa…/fuera de alcance".
 */
export function mentionsMfaAffirmatively(text: string): boolean {
  const src = text ?? "";
  for (const m of src.matchAll(MFA_TOKEN_RE)) {
    const idx = m.index ?? 0;
    const before = src.slice(0, idx);
    const sentenceStart = Math.max(
      before.lastIndexOf("."),
      before.lastIndexOf(";"),
      before.lastIndexOf("\n"),
      before.lastIndexOf("!"),
      before.lastIndexOf("?"),
    );
    const words = before
      .slice(sentenceStart + 1)
      .split(/\s+/)
      .map((w) => w.replace(/[^\p{L}]/gu, "").toLowerCase())
      .filter(Boolean)
      .slice(-4);
    if (words.some((w) => MFA_NEGATION_WORDS.has(w))) continue;
    const after = src.slice(idx + m[0].length);
    if (MFA_POST_NEGATION_RE.test(after)) continue;
    return true;
  }
  return false;
}

const AUTH_PROTOCOL_NEGATIONS: ReadonlyArray<{ no: RegExp; yes: RegExp }> = [
  {
    no: /no\s+(?:se\s+)?(?:implementa(?:r[áa]n?)?|implementar)\s+(?:un\s+|el\s+|su\s+)?(?:oauth|oidc|saml|openid)/i,
    yes: /\b(?:oauth|oidc|saml|openid\s+connect)\b/i,
  },
  { no: /no\s+habr[áa]\s+(?:oauth|oidc|saml)/i, yes: /\b(?:oauth|oidc|saml)\b/i },
  { no: /no\s+se\s+usar[áa]\s+(?:oauth|oidc|saml)/i, yes: /\b(?:oauth|oidc|saml)\b/i },
];

/** La oración de §1 delega el protocolo a un tercero (no es una contradicción con §7). */
const DELEGATION_RE =
  /\b(?:delega\w*|externo\w*|externa\w*|proveedor\w*|identity\s+provider|idp|keycloak|auth0|cognito|okta)\b/i;

/**
 * Contradicción §1 ↔ §7: la MISMA oración de §1 niega implementar OAuth/OIDC/SAML y §7 lo afirma.
 * No cuenta si la oración delega en un proveedor externo ("No se implementará OAuth propio; se delega en Keycloak").
 */
export function detectContextIntegrationContradiction(contextBlock: string, integrationBlock: string): boolean {
  const sentences = (contextBlock ?? "").split(/(?<=[.!?])\s+|\n+/);
  const integration = integrationBlock ?? "";
  for (const sentence of sentences) {
    if (!sentence.trim()) continue;
    for (const { no, yes } of AUTH_PROTOCOL_NEGATIONS) {
      if (!no.test(sentence)) continue;
      if (DELEGATION_RE.test(sentence)) continue;
      if (yes.test(integration)) return true;
    }
  }
  return false;
}

const TRACEABILITY_SECTION_KEYS = ["contexto", "modeloDatos", "apiContracts", "seguridad"] as const;

/** Traceability: Context mentions MFA-like concepts without §3/§4/§6 support. */
export function computeTraceabilityGaps(md: string): {
  inconsistentSections: ReadonlyArray<(typeof TRACEABILITY_SECTION_KEYS)[number]>;
} {
  const inconsistentSections: Array<(typeof TRACEABILITY_SECTION_KEYS)[number]> = [];
  const contextBlock = extractMddSection(
    md,
    /^#+\s*(?:1\.\s*)?(?:contexto\s+y\s+alcance|contexto\b)/im,
  ).toLowerCase();
  const dataModelBlock = extractMddSection(
    md,
    /^#+\s*(?:3\.\s*)?(?:modelo\s+de\s+datos|datos\s*\/\s*entidades)/im,
  ).toLowerCase();
  const apiBlock = extractMddSection(
    md,
    /^#+\s*(?:4\.\s*)?(?:contratos\s+de\s+api|api\s+contracts|endpoints)/im,
  ).toLowerCase();
  const securityBlock = extractMddSection(
    md,
    /^##\s+(?:\d+\.\s*)?(?:seguridad|security)/im,
  ).toLowerCase();
  const sqlBlock = (md.match(/```sql\s*([\s\S]*?)```/i)?.[1] ?? "") + dataModelBlock;

  const hasMfaInContext = mentionsMfaAffirmatively(contextBlock);
  if (hasMfaInContext) {
    const hasSecretTables =
      /\bmfa_secrets\b|\btotp_secret\b|\bmfa_secret\b|\botp_secret\b|\bwebauthn_credentials?\b|\bpasskeys?\b|create\s+table\s+\w*secret/i.test(
        sqlBlock,
      );
    const hasVerifyEndpoint = /\/verify|\/totp|\/mfa|\/webauthn|\/passkeys?|verify.*totp/i.test(apiBlock);
    const hasTotpInSecurity =
      /\b(totp|rfc\s*6238|algoritmo\s+totp|time-based|webauthn|passkeys?|fido2|authenticator)\b/i.test(securityBlock);
    const hasAnySupport = hasSecretTables || hasVerifyEndpoint || hasTotpInSecurity;
    if (!hasAnySupport) {
      inconsistentSections.push("contexto", "modeloDatos", "apiContracts", "seguridad");
    }
  }

  return {
    inconsistentSections: [...new Set(inconsistentSections)],
  };
}

export interface MddContractGaps {
  apiSchemaGap: number;
  mermaidParityGap: number;
  infraStackGap: number;
  securityEdgeCaseGap: number;
}

/** Números uno..diez (ES/EN) cuentan como dígito al definir el umbral de intentos. */
const NUM_TOKEN = String.raw`(?:\d+|uno|una|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|one|two|three|four|five|six|seven|eight|nine|ten)`;
const SECURITY_ATTEMPTS_DEFINED_RE = new RegExp(
  String.raw`\b${NUM_TOKEN}\s*(?:intentos?|attempts?|fallos?)|intentos?\s*:\s*${NUM_TOKEN}\b|m[aá]ximo\s+(?:de\s+)?${NUM_TOKEN}\b|fallos?\s*:\s*${NUM_TOKEN}\b`,
  "i",
);

/** Contract gaps aligned with Auditor protocol: §2↔§7, §3↔Mermaid, §4↔§3, §5↔§6. */
export function computeContractGaps(md: string): MddContractGaps {
  let apiSchemaGap = 0;
  let mermaidParityGap = 0;
  let infraStackGap = 0;
  let securityEdgeCaseGap = 0;

  const dataModelBlock = extractMddSection(
    md,
    /^#+\s*(?:3\.\s*)?(?:modelo\s+de\s+datos|datos\s*\/\s*entidades)/im,
  );
  const apiBlock = extractMddSection(
    md,
    /^#+\s*(?:4\.\s*)?(?:contratos\s+de\s+api|api\s+contracts|endpoints)/im,
  );
  const archBlock = extractMddSection(
    md,
    /^#+\s*(?:2\.\s*)?(?:arquitectura\s+y\s+stack|arquitectura\b)/im,
  ).toLowerCase();
  const logicBlock = extractMddSection(
    md,
    /^#+\s*(?:5\.\s*)?(?:lógica\s+y\s+edge\s+cases|lógica\b|edge\s+cases)/im,
  ).toLowerCase();
  const securityBlock = extractMddSection(
    md,
    /^##\s+(?:\d+\.\s*)?(?:seguridad|security)/im,
  ).toLowerCase();
  const infraBlock = extractMddSection(
    md,
    /^#+\s*(?:7\.\s*)?(?:infraestructura|infra|integraci[oó]n)/im,
  ).toLowerCase();

  const sqlBlock = (md.match(/```sql\s*([\s\S]*?)```/i)?.[1] ?? "") + dataModelBlock;
  const sqlColumns = extractSqlColumnNames(sqlBlock);
  const sqlTableNames = new Set(
    [...md.matchAll(/\bcreate\s+table\s+(?:if\s+not\s+exists\s+)?["`]?([a-z_][a-z0-9_]*)["`]?/gi)].map(
      (x) => x[1]!.toLowerCase(),
    ),
  );

  const skipApiKeys =
    /^(id|created_at|updated_at|password|confirm_password|token|refresh_token|redirect_uri|scope|code|totp_code|client|user|data|meta)$/i;
  if (sqlColumns.size > 0 && apiBlock.length > 100) {
    const apiKeys = extractJsonKeysFromSection(apiBlock);
    for (const k of apiKeys) {
      if (k && !skipApiKeys.test(k) && !sqlColumns.has(k)) {
        const fromCamel = k.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
        const backToSnake = fromCamel.replace(/([A-Z])/g, "_$1").toLowerCase();
        if (!sqlColumns.has(backToSnake)) {
          apiSchemaGap = 1;
          break;
        }
      }
    }
  }

  if (sqlTableNames.size > 0 && /```mermaid[\s\S]*?erDiagram/i.test(md)) {
    const { entities, attributes } = extractMermaidEntityAndAttrNames(md);
    for (const e of entities) {
      if (!sqlTableNames.has(e)) {
        mermaidParityGap = 1;
        break;
      }
    }
    if (mermaidParityGap === 0) {
      for (const a of attributes) {
        if (!sqlColumns.has(a)) {
          mermaidParityGap = 1;
          break;
        }
      }
    }
  }

  if (detectSection2Section7NodeVersionMismatchIssue(md)) {
    infraStackGap = 1;
  } else if (/\b(nestjs|node\.?js|node\s)/i.test(archBlock) && archBlock.length > 50) {
    // Serverless (Lambda/Vercel/Cloud Run) o "node runtime" también reflejan Node sin Dockerfile.
    const infraReflectsNode =
      /\b(dockerfile|from\s+node|npm\s|pnpm\s|node\s|nodejs|docker\b|contenedor|imagen\s+node|backend\s+node|lambda|vercel|cloud\s*run|serverless|node\s+runtime)/i.test(
        infraBlock,
      );
    if (!infraReflectsNode) infraStackGap = 1;
  }

  if (
    /\b(bloqueo\s+de\s+cuenta|lock\s+account|intentos\s+fallidos|failed\s+attempts|máximo\s+de\s+intentos|fallos?\b)/i.test(
      logicBlock,
    )
  ) {
    if (!SECURITY_ATTEMPTS_DEFINED_RE.test(securityBlock)) {
      securityEdgeCaseGap = 1;
    }
  }

  return { apiSchemaGap, mermaidParityGap, infraStackGap, securityEdgeCaseGap };
}
