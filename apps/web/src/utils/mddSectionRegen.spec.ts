import { describe, expect, it } from "vitest";
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
} from "./mddSectionRegen";

describe("mddSectionRegen", () => {
  it("detectNaturalRegenerateSection acepta texto después del número", () => {
    expect(detectNaturalRegenerateSection("regenera la sección 6 por favor")).toBe(6);
    expect(detectNaturalRegenerateSection("rehacer paso 3 del mdd")).toBe(3);
  });

  it("getRegenerateSectionFromSlashCommand resuelve /seguridad", () => {
    expect(getRegenerateSectionFromSlashCommand("/seguridad")).toBe(6);
  });

  it("mddHasSection5Heading detecta ## 5. Lógica y Edge Cases", () => {
    expect(mddHasSection5Heading("## 4. Contratos\n\nx\n## 5. Lógica y Edge Cases\n\nBDD")).toBe(true);
    expect(mddHasSection5Heading("## 4. Contratos\n\n## 6. Seguridad")).toBe(false);
  });

  it("getRegenerateSectionFromSlashCommand resuelve /5 y /logica", () => {
    expect(getRegenerateSectionFromSlashCommand("/5")).toBe(5);
    expect(getRegenerateSectionFromSlashCommand("/logica")).toBe(5);
  });

  it("mddHasSection6Heading detecta ## 6. Seguridad", () => {
    expect(mddHasSection6Heading("## 5. Lógica\n\nx\n## 6. Seguridad\n\nJWT")).toBe(true);
    expect(mddHasSection6Heading("## 5. Lógica\n\n## 7. Infraestructura")).toBe(false);
  });

  it("buildRegenerateSectionChatMessage usa slash del catálogo", () => {
    expect(buildRegenerateSectionChatMessage(6)).toBe("/seguridad");
    expect(buildRegenerateSectionChatMessage(3)).toBe("/modelo-datos");
  });

  it("buildMddSectionRegenNotice incluye sección y etiqueta", () => {
    expect(buildMddSectionRegenNotice(6)).toBe("Regenerando §6 (Seguridad)…");
    expect(mddSectionRegenShortLabel(6)).toBe("Seguridad");
  });

  it("buildMddSection5PipelineRegenNotice describe paridad pipeline", () => {
    expect(buildMddSection5PipelineRegenNotice()).toMatch(/pipeline/i);
    expect(buildMddSection5PipelineRegenNotice()).toMatch(/§5/);
  });

  it("resolveMddReadinessHintActions sugiere §5 para lógica/BDD", () => {
    const actions = resolveMddReadinessHintActions("Refuerza §5 Lógica y edge cases con reglas BDD/AAA.");
    expect(actions).toEqual([{ kind: "regenerate", section: 5, label: "Regenerar §5" }]);
  });

  it("resolveMddReadinessHintActions sugiere formato y §7 para trazabilidad", () => {
    const actions = resolveMddReadinessHintActions(
      "Refuerza trazabilidad §2↔§7 y paridad Mermaid/SQL para subir efectividad.",
    );
    expect(actions.map((a) => a.label)).toEqual(["Re-aplicar formato", "Regenerar §7"]);
  });

  it("resolveEffectiveMddContent prioriza store, luego etapa, luego proyecto", () => {
    expect(
      resolveEffectiveMddContent({
        mddContent: "  store  ",
        stageMddContent: "stage",
        projectMddContent: "project",
      }),
    ).toBe("store");
    expect(
      resolveEffectiveMddContent({
        mddContent: "",
        stageMddContent: " stage ",
        projectMddContent: "project",
      }),
    ).toBe("stage");
    expect(
      resolveEffectiveMddContent({
        mddContent: null,
        stageMddContent: null,
        projectMddContent: "project",
      }),
    ).toBe("project");
  });

  it("canRegenerateMddSectionFromWorkshop no exige sesión de chat", () => {
    expect(
      canRegenerateMddSectionFromWorkshop("proj-1", "## 1. Contexto\n\nx", {}),
    ).toBe(true);
    expect(canRegenerateMddSectionFromWorkshop("", "## MDD", {})).toBe(false);
    expect(canRegenerateMddSectionFromWorkshop("proj-1", "", {})).toBe(false);
    expect(
      canRegenerateMddSectionFromWorkshop("proj-1", "## MDD", { loading: true }),
    ).toBe(false);
  });

  it("mddSectionRegenDisabledTitle no menciona sesión de chat", () => {
    expect(mddSectionRegenDisabledTitle(null, "mdd")).toMatch(/proyecto/i);
    expect(mddSectionRegenDisabledTitle("p1", "")).toMatch(/MDD guardado/i);
  });
});
