import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mergeMddForOrchestratorPersist } from "./orchestrator-mdd-persist.util.js";

const fullMdd = `# MDD

## 1. Contexto
Contenido largo §1 que no debe perderse al persistir desde chat.

## 2. Arquitectura
NestJS

## 3. Modelo de Datos
CREATE TABLE users (id uuid);

## 4. Contratos de API
GET /health

## 5. Lógica
Reglas

## 6. Seguridad
JWT

## 7. Infraestructura
Docker`;

describe("mergeMddForOrchestratorPersist", () => {
  it("preserva §2–§7 cuando incoming solo trae §1 truncado", () => {
    const incoming = `# MDD

## 1. Contexto
Nuevo contexto desde chat LLM.`;
    const { content, defensiveMerge } = mergeMddForOrchestratorPersist(fullMdd, incoming);
    assert.equal(defensiveMerge, true);
    assert.match(content, /## 2\. Arquitectura/);
    assert.match(content, /CREATE TABLE users/);
    assert.match(content, /Nuevo contexto desde chat/);
  });

  it("first-write acepta incoming completo sin existing", () => {
    const { content, stats } = mergeMddForOrchestratorPersist("", fullMdd);
    assert.equal(stats.mode, "first-write");
    assert.match(content, /CREATE TABLE users/);
  });
});
