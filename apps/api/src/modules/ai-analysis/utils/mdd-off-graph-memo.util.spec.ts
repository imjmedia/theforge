import { beforeEach, describe, it } from "node:test";
import assert from "node:assert";
import { mddGraphFingerprint } from "@theforge/shared-types";
import {
  clearMddOffGraphMemoForTests,
  coherenceMemoKey,
  deliveryGateMemoKey,
  getMemoizedCoherenceStatus,
  setMemoizedCoherenceStatus,
  validateMddForDeliveryMemo,
} from "./mdd-off-graph-memo.util.js";

const MIN_MDD = `# MDD

## 1. Contexto

Contexto sustancial del proyecto con más de doscientos caracteres de narrativa de negocio para pasar el gate de sustancia mínima en la sección uno del documento maestro de diseño corporativo KMS demo.

## 2. Arquitectura y Stack

NestJS + React con PostgreSQL y Redis para cache de sesiones y cola BullMQ en despliegue Dokploy con TLS terminado en reverse proxy.

## 3. Modelo de Datos

\`\`\`sql
CREATE TABLE users (
  id UUID PRIMARY KEY,
  email TEXT NOT NULL UNIQUE
);
\`\`\`

## 4. Contratos de API

| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | /health | Health check |

\`\`\`json
{"method":"GET","path":"/health","response":{"status":"ok"}}
\`\`\`

## 5. Lógica y Edge Cases

Reglas de negocio y casos borde documentados con suficiente detalle técnico para validación de sustancia en el pipeline de entrega del MDD de complejidad alta.

## 6. Seguridad

JWT RS256, MFA TOTP, rate limiting en login y auditoría de accesos con retención de logs centralizada.

## 7. Infraestructura

Docker Compose en staging; producción en VPS con backups diarios de PostgreSQL y monitoreo básico de uptime.
`;

describe("mdd-off-graph-memo.util", () => {
  beforeEach(() => {
    clearMddOffGraphMemoForTests();
  });

  it("deliveryGateMemoKey es estable para mismo markdown", () => {
    const a = deliveryGateMemoKey(MIN_MDD);
    const b = deliveryGateMemoKey(MIN_MDD);
    assert.strictEqual(a, b);
    assert.ok(a.includes(mddGraphFingerprint(MIN_MDD)));
  });

  it("validateMddForDeliveryMemo devuelve mismo objeto en cache hit", () => {
    const first = validateMddForDeliveryMemo(MIN_MDD, { mddComplexity: "HIGH" });
    const second = validateMddForDeliveryMemo(MIN_MDD, { mddComplexity: "HIGH" });
    assert.strictEqual(second, first);
  });

  it("coherence memo get/set por fingerprint", () => {
    const key = coherenceMemoKey(MIN_MDD, "ctx-fp");
    assert.strictEqual(getMemoizedCoherenceStatus(key), undefined);
    const status = {
      state: "synced" as const,
      entityCount: 1,
      endpointCount: 1,
      expectedEntities: 1,
      expectedEndpoints: 1,
      orphanEntityCount: 0,
      orphanEndpointCount: 0,
      lastSyncedAt: Date.now(),
    };
    setMemoizedCoherenceStatus(key, status);
    assert.strictEqual(getMemoizedCoherenceStatus(key), status);
  });
});
