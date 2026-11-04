import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ProjectTypeEnum } from "@theforge/shared-types";
import {
  getProjectModeBadge,
  isProjectApproachEditable,
  isUxFirstWizardOptionVisible,
} from "./project-mode-labels.js";

describe("project-mode-labels", () => {
  it("UX_FIRST oculto en el wizard", () => {
    assert.equal(isUxFirstWizardOptionVisible(), false);
  });

  it("DESIGN_FIRST visible con etiqueta propia", () => {
    const badge = getProjectModeBadge(ProjectTypeEnum.enum.DESIGN_FIRST, "DOMAIN_FIRST");
    assert.match(badge.label, /Design-First/);
    assert.equal(badge.tone, "design-first");
  });

  it("proyecto UX_FIRST existente conserva etiqueta", () => {
    const badge = getProjectModeBadge(ProjectTypeEnum.enum.NEW, "UX_FIRST");
    assert.equal(badge.label, "UX-First");
    assert.equal(badge.tone, "ux-first");
  });

  it("Design-First fija el enfoque (solo lectura en ajustes)", () => {
    assert.equal(isProjectApproachEditable(ProjectTypeEnum.enum.DESIGN_FIRST), false);
    assert.equal(isProjectApproachEditable(ProjectTypeEnum.enum.NEW), true);
  });
});
