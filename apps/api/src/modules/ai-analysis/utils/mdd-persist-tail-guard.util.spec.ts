import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { evaluateMddPersistTailGuard } from "./mdd-persist-tail-guard.util.js";

const S5_BODY = `- **Login**: JWT tras credenciales válidas.
- **Refresh**: rotación de refresh token.
- **Concurrencia**: idempotencia en escrituras.
${"Detalle adicional de reglas de negocio. ".repeat(12)}`;

const BASE = `# MDD
## 1. Contexto
${"Alcance del sistema. ".repeat(40)}
## 2. Arquitectura y Stack
NestJS + React
## 3. Modelo de Datos
CREATE TABLE users (id uuid primary key);
## 4. Contratos de API
GET /health
## 5. Lógica y Edge Cases
${S5_BODY}
## 6. Seguridad
JWT RS256
## 7. Infraestructura
Docker`;

describe("evaluateMddPersistTailGuard", () => {
  it("permite persist cuando el tail se conserva", () => {
    const result = evaluateMddPersistTailGuard(BASE, BASE);
    assert.equal(result.errorMessage, undefined);
    assert.deepEqual(result.failedSections, []);
  });

  it("restaura §5 y no bloquea si el wipe se corrige", () => {
    const wiped = BASE.replace(S5_BODY, "stub");
    const result = evaluateMddPersistTailGuard(BASE, wiped);
    assert.equal(result.errorMessage, undefined);
    assert.ok(result.restored);
    assert.ok(result.markdown.includes("idempotencia"));
  });

  it("no marca error si §1 post-prepare es insustancial (guard delega regeneración completa)", () => {
    const corruptPost = `## 1. Contexto\n\n(stub)\n\n## 2. Arquitectura\n\nsolo fragmento`;
    const result = evaluateMddPersistTailGuard(BASE, corruptPost);
    assert.equal(result.errorMessage, undefined);
    assert.deepEqual(result.failedSections, []);
  });
});
