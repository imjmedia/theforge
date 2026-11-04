import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { BadRequestException } from "@nestjs/common";
import { ProjectDeliverableGeneratorsService } from "./project-deliverable-generators.service.js";

describe("ProjectDeliverableGeneratorsService — Design-First api_contracts", () => {
  it("generateApiContractsFromPag persiste markdown compilado sin LLM", async () => {
    const pag = {
      version: "1.0.0",
      projectName: "DF",
      entities: [
        {
          name: "Order",
          tableName: "orders",
          fields: [{ name: "id", type: "UUID", required: true, constraints: [] }],
          primaryKey: "id",
          indexes: [],
        },
      ],
      endpoints: [
        {
          path: "/api/v1/orders",
          method: "GET",
          authRequired: false,
          rolesAllowed: [],
          errorCodes: [400],
          targetEntity: "Order",
        },
      ],
      services: [],
    };

    let persisted: string | undefined;
    const svc = Object.create(ProjectDeliverableGeneratorsService.prototype) as ProjectDeliverableGeneratorsService;
    (svc as unknown as { throwIfAborted: () => void }).throwIfAborted = () => undefined;
    (svc as unknown as { logger: { log: () => void } }).logger = { log: () => undefined };
    (svc as unknown as { notifyPluginAfterDocumentPersist: () => void }).notifyPluginAfterDocumentPersist =
      () => undefined;
    (svc as unknown as { projects: { update: (id: string, data: { apiContractsContent: string }) => Promise<unknown> } }).projects =
      {
        update: async (_id, data) => {
          persisted = data.apiContractsContent;
          return { apiContractsContent: data.apiContractsContent };
        },
      };

    const project = {
      id: "p1",
      stages: [{ id: "s1", ordinal: 1, architectureGraph: pag }],
    } as never;

    await (
      svc as unknown as {
        generateApiContractsFromPag: (p: unknown, s?: AbortSignal) => Promise<unknown>;
      }
    ).generateApiContractsFromPag(project, undefined);

    assert.ok(persisted);
    assert.match(persisted!, /Contratos de API/);
  });

  it("generateApiContractsFromPag sin PAG lanza BadRequestException", async () => {
    const svc = Object.create(ProjectDeliverableGeneratorsService.prototype) as ProjectDeliverableGeneratorsService;
    (svc as unknown as { throwIfAborted: () => void }).throwIfAborted = () => undefined;

    const project = {
      id: "p1",
      stages: [{ id: "s1", ordinal: 1, architectureGraph: null }],
    } as never;

    await assert.rejects(
      () =>
        (
          svc as unknown as {
            generateApiContractsFromPag: (p: unknown) => Promise<unknown>;
          }
        ).generateApiContractsFromPag(project),
      BadRequestException,
    );
  });
});
