/**
 * Polling de jobs legacy (deliverables y MDD): el job debe pertenecer al proyecto de la ruta.
 * Inexistente o de otro proyecto => 404 "Job no encontrado" (nunca 403).
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { NotFoundException } from "@nestjs/common";
import { LegacyFlowController } from "./legacy-flow.controller.js";

type Ref = { projectId: string; userId: string | null } | null;

function makeController(opts: { ref: Ref; statusProjectId?: string; mddStatus?: string }) {
  const calls = { ref: [] as string[], status: [] as string[] };
  const status = { jobId: "j1", projectId: opts.statusProjectId ?? "p1", status: opts.mddStatus ?? "completed" };
  const deliverablesQueue = {
    getJobAccessRef: async (id: string) => {
      calls.ref.push(id);
      return opts.ref;
    },
    getJobStatus: async (id: string) => {
      calls.status.push(id);
      return status;
    },
  };
  const mddQueue = {
    getJobAccessRef: async (id: string) => {
      calls.ref.push(id);
      return opts.ref;
    },
    getJobStatus: async (id: string) => {
      calls.status.push(id);
      return status;
    },
  };
  const controller = new LegacyFlowController(
    {} as never,
    deliverablesQueue as never,
    mddQueue as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );
  return { controller, calls, status };
}

async function rejectsJobNotFound(p: Promise<unknown>) {
  await assert.rejects(p, (e: unknown) => {
    assert.ok(e instanceof NotFoundException, `esperaba 404, llegó ${String(e)}`);
    assert.equal((e as NotFoundException).message, "Job no encontrado");
    return true;
  });
}

const ROUTES = [
  ["deliverables-jobs", "getLegacyDeliverablesJobStatus"],
  ["mdd-jobs", "getLegacyMddJobStatus"],
] as const;

for (const [route, method] of ROUTES) {
  describe(`GET legacy/${route}/:jobId`, () => {
    it("job de otro proyecto => 404 sin leer el estado", async () => {
      const { controller, calls } = makeController({ ref: { projectId: "p-otro", userId: "u2" } });
      await rejectsJobNotFound(controller[method]("p1", "j1"));
      assert.deepEqual(calls.status, []);
    });

    it("ref null (inexistente) => 404 sin leer el estado", async () => {
      const { controller, calls } = makeController({ ref: null });
      await rejectsJobNotFound(controller[method]("p1", "j1"));
      assert.deepEqual(calls.ref, ["j1"]);
      assert.deepEqual(calls.status, []);
    });

    it("job del mismo proyecto => devuelve el estado", async () => {
      const { controller, calls, status } = makeController({ ref: { projectId: "p1", userId: "u1" } });
      assert.deepEqual(await controller[method]("p1", "j1"), status);
      assert.deepEqual(calls.status, ["j1"]);
    });

    it("job antiguo sin userId (userId null) del mismo proyecto => OK", async () => {
      const { controller, status } = makeController({ ref: { projectId: "p1", userId: null } });
      assert.deepEqual(await controller[method]("p1", "j1"), status);
    });
  });
}

describe("GET legacy/mdd-jobs/:jobId: estado unknown", () => {
  it("si el job desaparece entre la referencia y el estado => 404", async () => {
    const { controller } = makeController({ ref: { projectId: "p1", userId: "u1" }, mddStatus: "unknown" });
    await rejectsJobNotFound(controller.getLegacyMddJobStatus("p1", "j1"));
  });
});
