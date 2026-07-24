import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  assistantOfferedUpstreamPropagate,
  buildUpstreamPropagatePatchPlan,
  canPersistChatDocumentEdit,
  isWorkshopFrozenDeliverableTab,
  looksLikeUpstreamPropagateConfirmation,
  workshopFrozenTabUserMessage,
} from "./workshop-doc-policy.js";

describe("workshop-doc-policy", () => {
  it("deniega persist edit_document en tabs congelados", () => {
    assert.equal(canPersistChatDocumentEdit("spec", "edit_document"), false);
    assert.equal(canPersistChatDocumentEdit("blueprint", "edit_document"), false);
    assert.equal(canPersistChatDocumentEdit("agent-governance", "edit_document"), false);
  });

  it("permite ux-ui-guide y upstream levels", () => {
    assert.equal(canPersistChatDocumentEdit("ux-ui-guide", "edit_document"), true);
    assert.equal(canPersistChatDocumentEdit("benchmark", "edit_document"), true);
    assert.equal(canPersistChatDocumentEdit("brd", "edit_document"), true);
    assert.equal(canPersistChatDocumentEdit("mdd", "edit_document"), true);
  });

  it("no persiste en chat_only", () => {
    assert.equal(canPersistChatDocumentEdit("mdd", "chat_only"), false);
    assert.equal(canPersistChatDocumentEdit("spec", "chat_only"), false);
  });

  it("isWorkshopFrozenDeliverableTab reconoce post-MDD", () => {
    assert.equal(isWorkshopFrozenDeliverableTab("tasks"), true);
    assert.equal(isWorkshopFrozenDeliverableTab("mdd"), false);
    assert.equal(isWorkshopFrozenDeliverableTab("ux-ui-guide"), false);
  });

  it("mensaje congelado en español", () => {
    assert.match(workshopFrozenTabUserMessage("spec"), /proyección del MDD/i);
  });

  it("plan de propagación desde benchmark", () => {
    const plan = buildUpstreamPropagatePatchPlan("benchmark");
    assert.equal(plan.originSource, "dbga");
    assert.deepEqual(plan.siblingTabs, ["brd", "phase0"]);
  });

  it("detecta confirmación de propagación", () => {
    assert.equal(looksLikeUpstreamPropagateConfirmation("sí, propagar"), true);
    assert.equal(looksLikeUpstreamPropagateConfirmation("solo pregunta"), false);
  });

  it("detecta oferta de propagación en asistente", () => {
    assert.equal(
      assistantOfferedUpstreamPropagate("Hecho.\n\n[UPSTREAM_PROPAGATE_OFFER]\n¿Propagar?"),
      true,
    );
  });
});
