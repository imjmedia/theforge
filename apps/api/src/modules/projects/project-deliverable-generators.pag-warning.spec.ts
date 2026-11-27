import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ProjectDeliverableGeneratorsService } from "./project-deliverable-generators.service.js";

type WarnFn = (
  projectId: string,
  field: "logicFlowsContent" | "infraContent",
  label: string,
  pag: { endpoints?: unknown[] } | null | undefined,
) => Promise<void>;

/** Crea el servicio sin DI, con logger y changeLog espías. */
function makeSvc() {
  const warns: string[] = [];
  const logs: Array<{ projectId: string; field: string; text: string }> = [];
  const historial: Array<{ field: string; summary: string }> = [];
  const svc = Object.create(ProjectDeliverableGeneratorsService.prototype) as ProjectDeliverableGeneratorsService;
  Object.assign(svc, {
    logger: { warn: (m: string) => warns.push(m) },
    changeLog: {
      log: async (projectId: string, field: string, text: string) => {
        logs.push({ projectId, field, text });
        historial.unshift({ field, summary: `Actualizó ${field}: ${text}` });
      },
      listByProject: async () => historial,
    },
  });
  const warn = (svc as unknown as { warnIfPagWithoutEndpoints: WarnFn }).warnIfPagWithoutEndpoints.bind(svc);
  return { warn, warns, logs, historial };
}

describe("ProjectDeliverableGeneratorsService — aviso PAG sin endpoints", () => {
  it("con PAG endpoints: [] registra warn y changeLog (Flujos)", async () => {
    const { warn, warns, logs } = makeSvc();
    await warn("p1", "logicFlowsContent", "Flujos", { endpoints: [] });
    assert.equal(warns.length, 1);
    assert.match(warns[0]!, /PAG sin endpoints/);
    assert.equal(logs.length, 1);
    assert.equal(logs[0]!.field, "logicFlowsContent");
    assert.match(logs[0]!.text, /regenera Contratos API/);
  });

  it("Infra registra el aviso como JSON tipado", async () => {
    const { warn, logs } = makeSvc();
    await warn("p1", "infraContent", "Infra", { endpoints: [] });
    assert.equal(JSON.parse(logs[0]!.text).type, "pag-sin-endpoints");
  });

  it("con endpoints, sin PAG o PAG nulo no avisa", async () => {
    const { warn, warns, logs } = makeSvc();
    await warn("p1", "infraContent", "Infra", { endpoints: [{}] });
    await warn("p1", "infraContent", "Infra", null);
    await warn("p1", "infraContent", "Infra", undefined);
    assert.equal(warns.length, 0);
    assert.equal(logs.length, 0);
  });

  it("deduplica el changeLog: la segunda invocación consecutiva no añade fila", async () => {
    const { warn, warns, logs } = makeSvc();
    await warn("p1", "logicFlowsContent", "Flujos", { endpoints: [] });
    await warn("p1", "logicFlowsContent", "Flujos", { endpoints: [] });
    assert.equal(warns.length, 2);
    assert.equal(logs.length, 1);
  });

  it("no re-registra aunque el persist añada «Actualizó …» del mismo campo entre medias", async () => {
    const { warn, logs, historial } = makeSvc();
    await warn("p1", "infraContent", "Infra", { endpoints: [] });
    historial.unshift({ field: "infraContent", summary: "Actualizó Infraestructura: # Infra" });
    await warn("p1", "infraContent", "Infra", { endpoints: [] });
    assert.equal(logs.length, 1);
  });

  it("registra de nuevo si el aviso ya salió de la ventana de entradas recientes", async () => {
    const { warn, logs, historial } = makeSvc();
    await warn("p1", "infraContent", "Infra", { endpoints: [] });
    historial.length = 0;
    await warn("p1", "infraContent", "Infra", { endpoints: [] });
    assert.equal(logs.length, 2);
  });

  it("la dedupe es por campo", async () => {
    const { warn, logs } = makeSvc();
    await warn("p1", "logicFlowsContent", "Flujos", { endpoints: [] });
    await warn("p1", "infraContent", "Infra", { endpoints: [] });
    assert.equal(logs.length, 2);
  });
});
