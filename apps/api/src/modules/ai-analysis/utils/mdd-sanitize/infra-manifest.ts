/** Detección de infra en texto y construcción/saneamiento de manifest §7. */

/** Patrones para detectar en el documento qué infra/orquestación/despliegue está identificada (genérico). */
const INFRA_TERM_PATTERNS: Array<{ pattern: RegExp; key: string }> = [
  { pattern: /docker\s+compose|docker-compose/i, key: "docker-compose" },
  { pattern: /\bdocker\b/i, key: "docker" },
  { pattern: /\bdokploy\b/i, key: "dokploy" },
  { pattern: /\bkubernetes\b|k8s\b/i, key: "kubernetes" },
  { pattern: /\baws\b|api\s+gateway|amazon\s+cognito|rds\b|cloudwatch|cloudtrail/i, key: "aws" },
  { pattern: /\bgcp\b|google\s+cloud|cloud\s+run/i, key: "gcp" },
  { pattern: /\bterraform\b/i, key: "terraform" },
  { pattern: /\becs\b|eks\b|ec2\b/i, key: "aws" },
];

/**
 * Extrae del texto del documento (contexto, borrador, respuestas del usuario) los términos de
 * infraestructura/orquestación/despliegue que están identificados (Docker, Dokploy, K8s, AWS, GCP, etc.).
 * Sirve para que el manifest refleje solo lo que el documento menciona.
 */
export function extractIdentifiedInfraFromText(text: string): string[] {
  if (!text || typeof text !== "string") return [];
  const found = new Set<string>();
  for (const { pattern, key } of INFRA_TERM_PATTERNS) {
    if (pattern.test(text)) found.add(key);
  }
  return [...found];
}

/**
 * Patrones indicativos (agnósticos de dominio) para detectar temas ya documentados.
 * Cubren ámbitos frecuentes en MDDs (auth, datos, infra, etc.); el Clarificador debe usar
 * además el borrador completo como fuente de verdad: cualquier tema ya redactado, sea cual sea
 * el dominio, no debe generar pregunta.
 */
const ALREADY_DOCUMENTED_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /\b(transacciones\s+ACID|ACID\b|integridad\s+transaccional|consistencia\s+(fuerte|eventual|ACID))\b/i, label: "transacciones/consistencia" },
  { pattern: /\b(MFA|TOTP|2FA|autenticaci[oó]n\s+multifactor|segundo\s+factor)\b/i, label: "MFA/segundo factor" },
  { pattern: /\b(JWT|tokens?\s+JSON|json\s+web\s+token)\b/i, label: "JWT/tokens" },
  { pattern: /\b(password_hash|hash\s+de\s+contraseña|bcrypt|argon2)\b/i, label: "almacenamiento de credenciales" },
  { pattern: /\b(sesiones?|sessions?)\b/i, label: "sesiones" },
  { pattern: /\b(RBAC|roles?\s+y\s+permisos|control\s+de\s+acceso)\b/i, label: "roles/permisos" },
  { pattern: /\b(auditoría|audit|created_at|registro\s+de\s+actividades)\b/i, label: "auditoría" },
  { pattern: /\b(docker|kubernetes|dokploy|docker-compose)\b/i, label: "infraestructura/despliegue" },
  { pattern: /\b(manifest|stack|orquestaci[oó]n)\b/i, label: "manifest de infra" },
  { pattern: /\b(pago|payment|stripe|mercadopago|pasarela)\b/i, label: "pagos" },
  { pattern: /\b(inventario|stock|catálogo|catalog)\b/i, label: "inventario/catálogo" },
  { pattern: /\b(pedido|order)\b/i, label: "pedidos" },
  { pattern: /\b(notificaci[oó]n|notification|email\s+push)\b/i, label: "notificaciones" },
  { pattern: /\b(integridad\s+referencial|foreign\s+key|REFERENCES)\b/i, label: "integridad referencial" },
];

/**
 * Extrae temas indicativos que ya aparecen en el borrador (cualquier dominio) para que el
 * Clarificador no repita preguntas. La lista es orientativa; el LLM debe revisar el borrador
 * completo y no preguntar sobre ningún tema ya cubierto en el texto.
 */
export function extractAlreadyDocumentedTopics(draft: string): string[] {
  if (!draft || typeof draft !== "string") return [];
  const found = new Set<string>();
  for (const { pattern, label } of ALREADY_DOCUMENTED_PATTERNS) {
    if (pattern.test(draft)) found.add(label);
  }
  return [...found];
}

/**
 * Construye un manifest JSON mínimo a partir de términos de infra identificados en el documento.
 * Si no hay ninguno, devuelve un manifest con pending para que se pregunte al usuario.
 */
export function buildManifestFromIdentifiedInfra(identifiedTerms: string[]): string {
  const normalized = [...new Set(identifiedTerms.map((t) => t.toLowerCase()))];
  if (normalized.length === 0) {
    return JSON.stringify(
      {
        manifest: "infra-v1",
        stack: [],
        pending: "Definir con el usuario: orquestación (Docker Compose, K8s, etc.) y despliegue (Dokploy, AWS ECS, GCP, etc.)",
      },
      null,
      2,
    );
  }
  const hasAws = normalized.some((t) => t === "aws");
  const hasDocker = normalized.some((t) => t === "docker" || t === "docker-compose");
  const hasDokploy = normalized.some((t) => t === "dokploy");
  const hasK8s = normalized.some((t) => t === "kubernetes");
  if (hasDocker || hasDokploy) {
    return JSON.stringify(
      {
        manifest: "infra-v1",
        orchestration: hasDocker ? "docker-compose" : undefined,
        deployment: hasDokploy ? "dokploy" : undefined,
        stack: [...new Set([...(hasDocker ? ["docker", "docker-compose"] : []), ...(hasDokploy ? ["dokploy"] : [])])],
        services: ["api", "db", "frontend"],
      },
      null,
      2,
    );
  }
  if (hasK8s) {
    return JSON.stringify(
      { manifest: "infra-v1", orchestration: "kubernetes", stack: ["kubernetes"], services: ["api", "db", "frontend"] },
      null,
      2,
    );
  }
  if (hasAws) {
    return JSON.stringify(
      { manifest: "infra-v1", provider: "aws", stack: normalized, services: ["api", "db", "frontend"] },
      null,
      2,
    );
  }
  return JSON.stringify(
    { manifest: "infra-v1", stack: normalized, services: ["api", "db", "frontend"] },
    null,
    2,
  );
}

/**
 * Construye un manifest en el formato exclusivo (project_id, stack, deployment, integration_metadata)
 * a partir de términos identificados en el documento. Usado cuando el LLM no devuelve JSON válido
 * y el fallback no tiene bloque ```json (evita salida "Manifest: Docker, Dokploy").
 */
export function buildNewFormatManifestFromIdentifiedTerms(identifiedTerms: string[]): Record<string, unknown> {
  const normalized = [...new Set(identifiedTerms.map((t) => t.toLowerCase()))];
  const hasDokploy = normalized.includes("dokploy");
  const hasK8s = normalized.includes("kubernetes") || normalized.includes("k8s");
  const hasDocker = normalized.includes("docker") || normalized.includes("docker-compose");
  const orchestrator = hasK8s ? "Kubernetes" : hasDocker ? "Docker Compose" : "TBD";
  const deploymentManager = hasDokploy ? "Dokploy" : "TBD";
  return {
    project_id: "mdd-project",
    stack: {
      backend: {
        framework: "NestJS",
        version: "10.x",
        language: "TypeScript",
        orm: "TypeORM",
        container: { base_image: "node:20-alpine", exposed_port: 3000 },
      },
      database: { engine: "PostgreSQL", version: "16", extensions: ["uuid-ossp", "pgcrypto"] },
      security: {
        protocol: "HTTPS",
        token_management: "JWT",
        mfa_strategy: "TOTP",
        hashing_algorithm: "bcrypt",
        hashing_rounds: 12,
      },
    },
    deployment: {
      orchestrator,
      provider: "Self-hosted / Cloud",
      tooling: { deployment_manager: deploymentManager, ci_cd: "Bitbucket Pipelines" },
      resources: { min_replicas: 1, max_replicas: 5, cpu_threshold: "70%" },
    },
    integration_metadata: { api_prefix: "/api/v1", jwks_enabled: false, multi_tenant_support: false },
  };
}

/**
 * Si el documento identificó una infra concreta (identifiedTerms) y el bloque manifest de la sección
 * incluye proveedores/servicios NO mencionados (ej. AWS cuando solo se mencionó Docker/Dokploy),
 * reemplaza el bloque por un manifest coherente con lo identificado.
 * Si identifiedTerms está vacío, reemplaza manifest con placeholder para definir con el usuario.
 */
export function sanitizeManifestToMatchIdentifiedInfra(sectionBody: string, identifiedTerms: string[]): string {
  if (!sectionBody) return sectionBody;
  const jsonBlockRe = /```json\s*\n[\s\S]*?```/g;
  const normalized = [...new Set(identifiedTerms.map((t) => t.toLowerCase()))];
  const hasAwsInDoc = normalized.includes("aws");
  const hasDockerDokployInDoc = ["docker", "docker-compose", "dokploy"].some((k) => normalized.includes(k));

  return sectionBody.replace(jsonBlockRe, (block) => {
    if (normalized.length === 0) {
      if (/^\s*\{\s*"manifest"/m.test(block) && !/"pending"/.test(block)) {
        return "```json\n" + buildManifestFromIdentifiedInfra([]) + "\n```";
      }
      return block;
    }
    const blockHasAws = /api_gateway|Cognito|RDS|CloudWatch|CloudTrail|AWS\s+API/i.test(block);
    if (hasDockerDokployInDoc && !hasAwsInDoc && blockHasAws) {
      return "```json\n" + buildManifestFromIdentifiedInfra(identifiedTerms) + "\n```";
    }
    if (hasAwsInDoc && !blockHasAws && block.length < 200) {
      return "```json\n" + buildManifestFromIdentifiedInfra(identifiedTerms) + "\n```";
    }
    return block;
  });
}

/**
 * Si manifest §7 tiene `stack` vacío pero §2/§7 citan infra (Docker, Dokploy…), rellena stack
 * desde términos identificados (evita gate «Manifest sin stack» tras Integration snapshot).
 */
export function hydrateEmptyManifestStackInDraft(draft: string): string {
  const trimmed = (draft ?? "").trim();
  if (!trimmed) return draft;
  const infrMatch = trimmed.match(/\n##\s+(?:7\.\s+)?(?:Infraestructura|Integración)\b[\s\S]*/i);
  if (!infrMatch?.[0]) return draft;
  const section7 = infrMatch[0];
  const jsonMatch = section7.match(/```json\s*\n([\s\S]*?)```/i);
  if (!jsonMatch?.[1]) return draft;
  let obj: Record<string, unknown>;
  try {
    obj = JSON.parse(jsonMatch[1]) as Record<string, unknown>;
  } catch {
    return draft;
  }
  const stack = obj.stack;
  const stackEmpty =
    stack == null ||
    (Array.isArray(stack) && stack.length === 0) ||
    (typeof stack === "object" && !Array.isArray(stack) && Object.keys(stack as object).length === 0);
  if (!stackEmpty) return draft;

  const s2Match = trimmed.match(/\n##\s+2\.\s*Arquitectura[\s\S]*?(?=\n##\s+\d+\.|\n##\s+Seguridad|\n##\s+UI\/UX|$)/i);
  const corpus = `${s2Match?.[0] ?? ""}\n${section7}`;
  const terms = extractIdentifiedInfraFromText(corpus);
  if (terms.length === 0) return draft;

  const hydrated = buildNewFormatManifestFromIdentifiedTerms(terms);
  const newBlock = "```json\n" + JSON.stringify(hydrated, null, 2) + "\n```";
  const replaced = section7.replace(/```json\s*\n[\s\S]*?```/i, newBlock);
  return trimmed.replace(section7, replaced);
}

/**
 * Si la infra identificada en el documento NO es AWS (ej. solo Docker/Dokploy), reemplaza en las secciones
 * Seguridad e Integración las menciones a AWS Cognito, AWS RDS, etc. por equivalentes genéricos para evitar
 * contradicción con un alcance self-hosted.
 */
export function replaceAwsProseWithGenericWhenInfraNotAws(draft: string): string {
  if (!draft || typeof draft !== "string") return draft;
  const identified = extractIdentifiedInfraFromText(draft);
  const normalized = [...new Set(identified.map((t) => t.toLowerCase()))];
  if (normalized.includes("aws")) return draft;

  const replacements: Array<[RegExp, string]> = [
    [/AWS\s+Cognito|Amazon\s+Cognito/gi, "servicio de autenticación (self-hosted)"],
    [/AWS\s+RDS|Amazon\s+RDS/gi, "base de datos PostgreSQL"],
    [/AWS\s+API\s+Gateway|API\s+Gateway\s+\(AWS\)/gi, "API / gateway de la aplicación"],
    [/AWS\s+CloudWatch|CloudWatch/gi, "monitoreo"],
    [/AWS\s+CloudTrail|CloudTrail/gi, "registro de auditoría"],
  ];

  for (const heading of ["## Seguridad", "## Integración"]) {
    const idx = draft.indexOf(heading);
    if (idx === -1) continue;
    const sectionStart = idx + heading.length;
    const rest = draft.slice(sectionStart);
    const nextH2 = rest.search(/\n##\s+/);
    const body = nextH2 !== -1 ? rest.slice(0, nextH2) : rest;
    let newBody = body;
    for (const [re, replacement] of replacements) {
      newBody = newBody.replace(re, replacement);
    }
    if (newBody === body) continue;
    const afterSection = nextH2 !== -1 ? rest.slice(nextH2) : "";
    draft = draft.slice(0, sectionStart) + newBody + afterSection;
  }
  return draft;
}
