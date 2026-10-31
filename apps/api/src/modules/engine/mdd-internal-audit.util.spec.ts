import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  computeContractGaps,
  computeTraceabilityGaps,
  detectContextIntegrationContradiction,
  mentionsMfaAffirmatively,
} from "./mdd-internal-audit.util.js";

function mdd(parts: { s1?: string; s2?: string; s4?: string; s5?: string; s6?: string; s7?: string; s3?: string }): string {
  return [
    `## 1. Contexto y alcance\n\n${parts.s1 ?? "Sistema de gestión."}`,
    `## 2. Arquitectura y Stack\n\n${parts.s2 ?? "Backend NestJS (Node.js) con PostgreSQL y frontend React para el portal interno."}`,
    `## 3. Modelo de Datos\n\n${parts.s3 ?? "```sql\nCREATE TABLE users (id UUID PRIMARY KEY);\n```"}`,
    `## 4. Contratos de API\n\n${parts.s4 ?? "POST /api/login"}`,
    `## 5. Lógica y Edge Cases\n\n${parts.s5 ?? "Flujo estándar."}`,
    `## 6. Seguridad\n\n${parts.s6 ?? "Hash de contraseñas."}`,
    `## 7. Infraestructura\n\n${parts.s7 ?? "Dockerfile con FROM node:20 y docker compose."}`,
  ].join("\n\n");
}

describe("mentionsMfaAffirmatively (negación)", () => {
  it("ignora 'no se implementa MFA en v1' y 'sin 2FA'", () => {
    assert.equal(mentionsMfaAffirmatively("En esta fase no se implementa MFA en v1."), false);
    assert.equal(mentionsMfaAffirmatively("Acceso sin 2FA durante el piloto."), false);
    assert.equal(mentionsMfaAffirmatively("MFA no se implementa en v1."), false);
  });
  it("detecta MFA afirmativo, incluso si una oración previa niega otra cosa", () => {
    assert.equal(mentionsMfaAffirmatively("Se exige MFA con TOTP para administradores."), true);
    assert.equal(mentionsMfaAffirmatively("No hay SSO. MFA obligatorio para admins."), true);
  });
});

describe("computeTraceabilityGaps MFA", () => {
  it("no marca inconsistencia cuando el contexto niega MFA", () => {
    const g = computeTraceabilityGaps(mdd({ s1: "Alcance v1: no se implementa MFA en v1, sólo password." }));
    assert.deepEqual([...g.inconsistentSections], []);
  });
  it("marca inconsistencia cuando MFA afirmativo no tiene soporte", () => {
    const g = computeTraceabilityGaps(mdd({ s1: "Se exige MFA para todos los usuarios." }));
    assert.ok(g.inconsistentSections.length > 0);
  });
  it("acepta passkeys / WebAuthn / FIDO2 como soporte de MFA en §6", () => {
    const g = computeTraceabilityGaps(
      mdd({ s1: "Se exige MFA para todos los usuarios.", s6: "MFA mediante passkeys WebAuthn (FIDO2) sin secretos TOTP." }),
    );
    assert.deepEqual([...g.inconsistentSections], []);
  });
});

describe("computeContractGaps", () => {
  it("serverless en §7 refleja Node (sin Dockerfile) -> sin infraStackGap", () => {
    for (const infra of ["Despliegue en AWS Lambda.", "Vercel con funciones serverless.", "Google Cloud Run gestionado."]) {
      assert.equal(computeContractGaps(mdd({ s7: infra })).infraStackGap, 0, infra);
    }
  });
  it("§2 Node y §7 sin ninguna señal de Node/contenedor/serverless -> infraStackGap", () => {
    assert.equal(computeContractGaps(mdd({ s7: "Servidor físico en oficina con respaldo semanal." })).infraStackGap, 1);
  });
  it("números en palabra cuentan como intentos definidos", () => {
    const base = { s5: "Bloqueo de cuenta tras intentos fallidos." };
    assert.equal(computeContractGaps(mdd({ ...base, s6: "Bloqueo tras cinco intentos fallidos." })).securityEdgeCaseGap, 0);
    assert.equal(computeContractGaps(mdd({ ...base, s6: "Máximo de tres intentos." })).securityEdgeCaseGap, 0);
    assert.equal(computeContractGaps(mdd({ ...base, s6: "Bloqueo tras 5 intentos." })).securityEdgeCaseGap, 0);
    assert.equal(computeContractGaps(mdd({ ...base, s6: "Se bloquea la cuenta si hay demasiados fallos." })).securityEdgeCaseGap, 1);
  });
});

describe("detectContextIntegrationContradiction", () => {
  it("delegar en un IdP externo no es contradicción", () => {
    assert.equal(
      detectContextIntegrationContradiction(
        "no se implementará oauth propio; se delega en keycloak.",
        "keycloak como proveedor oidc con realm dedicado.",
      ),
      false,
    );
  });
  it("negar OAuth en §1 y afirmarlo en §7 sin delegar sí es contradicción", () => {
    assert.equal(
      detectContextIntegrationContradiction(
        "no se implementará oauth en esta versión.",
        "se configura oauth 2.0 con el servidor de autorización.",
      ),
      true,
    );
  });
  it("exige la misma oración: otra oración con 'delega' no exime", () => {
    assert.equal(
      detectContextIntegrationContradiction(
        "no se implementará oauth. la facturación se delega en un proveedor externo.",
        "oauth 2.0 habilitado.",
      ),
      true,
    );
  });
});
