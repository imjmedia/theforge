import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  applyPatternSelectionsToWizardBody,
  buildGovernanceBodySelectedOnly,
  buildMddWithGovernanceSkeleton,
  ensureMddGovernanceSection,
  extractGovernanceSection,
  formatActivePatternsPromptBlock,
  hasGovernanceSection,
  heuristicGovernancePatternIds,
  listGovernancePatternOptions,
  rankGovernancePatternCandidates,
  mddHasSubstantialBody,
  mddNeedsPatternWizard,
  MDD_GOVERNANCE_WIZARD_BODY,
  parseActivePatternsFromMdd,
  selectedPatternIdsFromMdd,
  resolveMddGovernancePreservation,
  stripGovernanceSection,
  updateMddGovernancePatterns,
  enforceMddGovernancePatternsOnPersist,
  serverWouldDropGovernancePatterns,
  governanceSectionHasCheckedPatternMarkers,
  shouldAllowGovernancePatternChangeOnPersist,
} from "./mdd-governance-patterns.js";

describe("mdd-governance-patterns", () => {
  it("lista todas las opciones del wizard", () => {
    const opts = listGovernancePatternOptions();
    assert.ok(opts.length >= 40);
    assert.ok(opts.some((o) => o.label.includes("Hexagonal")));
  });

  it("aplica selección [X] y parsea patrones activos", () => {
    const hex = optsId("Arquitectura Hexagonal (Ports & Adapters)");
    const body = applyPatternSelectionsToWizardBody(MDD_GOVERNANCE_WIZARD_BODY, new Set([hex]));
    const mdd = buildMddWithGovernanceSkeleton("Test MDD", body);
    assert.ok(hasGovernanceSection(mdd));
    const active = parseActivePatternsFromMdd(mdd);
    assert.equal(active.length, 1);
    assert.ok(active[0]!.label.includes("Hexagonal"));
    const block = formatActivePatternsPromptBlock(mdd);
    assert.match(block, /Hexagonal/);
  });

  it("mddNeedsPatternWizard solo con MDD vacío", () => {
    assert.equal(mddNeedsPatternWizard(""), true);
    assert.equal(mddNeedsPatternWizard("   "), true);
    const seeded = buildMddWithGovernanceSkeleton("X", buildGovernanceBodySelectedOnly(new Set([optsId("Repository")])));
    assert.equal(mddNeedsPatternWizard(seeded), false);
  });

  it("heuristicGovernancePatternIds detecta stack NestJS y Postgres", () => {
    const ids = heuristicGovernancePatternIds({
      dbgaContent: "Backend NestJS con Prisma sobre PostgreSQL y API REST.",
      brdContent: "Monolito modular desplegado con Docker.",
    });
    assert.ok(ids.length >= 2);
    assert.ok(ids.includes(optsId("Repository")));
    assert.ok(ids.includes(optsId("Monolito Modular")));
  });

  it("heuristicGovernancePatternIds usa defaults mínimos sin documentos", () => {
    const ids = heuristicGovernancePatternIds({});
    assert.ok(ids.includes(optsId("Repository")));
    assert.ok(ids.includes(optsId("Monolito Modular")));
  });

  it("rankGovernancePatternCandidates evita creacionales por stopwords españoles", () => {
    const ranked = rankGovernancePatternCandidates({
      dbgaContent:
        "El sistema proporciona interfaz para separar operaciones y define permisos.",
      brdContent: "Permite al inversor configurar estrategia semanal.",
    });
    const ids = ranked.map((c) => c.id);
    assert.ok(!ids.includes(optsId("Abstract Factory")));
    assert.ok(!ids.includes(optsId("Builder")));
    assert.ok(!ids.includes(optsId("Prototype")));
  });

  it("rankGovernancePatternCandidates detecta señales de stack en documentos", () => {
    const ranked = rankGovernancePatternCandidates({
      dbgaContent: "Microservicio WebSocket, Redis, PostgreSQL multi-tenant, broker Alpaca.",
      phase0SummaryContent: "Alpha Engine desacoplado con LLM orquestador.",
    });
    const ids = ranked.map((c) => c.id);
    assert.ok(ids.includes(optsId("Repository")));
    assert.ok(ids.includes(optsId("Observer / Pub-Sub")));
    assert.ok(ids.includes(optsId("Microservicios")));
  });

  it("buildGovernanceBodySelectedOnly omite patrones no seleccionados", () => {
    const hex = optsId("Arquitectura Hexagonal (Ports & Adapters)");
    const micro = optsId("Microservicios");
    const body = buildGovernanceBodySelectedOnly(new Set([hex, micro]));
    assert.ok(!body.includes("[ ]"));
    assert.match(body, /Hexagonal/);
    assert.match(body, /Microservicios/);
    assert.ok(!body.includes("Singleton"));
  });

  it("updateMddGovernancePatterns conserva §1–§7 y cambia solo [X]", () => {
    const hex = optsId("Monolito Modular");
    const base =
      buildMddWithGovernanceSkeleton("Proyecto X") +
      "\n## 1. Contexto\n\nAlcance mínimo con más de ochenta caracteres para validar que no se pierde el cuerpo canónico.\n" +
      "\n## 2. Arquitectura y Stack\n\nNestJS.\n";
    const updated = updateMddGovernancePatterns(base, new Set([hex]));
    assert.match(updated, /## 1\. Contexto/);
    assert.match(updated, /## 2\. Arquitectura/);
    assert.ok(parseActivePatternsFromMdd(updated).some((p) => p.label.includes("Monolito")));
    assert.equal(parseActivePatternsFromMdd(base).length, 0);
  });

  it("enforceMddGovernancePatternsOnPersist revierte [X] manual sin allowPatternChange", () => {
    const hex = optsId("Repository");
    const prev =
      updateMddGovernancePatterns(
        buildMddWithGovernanceSkeleton() +
          "\n## 1. Contexto\n\nTexto previo con más de ochenta caracteres para anclar la selección de patrones guardada.\n",
        new Set([hex]),
      );
    const tampered = updateMddGovernancePatterns(prev, new Set([optsId("Singleton")]));
    const { markdown, patternsReverted } = enforceMddGovernancePatternsOnPersist(
      tampered,
      prev,
    );
    assert.equal(patternsReverted, true);
    assert.ok(parseActivePatternsFromMdd(markdown).some((p) => p.label.includes("Repository")));
    assert.ok(!parseActivePatternsFromMdd(markdown).some((p) => p.label === "Singleton"));
  });

  it("enforceMddGovernancePatternsOnPersist permite cambio con allowPatternChange", () => {
    const prev = buildMddWithGovernanceSkeleton();
    const next = updateMddGovernancePatterns(prev, new Set([optsId("CQRS")]));
    const { markdown, patternsReverted } = enforceMddGovernancePatternsOnPersist(
      next,
      prev,
      { allowPatternChange: true },
    );
    assert.equal(patternsReverted, false);
    assert.ok(parseActivePatternsFromMdd(markdown).some((p) => p.label.includes("CQRS")));
  });

  it("serverWouldDropGovernancePatterns detecta respuesta sin patrones enviados", () => {
    const base = buildMddWithGovernanceSkeleton();
    const withPat = updateMddGovernancePatterns(base, new Set([optsId("Singleton")]));
    assert.equal(serverWouldDropGovernancePatterns(withPat, base), true);
    assert.equal(serverWouldDropGovernancePatterns(withPat, withPat), false);
  });

  it("parseActivePatternsFromMdd tolera viñetas corruptas # - [X]", () => {
    const gov =
      "## [ARQUITECTURA - SECCIÓN INMUTABLE]\n\n# - [X] **Singleton:** Descripción. *(Afecta a: MDD, Tasks)*\n";
    const md = `# MDD\n\n---\n\n${gov}\n\n## 1. Contexto\n\nTexto.\n`;
    assert.ok(parseActivePatternsFromMdd(md).some((p) => p.label.includes("Singleton")));
  });

  it("enforceMddGovernancePatternsOnPersist no vacía [X] si el parser estricto falla", () => {
    const gov =
      "## [ARQUITECTURA - SECCIÓN INMUTABLE]\n\n- [X] Singleton sin formato bold\n\n---\n";
    const md = `# MDD\n\n---\n\n${gov}\n\n## 1. Contexto\n\nTexto.\n`;
    assert.equal(selectedPatternIdsFromMdd(md).size, 0);
    assert.equal(governanceSectionHasCheckedPatternMarkers(md), true);
    const { markdown, patternsReverted } = enforceMddGovernancePatternsOnPersist(md, "", {
      allowPatternChange: true,
    });
    assert.equal(patternsReverted, false);
    assert.match(markdown, /- \[X\] Singleton sin formato bold/);
  });

  it("shouldAllowGovernancePatternChangeOnPersist si la selección difiere del guardado", () => {
    const base = buildMddWithGovernanceSkeleton();
    const withPat = updateMddGovernancePatterns(base, new Set([optsId("Singleton")]));
    assert.equal(shouldAllowGovernancePatternChangeOnPersist(withPat, base), true);
  });

  it("shouldAllowGovernancePatternChangeOnPersist no exige flag si previous ya tiene los mismos [X]", () => {
    const base = buildMddWithGovernanceSkeleton();
    const withPat = updateMddGovernancePatterns(base, new Set([optsId("Singleton")]));
    const edited =
      withPat +
      "\n## 1. Contexto\n\nCuerpo §1 con más de ochenta caracteres para el MDD canónico de prueba.\n";
    assert.equal(shouldAllowGovernancePatternChangeOnPersist(edited, withPat), false);
  });

  it("preserva gobernanza al preparar salida con §1 sustancial", () => {
    const skeleton = buildMddWithGovernanceSkeleton();
    const withS1 =
      skeleton +
      "\n## 1. Contexto\n\nSistema de prueba con alcance definido y más de ochenta caracteres de contenido real.\n";
    assert.ok(!mddHasSubstantialBody(skeleton.trim()));
    assert.ok(mddHasSubstantialBody(withS1));
    const stripped = stripGovernanceSection(withS1);
    assert.ok(!extractGovernanceSection(stripped));
    const restored = ensureMddGovernanceSection(stripped, extractGovernanceSection(withS1));
    assert.ok(hasGovernanceSection(restored));
    assert.match(restored, /## 1\. Contexto/);
  });

  it("resolveMddGovernancePreservation prefiere patrones del editor cliente sobre BD", () => {
    const hexId = optsId("Hexagonal");
    const monoId = optsId("Monolito Modular");
    const client = updateMddGovernancePatterns(
      "# Master Design Document\n\n## 1. Contexto\n\nTexto.\n",
      new Set([hexId]),
    );
    const db = updateMddGovernancePatterns(
      "# Master Design Document\n\n## 1. Contexto\n\nTexto.\n",
      new Set([monoId]),
    );
    const r = resolveMddGovernancePreservation(client, db);
    assert.equal(r.lockedPatternIds.size, 1);
    assert.ok(r.lockedPatternIds.has(hexId));
    assert.ok(r.preservedGovernance?.includes("Hexagonal"));
  });
});

function optsId(labelSubstring: string): string {
  const o = listGovernancePatternOptions().find((x) => x.label.includes(labelSubstring));
  assert.ok(o, `missing option ${labelSubstring}`);
  return o!.id;
}
