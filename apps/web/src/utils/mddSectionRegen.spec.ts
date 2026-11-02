import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildRegenerateSectionChatMessage,
  buildMddSectionRegenNotice,
  buildMddSection5PipelineRegenNotice,
  mddSectionRegenShortLabel,
  canRegenerateMddSectionFromWorkshop,
  detectNaturalRegenerateSection,
  getRegenerateSectionFromSlashCommand,
  mddHasSection5Heading,
  mddHasSection6Heading,
  mddSectionRegenDisabledTitle,
  resolveEffectiveMddContent,
  resolveMddReadinessHintActions,
} from "./mddSectionRegen.js";

describe("mddSectionRegen", () => {
  it("detectNaturalRegenerateSection acepta texto después del número", () => {
    assert.equal(detectNaturalRegenerateSection("regenera la sección 6 por favor"), 6);
    assert.equal(detectNaturalRegenerateSection("rehacer paso 3 del mdd"), 3);
  });

  it("getRegenerateSectionFromSlashCommand resuelve /seguridad", () => {
    assert.equal(getRegenerateSectionFromSlashCommand("/seguridad"), 6);
  });

  it("mddHasSection5Heading detecta ## 5. Lógica y Edge Cases", () => {
    assert.equal(mddHasSection5Heading("## 4. Contratos\n\nx\n## 5. Lógica y Edge Cases\n\nBDD"), true);
    assert.equal(mddHasSection5Heading("## 4. Contratos\n\n## 6. Seguridad"), false);
  });

  it("getRegenerateSectionFromSlashCommand resuelve /5 y /logica", () => {
    assert.equal(getRegenerateSectionFromSlashCommand("/5"), 5);
    assert.equal(getRegenerateSectionFromSlashCommand("/logica"), 5);
  });

  it("mddHasSection6Heading detecta ## 6. Seguridad", () => {
    assert.equal(mddHasSection6Heading("## 5. Lógica\n\nx\n## 6. Seguridad\n\nJWT"), true);
    assert.equal(mddHasSection6Heading("## 5. Lógica\n\n## 7. Infraestructura"), false);
  });

  it("buildRegenerateSectionChatMessage usa slash del catálogo", () => {
    assert.equal(buildRegenerateSectionChatMessage(6), "/seguridad");
    assert.equal(buildRegenerateSectionChatMessage(3), "/modelo-datos");
  });

  it("buildMddSectionRegenNotice incluye sección y etiqueta", () => {
    assert.equal(buildMddSectionRegenNotice(6), "Regenerando §6 (Seguridad)…");
    assert.equal(mddSectionRegenShortLabel(6), "Seguridad");
  });

  it("buildMddSection5PipelineRegenNotice describe paridad pipeline", () => {
    assert.match(buildMddSection5PipelineRegenNotice(), /pipeline/i);
    assert.match(buildMddSection5PipelineRegenNotice(), /§5/);
  });

  it("resolveMddReadinessHintActions sugiere §5 para lógica/BDD", () => {
    const actions = resolveMddReadinessHintActions("Refuerza §5 Lógica y edge cases con reglas BDD/AAA.");
    assert.deepEqual(actions, [{ kind: "regenerate", section: 5, label: "Regenerar §5" }]);
  });

  it("resolveMddReadinessHintActions sugiere formato y §7 para trazabilidad", () => {
    const actions = resolveMddReadinessHintActions(
      "Refuerza trazabilidad §2↔§7 y paridad Mermaid/SQL para subir efectividad.",
    );
    assert.deepEqual(actions.map((a) => a.label), ["Re-aplicar formato", "Regenerar §7"]);
  });

  it("resolveEffectiveMddContent prioriza store, luego etapa, luego proyecto", () => {
    assert.equal(
      resolveEffectiveMddContent({
        mddContent: "  store  ",
        stageMddContent: "stage",
        projectMddContent: "project",
      }),
      "store",
    );
    assert.equal(
      resolveEffectiveMddContent({
        mddContent: "",
        stageMddContent: " stage ",
        projectMddContent: "project",
      }),
      "stage",
    );
    assert.equal(
      resolveEffectiveMddContent({
        mddContent: null,
        stageMddContent: null,
        projectMddContent: "project",
      }),
      "project",
    );
  });

  it("canRegenerateMddSectionFromWorkshop no exige sesión de chat", () => {
    assert.equal(
      canRegenerateMddSectionFromWorkshop("proj-1", "## 1. Contexto\n\nx", {}),
      true,
    );
    assert.equal(canRegenerateMddSectionFromWorkshop("", "## MDD", {}), false);
    assert.equal(canRegenerateMddSectionFromWorkshop("proj-1", "", {}), false);
    assert.equal(
      canRegenerateMddSectionFromWorkshop("proj-1", "## MDD", { loading: true }),
      false,
    );
  });

  it("mddSectionRegenDisabledTitle no menciona sesión de chat", () => {
    assert.match(mddSectionRegenDisabledTitle(null, "mdd"), /proyecto/i);
    assert.match(mddSectionRegenDisabledTitle("p1", ""), /MDD guardado/i);
  });
});
