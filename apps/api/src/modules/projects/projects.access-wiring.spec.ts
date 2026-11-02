/**
 * Cableado de autorización de las rutas críticas: verifica con la metadata real de Nest el nivel de
 * `@ProjectScoped` (o la exención) de los handlers que mueven dinero, borran o exponen datos.
 */
import "reflect-metadata";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  PROJECT_ACCESS_EXEMPT_KEY,
  PROJECT_SCOPED_KEY,
  type ProjectScopedSpec,
} from "../../common/access/project-scoped.decorator.js";
import { SessionsController } from "../sessions/sessions.controller.js";
import { ProjectIntegrationController } from "./integration/project-integration.controller.js";
import { ProjectsController } from "./projects.controller.js";

function specsOf(cls: { prototype: object }, method: string): ProjectScopedSpec[] | undefined {
  const handler = (cls.prototype as Record<string, unknown>)[method];
  assert.equal(typeof handler, "function", `handler inexistente: ${method}`);
  return Reflect.getMetadata(PROJECT_SCOPED_KEY, handler as object) as ProjectScopedSpec[] | undefined;
}

function oneSpec(cls: { prototype: object }, method: string): ProjectScopedSpec {
  const specs = specsOf(cls, method);
  assert.ok(specs && specs.length === 1, `${method} debe tener exactamente un @ProjectScoped`);
  return specs[0]!;
}

function exemptReason(cls: { prototype: object }, method: string): string | undefined {
  const handler = (cls.prototype as Record<string, unknown>)[method] as object;
  return Reflect.getMetadata(PROJECT_ACCESS_EXEMPT_KEY, handler) as string | undefined;
}

describe("ProjectsController: nivel de acceso por handler", () => {
  it("DELETE :id exige manage y admite admin", () => {
    const spec = oneSpec(ProjectsController, "remove");
    assert.equal(spec.level, "manage");
    assert.equal(spec.allowAdmin, true);
  });

  it("clear-mdd-deliverables exige manage sin admin", () => {
    const spec = oneSpec(ProjectsController, "clearMddDependentDeliverables");
    assert.equal(spec.level, "manage");
    assert.notEqual(spec.allowAdmin, true);
  });

  it("generate-spec, generate-deliverables, phase0-deep-research y converge exigen spend", () => {
    for (const method of ["generateSpec", "generateDeliverablesCascade", "phase0DeepResearch", "converge"]) {
      assert.equal(oneSpec(ProjectsController, method).level, "spend", method);
    }
  });

  it("PATCH :id exige contribute", () => {
    assert.equal(oneSpec(ProjectsController, "update").level, "contribute");
  });

  it("GET :id y clone exigen read sobre el proyecto :id", () => {
    for (const method of ["findOne", "cloneProject"]) {
      const spec = oneSpec(ProjectsController, method);
      assert.equal(spec.level, "read", method);
      assert.equal(spec.key ?? "id", "id", method);
      assert.equal(spec.from ?? "param", "param", method);
    }
  });

  it("las rutas con :projectId + :stageId verifican la etapa del proyecto", () => {
    for (const [method, level] of [
      ["getStageDetail", "read"],
      ["patchStage", "contribute"],
    ] as const) {
      const spec = oneSpec(ProjectsController, method);
      assert.equal(spec.level, level, method);
      assert.equal(spec.key, "projectId", method);
      assert.equal(spec.stage?.key, "stageId", method);
    }
  });

  it("los jobs por proyecto se autorizan con read en la ruta (la decisión fina va en assertJobAccess)", () => {
    for (const method of ["deliverablesJobStatus", "deliverablesJobStream", "mddJobStatus", "cancelMddJob", "cancelDeliverablesJob"]) {
      assert.equal(oneSpec(ProjectsController, method).level, "read", method);
    }
  });

  it("las rutas sin proyecto en la ruta quedan exentas con motivo y sin @ProjectScoped", () => {
    for (const method of ["jobStatus", "cancelJob", "mergeProjects", "create", "findAll", "generationSummary", "importNotionProject"]) {
      assert.equal(specsOf(ProjectsController, method), undefined, `${method} no debe llevar @ProjectScoped`);
      assert.ok((exemptReason(ProjectsController, method) ?? "").trim().length > 0, `${method} sin motivo de exención`);
    }
  });
});

describe("ProjectIntegrationController: nivel de acceso por handler", () => {
  it("lecturas con read y escrituras con contribute, todas sobre :projectId", () => {
    for (const [method, level] of [
      ["getStatus", "read"],
      ["listTraces", "read"],
      ["patchLink", "contribute"],
      ["sendHandoff", "contribute"],
    ] as const) {
      const spec = oneSpec(ProjectIntegrationController, method);
      assert.equal(spec.level, level, method);
      assert.equal(spec.key, "projectId", method);
    }
  });

  it("las rutas que disparan LLM exigen spend y verifican la etapa", () => {
    const spec = oneSpec(ProjectIntegrationController, "reconcileHandoff");
    assert.equal(spec.level, "spend");
    assert.equal(spec.stage?.key, "stageId");
  });
});

describe("SessionsController: nivel de acceso por handler", () => {
  it("POST /sessions toma el proyecto del body con contribute", () => {
    const spec = oneSpec(SessionsController, "create");
    assert.equal(spec.from, "body");
    assert.equal(spec.key, "projectId");
    assert.equal(spec.level, "contribute");
  });

  it("salvage-dbga exige spend y GET por proyecto read", () => {
    assert.equal(oneSpec(SessionsController, "salvageDbgaFromChat").level, "spend");
    assert.equal(oneSpec(SessionsController, "findByProject").level, "read");
  });

  it("las rutas :id de sesión no llevan @ProjectScoped y se exentan con motivo (autorizan en el handler)", () => {
    for (const method of ["findOne", "appendMessage", "chat", "updateContextStep"]) {
      assert.equal(specsOf(SessionsController, method), undefined, `${method} no debe llevar @ProjectScoped`);
      assert.ok((exemptReason(SessionsController, method) ?? "").trim().length > 0, `${method} sin motivo de exención`);
    }
  });
});
