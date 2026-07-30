/**
 * Job 85: fence ```json de §4 sin cerrar ⇒ §5 (extractor fence-aware) mide 0 mientras §6/§7
 * siguen visibles, y PersistCheck tumba el job con «§5 pre=999 post=0».
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  closeTrailingUnclosedFences,
  closeUnclosedFencesBeforeCanonicalH2,
  ensureDocumentFenceParity,
} from "./section-fence.util.js";
import { formatAllContratosSectionsInDraft } from "./contratos-format.js";
import { normalizeMddFormat, prepareMddMarkdownForPersist } from "./persist-pipeline.js";
import { detectTruncatedMddTail } from "@theforge/shared-types";
import {
  deduplicateAndReorderMddSections,
  extractContextSectionBody,
  replaceContextSectionBody,
  extractSection5Body,
  extractSection6Body,
  extractSection7Body,
  fixGluedSection6Heading,
  replaceMddSection5Body,
} from "./section-merge.js";
import { guardValidatedSectionsForPersist } from "../mdd-section-preserve.util.js";

const S5_BODY = `- Reintento con backoff exponencial cuando el HSM no responde en 2s.
- Rechazo de rotación si la clave está en uso por una operación en curso.
- Expiración de token: 401 con cabecera WWW-Authenticate y refresh obligatorio.
- Idempotencia por Idempotency-Key en operaciones de cifrado y descifrado.
- Auditoría obligatoria de todo acceso a material criptográfico, incluso fallido.`;

const S6_BODY = `- Autenticación LDAP/AD corporativo con soporte de cuentas de servicio.
- Autorización RBAC por rol y ámbito de clave; deny by default en todos los endpoints.
- Cifrado en tránsito TLS 1.3 y en reposo con envelope encryption sobre HSM.`;

const S7_BODY = `### 7.1 Flujo de integración

La aplicación detecta que no hay token válido y redirige al login del SSO corporativo.

### 7.2 Infraestructura y despliegue

Kubernetes 1.30 con HPA por CPU y despliegue blue/green desde el pipeline de CI.`;

/** §4 con ```json abierto: §5–§7 quedan textualmente dentro del bloque. */
const DRAFT_WITH_OPEN_JSON_FENCE = [
  "# Master Design Document",
  "",
  "## 4. Contratos de API",
  "",
  "### POST /api/v1/crypto/encrypt",
  "",
  "**Request body:**",
  "",
  "```json",
  '{ "keyId": "string", "plaintext": "string" }',
  "",
  "## 5. Lógica y Edge Cases",
  "",
  S5_BODY,
  "",
  "## 6. Seguridad",
  "",
  S6_BODY,
  "",
  "## 7. Infraestructura",
  "",
  S7_BODY,
].join("\n");

describe("fence ```json abierto en §4", () => {
  it("extractSection5Body repara fence abierto y encuentra §5 sustancial", () => {
    const body = extractSection5Body(DRAFT_WITH_OPEN_JSON_FENCE);
    assert.ok(body != null, "§5 debe encontrarse tras reparar fences");
    assert.ok(body!.includes("backoff exponencial"));
    assert.ok(extractSection6Body(DRAFT_WITH_OPEN_JSON_FENCE));
  });

  it("closeUnclosedFencesBeforeCanonicalH2 recupera §5, §6 y §7", () => {
    const fixed = closeUnclosedFencesBeforeCanonicalH2(DRAFT_WITH_OPEN_JSON_FENCE);
    assert.ok(String(extractSection5Body(fixed)).includes("backoff exponencial"));
    assert.ok(String(extractSection6Body(fixed)).includes("deny by default"));
    assert.ok(String(extractSection7Body(fixed)).includes("blue/green"));
    assert.equal((fixed.match(/```/g) ?? []).length % 2, 0);
  });

  it("es idempotente", () => {
    const once = closeUnclosedFencesBeforeCanonicalH2(DRAFT_WITH_OPEN_JSON_FENCE);
    assert.equal(closeUnclosedFencesBeforeCanonicalH2(once), once);
  });

  it("replaceMddSection5Body no confunde ## 5 dentro de fence §4 (job 86)", () => {
    assert.match(DRAFT_WITH_OPEN_JSON_FENCE, /##\s*5\.\s*Lógica/i);
    const newBody = `${S5_BODY}\n${"- Regla BDD adicional con Given/When/Then para rotación de claves.\n".repeat(8)}`.trim();
    assert.ok(newBody.length >= 100);
    const fixed = closeUnclosedFencesBeforeCanonicalH2(DRAFT_WITH_OPEN_JSON_FENCE);
    const merged = replaceMddSection5Body(fixed, newBody);
    assert.notEqual(merged, fixed);
    assert.ok(String(extractSection5Body(merged)).includes("backoff exponencial"));
    assert.ok(String(extractSection5Body(merged)).includes("Given/When/Then"));
  });

  it("no toca un draft con fences equilibrados", () => {
    const closed = DRAFT_WITH_OPEN_JSON_FENCE.replace(
      '{ "keyId": "string", "plaintext": "string" }',
      '{ "keyId": "string", "plaintext": "string" }\n```',
    );
    assert.equal(closeUnclosedFencesBeforeCanonicalH2(closed), closed);
  });

  it("formatAllContratosSectionsInDraft no traga §5–§7 tras preflight fence §4", () => {
    const fixed = closeUnclosedFencesBeforeCanonicalH2(DRAFT_WITH_OPEN_JSON_FENCE);
    const formatted = formatAllContratosSectionsInDraft(fixed);
    assert.ok(String(extractSection5Body(formatted)).includes("backoff exponencial"));
    assert.ok(String(extractSection6Body(formatted)).includes("deny by default"));
    assert.ok(String(extractSection7Body(formatted)).includes("blue/green"));
  });
});

/**
 * Job 92: el preflight de fences era responsabilidad del caller y `normalizeMddFormat`
 * no lo hacía, así que §4 se tragaba la cola en persist tras 17 min de pipeline correcto.
 */
describe("job 92 — formateo §4 sin preflight del caller", () => {
  it("formatAllContratosSectionsInDraft se autoprotege y conserva §5–§7", () => {
    const formatted = formatAllContratosSectionsInDraft(DRAFT_WITH_OPEN_JSON_FENCE);
    assert.ok(String(extractSection5Body(formatted)).includes("backoff exponencial"));
    assert.ok(String(extractSection6Body(formatted)).includes("deny by default"));
    assert.ok(String(extractSection7Body(formatted)).includes("blue/green"));
  });

  it("no reflowa la cola como si fuese cuerpo de §4", () => {
    const formatted = formatAllContratosSectionsInDraft(DRAFT_WITH_OPEN_JSON_FENCE);
    // §6 completa (no los 145 chars truncados del job 92).
    assert.ok((extractSection6Body(formatted)?.length ?? 0) >= 200);
  });

  it("normalizeMddFormat conserva §5–§7 con fence §4 abierto", () => {
    const normalized = normalizeMddFormat(DRAFT_WITH_OPEN_JSON_FENCE);
    assert.ok(String(extractSection5Body(normalized)).includes("backoff exponencial"));
    assert.ok(String(extractSection6Body(normalized)).includes("deny by default"));
    assert.ok((extractSection6Body(normalized)?.length ?? 0) >= 200);
    assert.ok(String(extractSection7Body(normalized)).includes("blue/green"));
  });

  it("normalizeMddFormat + guard no marca secciones perdidas (el gate no tumba el job)", () => {
    const baseline = closeUnclosedFencesBeforeCanonicalH2(DRAFT_WITH_OPEN_JSON_FENCE);
    const guard = guardValidatedSectionsForPersist(
      baseline,
      normalizeMddFormat(DRAFT_WITH_OPEN_JSON_FENCE),
      "test-job92",
      { sections: [5, 6, 7] },
    );
    assert.deepEqual(guard.failedSections, []);
  });

  it("aborta el formateo si un cuerpo de §4 aún abarca §5–§7", () => {
    // Fence abierto que `closeUnclosedFences…` no puede cerrar: la cola va sin H2 canónico
    // hasta el final, así que la única defensa es el bail-out por heading canónico.
    const draft = [
      "## 4. Contratos de API",
      "",
      "```json",
      '{ "a": 1 }',
      "",
      "## 5. Lógica y Edge Cases",
      "",
      S5_BODY,
    ].join("\n");
    const formatted = formatAllContratosSectionsInDraft(draft);
    assert.ok(String(extractSection5Body(formatted)).includes("backoff exponencial"));
  });
});

/**
 * Job 92, segunda causa (independiente del fence): la primera viñeta de §6 quedaba pegada
 * al H2, `extractSection` la tomaba como parte del heading y al reensamblar desaparecía.
 * §6 caía por debajo del mínimo de 200 chars y el gate tumbaba el job.
 */
describe("job 92 — viñeta pegada al H2 canónico", () => {
  const DRAFT_GLUED = [
    "# Master Design Document",
    "",
    "## 5. Lógica y Edge Cases",
    "",
    S5_BODY,
    "",
    "## 6. Seguridad",
    "",
    S6_BODY,
    "",
    "## 7. Infraestructura",
    "",
    S7_BODY,
  ].join("\n");

  it("normalizeMddFormat no pega la primera viñeta al heading de §6", () => {
    const normalized = normalizeMddFormat(DRAFT_GLUED);
    assert.ok(!/6\.\s*Seguridad[ \t]*[-*]/.test(normalized));
    assert.ok(String(extractSection6Body(normalized)).includes("Autenticación LDAP/AD"));
  });

  it("§6 conserva las tres viñetas (no cae bajo el mínimo del gate)", () => {
    const body = extractSection6Body(normalizeMddFormat(DRAFT_GLUED)) ?? "";
    assert.equal((body.match(/^-\s/gm) ?? []).length, 3);
    assert.ok(body.length >= 200);
  });

  it("fixGluedSection6Heading separa la viñeta pegada como cuerpo, no como ###", () => {
    const fixed = fixGluedSection6Heading("## 6. Seguridad- Autenticación LDAP/AD corporativo.");
    assert.ok(fixed.includes("## 6. Seguridad\n\n- Autenticación LDAP/AD corporativo."));
    assert.ok(!fixed.includes("### - "));
  });

  it("no toca un heading canónico ya bien formado", () => {
    const ok = "## 6. Seguridad\n\n- Autenticación LDAP/AD corporativo.";
    assert.equal(fixGluedSection6Heading(ok), ok);
  });

  it("no parte títulos de sección que contienen guiones legítimos", () => {
    const ok = "## 7. Infraestructura\n\nDespliegue blue/green con roll-back automático.";
    assert.equal(fixGluedSection6Heading(ok), ok);
  });
});

/**
 * Job 96: dos mecanismos de explosión (89k→329k→1M) en dedupe/reorder:
 * 1. Un fence impar en §4 hacía que el cuerpo extraído de una sección "tragase" las
 *    siguientes; el reorder elige el candidato más largo, así que el cuerpo corrupto
 *    ganaba y las secciones tragadas quedaban duplicadas — crecimiento geométrico.
 * 2. `formatAllContratosSectionsInDraft` podía DEJAR paridad impar tras reflow de JSON
 *    (§5 4920→0 aunque el preflight de entrada cerrase fences).
 */
describe("job 96 — candidatos que tragan secciones no explotan el documento", () => {
  const S5_REAL = `### 5.1 Reglas de negocio\n\n${"Control dual de export con doble aprobador. ".repeat(20)}`;

  /** Doc con §5 corta (placeholder) arriba y §5 real después de un §4 con fence abierto. */
  const DRAFT_SWALLOW = [
    "# Master Design Document",
    "",
    "## 4. Contratos de API",
    "",
    "### POST /api/v1/keys",
    "",
    "```json",
    '{ "alias": "kms-key" }',
    "",
    "## 5. Lógica y Edge Cases",
    "",
    S5_REAL,
    "",
    "## 6. Seguridad",
    "",
    S6_BODY,
    "",
    "## 7. Infraestructura",
    "",
    S7_BODY,
  ].join("\n");

  it("deduplicateAndReorderMddSections no infla el documento con fence §4 abierto", () => {
    const out = deduplicateAndReorderMddSections(DRAFT_SWALLOW);
    // Invariante del job 96: dedupe nunca puede crecer el doc más de un margen de reensamblado.
    assert.ok(
      out.length <= DRAFT_SWALLOW.length * 1.2,
      `dedupe infló ${DRAFT_SWALLOW.length}→${out.length}`,
    );
  });

  it("cada sección queda exactamente una vez tras el dedupe", () => {
    const out = deduplicateAndReorderMddSections(DRAFT_SWALLOW);
    for (const n of [4, 5, 6, 7]) {
      const re = new RegExp(`^##\\s+${n}\\.\\s`, "gm");
      const count = (out.match(re) ?? []).length;
      assert.equal(count, 1, `§${n} aparece ${count} veces`);
    }
  });

  it("§5/§6/§7 conservan su contenido real (no el placeholder ni copia tragada)", () => {
    const out = deduplicateAndReorderMddSections(DRAFT_SWALLOW);
    assert.ok(String(extractSection5Body(out)).includes("Control dual de export"));
    assert.ok(String(extractSection6Body(out)).includes("deny by default"));
    assert.ok(String(extractSection7Body(out)).includes("blue/green"));
  });

  it("dedupe es idempotente: segunda pasada no cambia el resultado", () => {
    const once = deduplicateAndReorderMddSections(DRAFT_SWALLOW);
    const twice = deduplicateAndReorderMddSections(once);
    assert.ok(
      Math.abs(twice.length - once.length) < 50,
      `no idempotente: ${once.length}→${twice.length}`,
    );
  });

  it("formatAllContratosSectionsInDraft nunca deja paridad ``` impar", () => {
    // Cuerpo §4 con JSON inline largo (reflow a bloque) + fence suelto en tabla.
    const tricky = [
      "# Master Design Document",
      "",
      "## 4. Contratos de API",
      "",
      "| Método | Ruta |",
      "|---|---|",
      "| POST | /v1/keys |",
      "",
      '**Request:** { "alias": "kms-key-prod", "type": "AES-256", "rotationDays": 90 }',
      "",
      "```",
      "",
      "## 5. Lógica y Edge Cases",
      "",
      S5_REAL,
    ].join("\n");
    const out = formatAllContratosSectionsInDraft(tricky);
    assert.equal((out.match(/```/g) ?? []).length % 2, 0, "paridad impar en salida");
    assert.ok(String(extractSection5Body(out)).includes("Control dual de export"));
  });
});

/**
 * Job 96: título + `---` + heading §1 + cuerpo colapsados en UNA línea. El extractor
 * estricto devolvía null, todo el pipeline medía §1=0 y SectionPreserve la daba por
 * perdida sin poder restaurarla nunca ("§1 insustancial (0 chars)" en cada nodo).
 */
describe("job 96 — §1 con heading y cuerpo en la misma línea", () => {
  const GLUED =
    "# Master Design Document --- ## 1. Contexto y alcance ### Propósito del sistema Entidades de negocio del KMS corporativo con detalle suficiente\n\n## 2. Arquitectura y Stack\n\nNestJS.";

  it("extractContextSectionBody mide el cuerpo aunque esté pegado al heading", () => {
    const body = extractContextSectionBody(GLUED);
    assert.ok((body?.length ?? 0) > 50, `body=${body?.length}`);
    assert.ok(String(body).includes("Propósito del sistema"));
  });

  it("no rompe la extracción normal multilínea", () => {
    const normal = "# MDD\n\n## 1. Contexto\n\nCuerpo normal multilínea.\n\n## 2. Arquitectura y Stack\n\nalgo";
    assert.equal(extractContextSectionBody(normal), "Cuerpo normal multilínea.");
  });

  it("replaceContextSectionBody puede reparar la §1 pegada preservando §2", () => {
    const replaced = replaceContextSectionBody(
      GLUED,
      "Nuevo cuerpo §1 redactado con longitud suficiente para el guard de reemplazo de sección.",
    );
    assert.ok(replaced.includes("Nuevo cuerpo §1"));
    assert.ok(replaced.includes("## 2. Arquitectura y Stack"));
  });
});

describe("guardValidatedSectionsForPersist con fence abierto", () => {
  it("no reporta §5 perdida cuando solo faltaba cerrar el fence", () => {
    const baseline = closeUnclosedFencesBeforeCanonicalH2(DRAFT_WITH_OPEN_JSON_FENCE);
    const guard = guardValidatedSectionsForPersist(
      baseline,
      DRAFT_WITH_OPEN_JSON_FENCE,
      "test",
      { sections: [5, 6, 7] },
    );
    assert.deepEqual(guard.failedSections, []);
    assert.ok(String(extractSection5Body(guard.markdown)).includes("backoff exponencial"));
  });
});

describe("extractSection7Body", () => {
  it("devuelve el cuerpo completo, no solo el texto previo al primer subheading", () => {
    const draft = ["## 7. Infraestructura", "", S7_BODY].join("\n");
    const body = extractSection7Body(draft);
    assert.ok(String(body).includes("7.1 Flujo"));
    assert.ok(String(body).includes("blue/green"));
  });
});

/**
 * Job 98: PrepareOutput gate ok=100 pero persist (formatForPersist) falló con
 * «Documento truncado: fence ``` sin cerrar al final» tras varias pasadas de
 * formatAllContratosSectionsInDraft / prepareMddMarkdownForPersist.
 */
describe("job 98 — fence abierto al EOF tras persist", () => {
  const DRAFT_EOF_OPEN_FENCE = [
    "# Master Design Document",
    "",
    "## 4. Contratos de API",
    "",
    "### POST /api/v1/keys",
    "",
    "**Request body:**",
    "",
    "```json",
    '{ "alias": "kms-key-prod" }',
    "",
    "## 5. Lógica y Edge Cases",
    "",
    S5_BODY,
    "",
    "## 6. Seguridad",
    "",
    S6_BODY,
    "",
    "## 7. Infraestructura",
    "",
    "### Manifest de Infraestructura",
    "",
    "```json",
    '{ "stack": ["node", "postgres"] }',
  ].join("\n");

  it("closeTrailingUnclosedFences cierra paridad impar al final", () => {
    const open = "# MDD\n\n```json\n{}\n";
    const fixed = closeTrailingUnclosedFences(open);
    assert.equal((fixed.match(/```/g) ?? []).length % 2, 0);
    assert.strictEqual(detectTruncatedMddTail(fixed), null);
  });

  it("ensureDocumentFenceParity cierra §4 abierto y EOF en un solo paso", () => {
    const fixed = ensureDocumentFenceParity(DRAFT_EOF_OPEN_FENCE);
    assert.equal((fixed.match(/```/g) ?? []).length % 2, 0);
    assert.strictEqual(detectTruncatedMddTail(fixed), null);
    assert.ok(String(extractSection5Body(fixed)).includes("backoff exponencial"));
  });

  it("formatAllContratosSectionsInDraft deja paridad par al EOF", () => {
    const out = formatAllContratosSectionsInDraft(DRAFT_EOF_OPEN_FENCE);
    assert.equal((out.match(/```/g) ?? []).length % 2, 0);
    assert.strictEqual(detectTruncatedMddTail(out), null);
  });

  it("prepareMddMarkdownForPersist no deja fence sin cerrar al final", () => {
    const out = prepareMddMarkdownForPersist(DRAFT_EOF_OPEN_FENCE);
    assert.equal((out.match(/```/g) ?? []).length % 2, 0);
    assert.strictEqual(detectTruncatedMddTail(out), null);
  });

  it("normalizeMddFormat cierra fence al EOF tras formatear §4", () => {
    const out = normalizeMddFormat(DRAFT_EOF_OPEN_FENCE);
    assert.equal((out.match(/```/g) ?? []).length % 2, 0);
    assert.strictEqual(detectTruncatedMddTail(out), null);
  });

  it("idempotencia: segunda pasada de ensureDocumentFenceParity no cambia", () => {
    const once = ensureDocumentFenceParity(DRAFT_EOF_OPEN_FENCE);
    assert.equal(ensureDocumentFenceParity(once), once);
  });
});
