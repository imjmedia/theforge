import {
  computeContractGaps,
  detectContextIntegrationContradiction,
} from "../../engine/mdd-internal-audit.util.js";
import { isCredentialStorageSatisfied } from "../utils/mdd-credential-storage.util.js";

function extractSection(md: string, pattern: RegExp): string {
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

function extractNumberedSection(md: string, sectionNum: number): string {
  return extractSection(md, new RegExp(`^##\\s+${sectionNum}\\.`, "im"));
}

function looksLikeMddEvidenceJson(o: Record<string, unknown>): boolean {
  return (
    ("summary" in o || "openapi_spec" in o || "evidence_paths" in o) &&
    ("entities" in o || "api_contracts" in o || "db_entities" in o || "evidence_paths" in o || "business_logic" in o)
  );
}

export function extractMddEvidenceJsonObject(md: string): Record<string, unknown> | null {
  const t = md.trim();
  const candidates: string[] = [];
  if (t.startsWith("{")) candidates.push(t);
  const fence = /```(?:json)?\s*(\{[\s\S]*?)\s*```/i.exec(t);
  if (fence?.[1]?.trim().startsWith("{")) candidates.push(fence[1].trim());
  const nl = t.indexOf("\n{");
  if (nl !== -1) {
    const rest = t.slice(nl + 1).trim();
    if (rest.startsWith("{")) candidates.push(rest);
  }
  for (const c of candidates) {
    try {
      const o = JSON.parse(c) as Record<string, unknown>;
      if (looksLikeMddEvidenceJson(o)) return o;
    } catch {
      /* siguiente candidato */
    }
  }
  return null;
}

function detectReferenceSectionsFromIngestJson(parsed: Record<string, unknown>, rawLen: number): {
  db: number;
  endpoints: number;
  endpointsWithPayloads: boolean;
  security: number;
  securitySubstantive: boolean;
  infra: number;
} {
  const ent = (parsed.db_entities ?? parsed.entities) as unknown;
  const entityN = Array.isArray(ent) ? ent.length : 0;
  const apiC = parsed.api_contracts;
  const apiN = Array.isArray(apiC) ? apiC.length : 0;
  const ev = parsed.evidence_paths;
  const evN = Array.isArray(ev) ? ev.length : 0;
  const spec = parsed.openapi_spec as { found?: unknown } | undefined;
  const summary = typeof parsed.summary === "string" ? parsed.summary : "";
  const blob = JSON.stringify(parsed);

  const hasIndexedMass = evN >= 12 || entityN > 0 || apiN > 0 || rawLen > 4000;
  const db = entityN > 0 ? 1 : hasIndexedMass ? 1 : evN >= 6 ? 0.5 : 0;
  const endpoints = apiN > 0 || (spec && spec.found === true) ? 1 : hasIndexedMass && evN >= 8 ? 1 : 0;
  const endpointsWithPayloads =
    apiN > 0 ||
    (spec && spec.found === true) ||
    /\b(payload|requestbody|responsebody)\b/i.test(blob) ||
    /\b(POST|PUT|PATCH)\s+\//i.test(blob + summary);

  const risk = parsed.risk_report as Record<string, unknown> | undefined;
  const infraObj = parsed.infrastructure as Record<string, unknown> | undefined;
  const security = risk != null && Object.keys(risk).length > 0 ? 0.5 : 0;
  const securitySubstantive =
    security > 0 &&
    (/anti_patterns|complexity/i.test(blob) ||
      (typeof risk?.complexity === "number" && risk.complexity > 0));
  const infra =
    infraObj != null && (Object.keys(infraObj).length > 0 || (Array.isArray(infraObj.env_vars) && infraObj.env_vars.length > 0))
      ? 0.5
      : 0;

  return { db, endpoints, endpointsWithPayloads, security, securitySubstantive, infra };
}

/**
 * Detecta secciones de referencia del MDD ancladas a headings `## N.`.
 */
export function detectReferenceSections(md: string): {
  db: number;
  endpoints: number;
  endpointsWithPayloads: boolean;
  security: number;
  securitySubstantive: boolean;
  infra: number;
} {
  const trimmed = (md || "").trim();
  const jsonObj = extractMddEvidenceJsonObject(trimmed);
  if (jsonObj) {
    return detectReferenceSectionsFromIngestJson(jsonObj, trimmed.length);
  }

  const section3 = extractNumberedSection(trimmed, 3);
  const section4 = extractNumberedSection(trimmed, 4);
  const section6 = extractNumberedSection(trimmed, 6);
  const section7 = extractNumberedSection(trimmed, 7);

  const db = section3.length >= 60 ? 1 : section3.length > 0 ? 0.5 : 0;
  const endpoints = section4.length >= 60 ? 1 : section4.length > 0 ? 0.5 : 0;

  const endpointsWithPayloads =
    endpoints > 0 &&
    /\b(POST|PUT|PATCH)\s+\//i.test(section4) &&
    (/\bpayload\b|\brequest\s*body\b|\bresponse\s*body\b|json\s*:\s*\{|```json\s*\{/i.test(section4));

  const security = section6.length >= 40 ? 1 : section6.length > 0 ? 0.5 : 0;
  const securitySubstantive =
    security > 0 &&
    (/autenticación|autorización|permisos|cifrado|token|sesión|hash|rbac|roles|mfa|argon2|2fa|two\-factor/i.test(
      section6,
    ) ||
      section6.length >= 120);

  const infra = section7.length >= 40 ? 1 : section7.length > 0 ? 0.5 : 0;

  return {
    db,
    endpoints,
    endpointsWithPayloads,
    security,
    securitySubstantive,
    infra,
  };
}

/** Gaps de consistencia y completitud (agnóstico de dominio). */
export function computeConsistencyGaps(md: string): {
  contradictionGap: number;
  securityCompletenessGap: number;
  missingManifest: number;
  dataIntegrityGap: number;
  apiSchemaGap: number;
  mermaidParityGap: number;
  infraStackGap: number;
  securityEdgeCaseGap: number;
} {
  const lower = (md || "").trim().toLowerCase();
  const contextBlock = extractSection(
    md,
    /^##\s+(?:1\.\s*)?(?:contexto\s+y\s+alcance|contexto\b)/im,
  ).toLowerCase();
  const dataModelBlock = extractSection(
    md,
    /^##\s+(?:3\.\s*)?(?:modelo\s+de\s+datos|datos\s*\/\s*entidades)/im,
  ).toLowerCase();
  const integrationBlock = extractSection(
    md,
    /^##\s+(?:7\.\s*)?(?:infraestructura|infra|integraci[oó]n)/im,
  ).toLowerCase();
  const sqlBlock = (md.match(/```sql\s*([\s\S]*?)```/i)?.[1] ?? "") + (dataModelBlock || lower);
  const tablesAndColumns = sqlBlock;

  const contractGaps = computeContractGaps(md);
  const contradictionGap = detectContextIntegrationContradiction(contextBlock, integrationBlock) ? 1 : 0;

  let securityCompletenessGap = 0;
  const highSecurity = /\b(high_security|alta seguridad|seguridad crítica)\b/i.test(lower);
  if (highSecurity) {
    const needsAudit = /\b(ip_address|user_agent|ip\b|user_agent)\b/i.test(tablesAndColumns);
    if (!needsAudit) securityCompletenessGap += 0.5;
  }
  if (!isCredentialStorageSatisfied(md)) {
    securityCompletenessGap += 0.5;
  }
  securityCompletenessGap = Math.min(1, securityCompletenessGap);

  let dataIntegrityGap = 0;
  const hasTables = /\bcreate\s+table\b/i.test(sqlBlock);
  if (hasTables) {
    const hasUuidPk =
      /(?:gen_random_uuid|uuid_generate_v4|default\s+gen_random_uuid)/i.test(sqlBlock) ||
      /\buuid\s+primary\s+key\b/i.test(sqlBlock) ||
      (/\buuid\b/i.test(sqlBlock) && /\bprimary\s+key\b/i.test(sqlBlock));
    const hasTimestamps = /(?:created_at|updated_at)/i.test(sqlBlock) && /timestamptz/i.test(sqlBlock);
    if (!hasUuidPk) dataIntegrityGap += 0.5;
    if (!hasTimestamps) dataIntegrityGap += 0.5;
  }
  dataIntegrityGap = Math.min(1, dataIntegrityGap);

  let missingManifest = 0;
  const hasInfraSection =
    integrationBlock.length > 80 || /^##\s+(?:7\.\s*)?(?:infra|integraci[oó]n)/im.test(md);
  const hasManifestJson = /```json\s*[\s\S]*?(?:manifest|infra|services|stack)[\s\S]*?```/i.test(md);
  const hasTechnicalMetadata = /technicalmetadata|technical\s+metadata|base\s+template|plantilla\s+base/i.test(lower);
  const isDerivedOrMicro = /\b(microservice|microservicio|derived|hereda|plantilla\s+base)\b/i.test(lower);
  if (hasInfraSection && !hasManifestJson && !hasTechnicalMetadata) {
    missingManifest = isDerivedOrMicro ? 0.5 : 0.25;
  }

  return {
    contradictionGap,
    securityCompletenessGap,
    missingManifest,
    dataIntegrityGap,
    ...contractGaps,
  };
}
