import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  appendDocumentChangelogEntry,
  bumpDocumentMinorVersion,
  bumpDocumentPatchVersion,
  documentBodyWithoutChangelog,
  ensureDocumentChangelog,
  fixDocumentChangelogInitialDate,
  formatDocumentChangelogDate,
  getDocumentChangelogLlmInstructions,
  hasDocumentChangelogSection,
  isChangelogOnlyDocument,
  parseLatestDocumentVersion,
} from "./document-changelog.js";
import {
  compilePagToInfraMarkdown,
  compilePagToLogicFlowsMarkdown,
} from "./document-compiler.js";
import type { ProjectArchitectureGraph } from "./project-architecture-graph.js";

const minimalPag = {
  version: "1.0.0",
  projectName: "Demo",
  description: "Demo",
  stack: {
    runtime: "Node.js 20",
    backendFramework: "NestJS",
    frontendFramework: "React 18 + Vite",
    database: "PostgreSQL 16",
    orm: "Prisma",
  },
  entities: [],
  endpoints: [],
} as unknown as ProjectArchitectureGraph;

const countChangelogHeadings = (md: string): number =>
  (md.match(/^#{1,3}\s+(?:\d+\.\s+)?Registro de cambios del documento\s*$/gim) ?? [])
    .length;

const TABLE_4_COLS = `# Doc

## 3. Registro de cambios del documento

| Versión | Fecha | Autor | Descripción |
|:--------|:------|:------|:------------|
| 1.0 | 2026-10-22 | DocumentCompiler (PAG) | Compilación inicial |`;

describe("document-changelog", () => {
  it("formatDocumentChangelogDate usa mes en español", () => {
    assert.equal(formatDocumentChangelogDate(new Date(2026, 4, 15)), "Mayo 2026");
  });

  it("ensureDocumentChangelog añade sección 1.0 si falta", () => {
    const out = ensureDocumentChangelog("# DBGA\n\nContenido.", {
      initialDescription: "Creación inicial del DBGA",
      initialDate: "Mayo 2026",
    });
    assert.equal(hasDocumentChangelogSection(out), true);
    assert.match(out, /\| 1\.0 \| Mayo 2026 \| Creación inicial del DBGA \|/);
  });

  it("ensureDocumentChangelog corrige fecha 1.0 si changelog ya existe", () => {
    const doc = `# BRD

## Registro de cambios del documento

| Versión | Fecha | Descripción del cambio |
| --- | --- | --- |
| 1.0 | Abril 2026 | Creación inicial del BRD |
| 1.1 | Mayo 2026 | Añadir RACI |`;
    const out = ensureDocumentChangelog(doc, { initialDate: "Julio 2026" });
    assert.match(out, /\| 1\.0 \| Julio 2026 \| Creación inicial del BRD \|/);
    assert.match(out, /\| 1\.1 \| Mayo 2026 \| Añadir RACI \|/);
  });

  it("fixDocumentChangelogInitialDate reemplaza fecha incorrecta del LLM", () => {
    const doc = `# Deep Research

## Registro de cambios del documento

| Versión | Fecha | Descripción del cambio |
| --- | --- | --- |
| 1.0 | Abril 2026 | Creación inicial del informe de Deep Research |`;
    const out = fixDocumentChangelogInitialDate(doc, "Julio 2026");
    assert.match(
      out,
      /\| 1\.0 \| Julio 2026 \| Creación inicial del informe de Deep Research \|/,
    );
    assert.doesNotMatch(out, /Abril 2026/);
  });

  it("getDocumentChangelogLlmInstructions inyecta fecha del sistema", () => {
    const out = getDocumentChangelogLlmInstructions(new Date(2026, 6, 14));
    assert.match(out, /«Julio 2026»/);
    assert.match(out, /\*\*Fecha obligatoria fila 1\.0:\*\* `Julio 2026`/);
  });

  it("parseLatestDocumentVersion devuelve la mayor versión", () => {
    const doc = `| 2.0 | Julio 2026 | Reestructuración |
| 2.8 | Julio 2026 | Jerarquía precio |`;
    assert.equal(parseLatestDocumentVersion(doc), "2.8");
  });

  it("bumpDocumentPatchVersion incrementa minor", () => {
    assert.equal(bumpDocumentPatchVersion("2.7"), "2.8");
    assert.equal(bumpDocumentPatchVersion("1.0"), "1.1");
  });

  it("bumpDocumentMinorVersion incrementa major", () => {
    assert.equal(bumpDocumentMinorVersion("1.9"), "2.0");
  });

  it("appendDocumentChangelogEntry añade fila preservando historial", () => {
    const doc = ensureDocumentChangelog("# MDD\n\nBody.", {
      initialDescription: "Creación inicial del MDD",
      initialDate: "Mayo 2026",
    });
    const out = appendDocumentChangelogEntry(doc, {
      version: "1.1",
      date: "Mayo 2026",
      description: "Añadir §5 edge cases",
    });
    assert.match(out, /\| 1\.0 \| Mayo 2026 \| Creación inicial del MDD \|/);
    assert.match(out, /\| 1\.1 \| Mayo 2026 \| Añadir §5 edge cases \|/);
  });

  it("documentBodyWithoutChangelog separa cuerpo y changelog", () => {
    const doc = `# Spec

Alcance MVP con entregables, criterios de aceptación y dependencias técnicas documentadas para el equipo.

## Registro de cambios del documento

| Versión | Fecha | Descripción del cambio |
| --- | --- | --- |
| 1.0 | Junio 2026 | Creación inicial del documento |`;
    assert.equal(
      documentBodyWithoutChangelog(doc),
      "# Spec\n\nAlcance MVP con entregables, criterios de aceptación y dependencias técnicas documentadas para el equipo.",
    );
    assert.equal(isChangelogOnlyDocument(doc), false);
  });

  it("isChangelogOnlyDocument detecta shell vacío post ensureDocumentChangelog", () => {
    const shell = ensureDocumentChangelog("");
    assert.equal(isChangelogOnlyDocument(shell), true);
  });

  it("ensureDocumentChangelog no duplica el changelog en Flujos compilado (## 3.)", () => {
    const md = compilePagToLogicFlowsMarkdown(minimalPag);
    const out = ensureDocumentChangelog(md);
    assert.equal(countChangelogHeadings(out), 1);
    assert.equal(hasDocumentChangelogSection(md), true);
  });

  it("ensureDocumentChangelog no duplica el changelog en Infra compilado (## 4.)", () => {
    const md = compilePagToInfraMarkdown(minimalPag);
    const out = ensureDocumentChangelog(md);
    assert.equal(countChangelogHeadings(out), 1);
    // La fila 1.0 de 4 celdas conserva el Autor tras corregir la fecha.
    assert.match(out, /\| 1\.0 \| [^|]+ \| DocumentCompiler \(PAG\) \| [^|]+ \|/);
  });

  it("appendDocumentChangelogEntry añade fila de 4 celdas sobre tabla de 4 columnas", () => {
    const out = appendDocumentChangelogEntry(TABLE_4_COLS, {
      version: "1.1",
      date: "Noviembre 2026",
      description: "Ajuste de flujos",
    });
    assert.equal(countChangelogHeadings(out), 1);
    assert.match(out, /^\| 1\.1 \| Noviembre 2026 \| — \| Ajuste de flujos \|$/m);
  });

  it("appendDocumentChangelogEntry mantiene 3 celdas en tabla de 3 columnas", () => {
    const doc = ensureDocumentChangelog("# X\n\nCuerpo.", { initialDate: "Mayo 2026" });
    const out = appendDocumentChangelogEntry(doc, {
      version: "1.1",
      date: "Junio 2026",
      description: "Cambio",
    });
    assert.match(out, /^\| 1\.1 \| Junio 2026 \| Cambio \|$/m);
  });

  it("parseLatestDocumentVersion lee la versión de una tabla de 4 columnas", () => {
    const doc = `${TABLE_4_COLS}\n| 1.2 | 2026-11-01 | — | Otro |`;
    assert.equal(parseLatestDocumentVersion(doc), "1.2");
  });

  it("parseLatestDocumentVersion ignora una tabla de Tasks de 4 celdas fuera del changelog", () => {
    const doc = "# Tasks\n\n| # | Tarea | Horas | Prioridad |\n|---|---|---|---|\n| 12 | Login | 3 | Alta |\n| 13 | Logout | 1 | Baja |\n\n## Registro de cambios del documento\n\n| Versión | Fecha | Descripción del cambio |\n| --- | --- | --- |\n| 1.0 | Nov 2026 | Inicial |\n";
    assert.equal(parseLatestDocumentVersion(doc), "1.0");
  });

  it("encabezado sin número sigue reconocido", () => {
    const doc = "# A\n\n## Registro de cambios del documento\n\n| Versión | Fecha | Descripción del cambio |\n| --- | --- | --- |\n| 1.0 | Mayo 2026 | x |";
    assert.equal(hasDocumentChangelogSection(doc), true);
    assert.equal(countChangelogHeadings(ensureDocumentChangelog(doc)), 1);
    assert.equal(parseLatestDocumentVersion(doc), "1.0");
  });

  it("separador `|:---` del compilador PAG con sección posterior: la fila queda dentro de la tabla", () => {
    const doc = `# A

## Registro de cambios del documento

| Versión | Fecha | Descripción del cambio |
|:--------|:------|:-----------------------|
| 1.0 | Mayo 2026 | x |

## Cumplimiento

Texto posterior.`;
    const out = appendDocumentChangelogEntry(doc, {
      version: "1.1",
      date: "Junio 2026",
      description: "Cambio",
    });
    const lines = out.split("\n");
    const rowIdx = lines.findIndex((l) => l.startsWith("| 1.1 |"));
    const prevIdx = lines.findIndex((l) => l.startsWith("| 1.0 |"));
    assert.equal(rowIdx, prevIdx + 1);
    assert.ok(rowIdx < lines.findIndex((l) => l.startsWith("## Cumplimiento")));
    assert.match(out, /Texto posterior\.$/);
  });
});
