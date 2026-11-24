import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { runWithRequestUserAsync } from "../../common/request-user.store.js";
import { AiService } from "./ai.service.js";

const SAMPLE_MDD = `
## 1. Contexto
Sistema de anonimización local de documentos con PII.

## 2. Stack
FastAPI + React + PostgreSQL.

## 3. Modelo de datos
- documents (id, status)

## 4. Contratos API
POST /api/v1/documents
GET /api/v1/documents

## 5. Lógica y Edge Cases
- Detectar PII antes de exportar.

## 6. Seguridad
- RBAC y auditoría.

## 7. Infraestructura
- Docker Compose.
`;

describe("AiService.generateTasks — strict slice mode y prefetch techDocs", () => {
  it("omite checklist global greenfield y restringe alcance cuando tasksSliceMode=true", async () => {
    let capturedPrompt = "";
    let techDocsCalls = 0;

    const dummyFactory = {
      createForUser: () => ({
        generateResponse: async (prompt: string) => {
          capturedPrompt = prompt;
          return "# Tasks\n\n## Backend tasks\n\n- [ ] T-001";
        },
        generateResponseStream: async () => ({ [Symbol.asyncIterator]: async function* () {} }),
        parseChecklist: async () => ({ ok: true, items: [] }),
        generateEmbedding: async () => [],
      }),
      resolveRuntime: async () => ({
        providerId: "openai",
        chatModel: "gpt-4o",
        apiKey: "test",
      }),
      resolveAuditorRuntime: async () => ({
        providerId: "openai",
        chatModel: "gpt-4o",
        apiKey: "test",
      }),
    } as any;

    const dummyTechDocs = {
      buildContextForMdd: async () => {
        techDocsCalls += 1;
        return "SHOULD NOT BE CALLED WHEN PREFETCHED";
      },
      buildContextFromText: async () => null,
    } as any;

    const dummyMermaid = { normalizeMermaid: async (s: string) => s } as any;
    const service = new AiService(dummyFactory, dummyTechDocs, null, dummyMermaid);

    await runWithRequestUserAsync("test-user", () =>
      service.generateTasks(SAMPLE_MDD, null, {
        tasksContractContext: "## Manifiesto de contratos (reducido)\n{}",
        tasksGenerationLayer: "Backend",
        tasksPlanJson: JSON.stringify({
          sections: ["Backend tasks"],
          items: [{ id: "T-001", title: "POST /api/v1/documents", layer: "Backend" }],
        }),
        tasksSliceMode: true,
        techDocsContext: "",
        domainInventory: {
          capabilities: [],
          suggestedEntities: [],
          crudMatrix: [],
          adminSurfaces: [],
          processes: [
            {
              id: "proc-1",
              name: "Subir documento",
              steps: ["Upload", "Scan"],
              entities: ["documents"],
              critical: true,
              brdCapabilityIds: ["cap-1"],
              screenHints: [],
            },
          ],
        },
      }),
    );

    assert.equal(techDocsCalls, 0);
    assert.match(capturedPrompt, /MODO LOTE MAP-REDUCE \(ALCANCE ESTRICTO\)/);
    assert.match(capturedPrompt, /PLAN JSON DE ESTE LOTE/);
    assert.doesNotMatch(capturedPrompt, /CHECKLIST DE COBERTURA/);
    assert.doesNotMatch(capturedPrompt, /inclúyelos igual/);
    assert.doesNotMatch(capturedPrompt, /ProcessInventory journeys/);
  });

  it("resuelve techDocs una vez cuando techDocsContext es undefined y aborta rápido si abortSignal ya fue cancelado", async () => {
    let techDocsCalls = 0;
    const dummyFactory = {
      createForUser: () => ({
        generateResponse: async () => "# Tasks",
        generateResponseStream: async () => ({ [Symbol.asyncIterator]: async function* () {} }),
        parseChecklist: async () => ({ ok: true, items: [] }),
        generateEmbedding: async () => [],
      }),
      resolveRuntime: async () => ({
        providerId: "openai",
        chatModel: "gpt-4o",
        apiKey: "test",
      }),
      resolveAuditorRuntime: async () => ({
        providerId: "openai",
        chatModel: "gpt-4o",
        apiKey: "test",
      }),
    } as any;

    const dummyTechDocs = {
      buildContextForMdd: async () => {
        techDocsCalls += 1;
        return "FastAPI snippet";
      },
    } as any;
    const dummyMermaid = { normalizeMermaid: async (s: string) => s } as any;
    const service = new AiService(dummyFactory, dummyTechDocs, null, dummyMermaid);

    const fetched = await service.resolveTechDocsContext(SAMPLE_MDD, null, {});
    assert.equal(fetched, "FastAPI snippet");
    assert.equal(techDocsCalls, 1);

    const cachedEmpty = await service.resolveTechDocsContext(SAMPLE_MDD, null, {
      techDocsContext: "",
    });
    assert.equal(cachedEmpty, null);
    assert.equal(techDocsCalls, 1);

    const ac = new AbortController();
    ac.abort();
    await assert.rejects(
      () => service.generateTasks(SAMPLE_MDD, null, { abortSignal: ac.signal }),
      /Cancelado/,
    );
    assert.equal(techDocsCalls, 1);
  });
});
