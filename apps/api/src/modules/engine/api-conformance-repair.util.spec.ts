import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  compilePagToApiContractsMarkdown,
  type ProjectArchitectureGraph,
} from "@theforge/shared-types";
import {
  reconcileApiContractsToMdd,
  repairApiProgrammaticGaps,
  runApiConformanceCheck,
} from "./api-conformance-repair.util.js";
import { checkApiVsMdd } from "./conformance.service.js";
import { cleanDocumentContent } from "../sessions/document-content.util.js";

const MDD = `# MDD

## 4. Contratos de API

| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | /api/users | Lista usuarios |
| POST | /api/users | Crea usuario |
`;

const MDD_VACIO = `# MDD

## 4. Contratos de API

Sin endpoints todavía.
`;

function pag(endpoints: Array<{ method: string; path: string }>): ProjectArchitectureGraph {
  return {
    projectName: "Demo",
    endpoints: endpoints.map((e) => ({
      ...e,
      description: "Operación",
      authRequired: true,
      targetEntity: "User",
    })),
  } as unknown as ProjectArchitectureGraph;
}

const countBlocks = (s: string): number => (s.match(/^## Contratos API \(MDD §4\)/gm) ?? []).length;

function applyN(fn: (m: string, a: string) => string, mdd: string, doc: string, n: number): string[] {
  const outs: string[] = [];
  let cur = doc;
  for (let i = 0; i < n; i++) {
    cur = fn(mdd, cur);
    outs.push(cur);
  }
  return outs;
}

describe("reconcileApiContractsToMdd idempotencia", () => {
  it("documento PAG con filas **GET**: a lo sumo 1 bloque y salida estable desde el pase 2", () => {
    const doc = compilePagToApiContractsMarkdown(
      pag([
        { method: "GET", path: "/api/users" },
        { method: "POST", path: "/api/users" },
      ]),
    );
    const outs = applyN(repairApiProgrammaticGaps, MDD, doc, 4);
    for (const o of outs) assert.ok(countBlocks(o) <= 1);
    assert.equal(outs[1], outs[0]);
    assert.equal(outs[2], outs[1]);
    assert.equal(outs[3], outs[2]);
    assert.ok(outs[3]!.includes("## 2. Esquemas"));
    assert.ok(outs[3]!.includes("## 3. Códigos de Estado"));
    assert.ok(checkApiVsMdd(MDD, outs[3]!).ok);
  });

  it("PAG con 0 endpoints conserva fila de catálogo, §2/§3 y no duplica", () => {
    const doc = compilePagToApiContractsMarkdown(pag([]));
    const outs = applyN(reconcileApiContractsToMdd, MDD, doc, 4);
    assert.equal(outs[1], outs[0]);
    assert.equal(outs[3], outs[0]);
    assert.ok(countBlocks(outs[3]!) <= 1);
    assert.ok(outs[3]!.includes("## 3. Códigos de Estado"));
    assert.ok(outs[3]!.includes("/api/users"));
  });

  it("sana un documento con N bloques duplicados a 1", () => {
    const bloque = `## Contratos API (MDD §4)\n\n| Método | Ruta | Descripción | Auth | Notas |\n|--------|------|-------------|------|-------|\n| GET | \`/api/users\` | MDD §4 | Bearer | auto |\n`;
    const doc = `# Contratos API\n\n${bloque}\n${bloque}\n${bloque}\n${bloque}`;
    const out = reconcileApiContractsToMdd(MDD, doc);
    assert.equal(countBlocks(out), 1);
    assert.equal(reconcileApiContractsToMdd(MDD, out), out);
    assert.ok(checkApiVsMdd(MDD, out).ok);
  });

  it("inserta en su sitio el endpoint faltante conservando §2/§3", () => {
    const doc = compilePagToApiContractsMarkdown(pag([{ method: "GET", path: "/api/users" }]));
    const out = reconcileApiContractsToMdd(MDD, doc);
    assert.equal(countBlocks(out), 0);
    assert.ok(/\|\s*POST\s*\|\s*`\/api\/users`/.test(out));
    assert.ok(out.indexOf("POST") < out.indexOf("## 2. Esquemas"));
    assert.ok(out.includes("## 3. Códigos de Estado"));
    assert.equal(reconcileApiContractsToMdd(MDD, out), out);
  });

  it("sin tabla de endpoints añade el bloque §4 una sola vez", () => {
    const doc = "# Contratos API\n\nTexto introductorio sin tabla.\n";
    const outs = applyN(reconcileApiContractsToMdd, MDD, doc, 3);
    assert.equal(countBlocks(outs[0]!), 1);
    assert.equal(outs[1], outs[0]);
    assert.equal(outs[2], outs[0]);
  });

  it("MDD sin endpoints no altera el documento", () => {
    const doc = "# Contratos API\n\nAlgo\n";
    assert.equal(reconcileApiContractsToMdd(MDD_VACIO, doc).trim(), doc.trim());
  });

  it("bloque heredado único con descripciones reales sale intacto", () => {
    const doc = `# Contratos API\n\nPreámbulo del servicio.\n\n## Contratos API (MDD §4)\n\n| Método | Ruta | Descripción | Auth | Notas |\n|--------|------|-------------|------|-------|\n| GET | \`/api/users\` | Lista paginada de usuarios | JWT admin | — |\n| POST | \`/api/users\` | Crea un usuario | JWT admin | — |\n`;
    const out = reconcileApiContractsToMdd(MDD, doc);
    assert.equal(out.trim(), doc.trim());
    assert.ok(out.includes("Lista paginada de usuarios | JWT admin"));
    assert.equal(reconcileApiContractsToMdd(MDD, out), out);
  });

  it("N bloques con descripciones reales colapsa a 1 sin perderlas", () => {
    const real = `## Contratos API (MDD §4)\n\n| Método | Ruta | Descripción | Auth | Notas |\n|--------|------|-------------|------|-------|\n| GET | \`/api/users\` | Lista paginada de usuarios | JWT admin | — |\n| POST | \`/api/users\` | Crea un usuario | JWT admin | — |\n`;
    const def = `## Contratos API (MDD §4)\n\n| Método | Ruta | Descripción | Auth | Notas |\n|--------|------|-------------|------|-------|\n| GET | \`/api/users\` | MDD §4 | Bearer | auto |\n| POST | \`/api/users\` | MDD §4 | Bearer | auto |\n`;
    const doc = `# Contratos API\n\n${def}\n${real}\n${def}`;
    const out = reconcileApiContractsToMdd(MDD, doc);
    assert.equal(countBlocks(out), 1);
    assert.ok(out.includes("Lista paginada de usuarios | JWT admin"));
    assert.ok(out.includes("Crea un usuario"));
    assert.ok(!out.includes("MDD §4 | Bearer | auto"));
    assert.equal(reconcileApiContractsToMdd(MDD, out), out);
  });

  it("multi-tabla: elimina el extra de la 2.ª tabla sin duplicar métodos en la 1.ª", () => {
    const doc = `# Contratos API\n\n## Usuarios\n\n| Método | Ruta | Descripción |\n|---|---|---|\n| GET | /api/users | Lista |\n\n## Otros\n\n| Método | Ruta | Descripción |\n|---|---|---|\n| POST | /api/users | Crea |\n| DELETE | /api/extra | Sobra |\n`;
    const out = reconcileApiContractsToMdd(MDD, doc);
    assert.ok(!out.includes("/api/extra"));
    assert.equal((out.match(/\|\s*GET\s*\|/g) ?? []).length, 1);
    assert.ok(checkApiVsMdd(MDD, out, { tablesOnly: true }).ok);
    assert.equal(reconcileApiContractsToMdd(MDD, out), out);
  });

  it("sección de detalle por endpoint no rompe la conformidad (sin reintento)", () => {
    const doc = `# Contratos API\n\n| Método | Ruta | Descripción |\n|---|---|---|\n| GET | /api/users | Lista |\n| POST | /api/users | Crea |\n\n### DELETE /api/users/{id}\n\nElimina un usuario.\n`;
    assert.equal(runApiConformanceCheck(MDD, doc).ok, true);
    const out = reconcileApiContractsToMdd(MDD, doc);
    assert.equal(out.trim(), doc.trim());
    assert.equal(reconcileApiContractsToMdd(MDD, out), out);
  });

  it("conserva filas sin endpoint y respeta el orden de columnas (Ruta | Método)", () => {
    const doc = `# Contratos API\n\n| Ruta | Método | Descripción |\n|---|---|---|\n| /api/users | GET | Lista |\n| (ver notas) | — | Nota intercalada |\n| /api/otro | PUT | Sobra |\n`;
    const out = reconcileApiContractsToMdd(MDD, doc);
    assert.ok(out.includes("Nota intercalada"));
    assert.ok(!out.includes("/api/otro"));
    assert.ok(/\|\s*`\/api\/users`\s*\|\s*POST\s*\|/.test(out));
    assert.equal(reconcileApiContractsToMdd(MDD, out), out);
  });

  it("#1 PAG con filas **GET** y descripciones distintas: conforme y las descripciones sobreviven", () => {
    const mdd3 = `${MDD}| DELETE | /api/users/{id} | Borra |\n`;
    const g = {
      projectName: "Demo",
      endpoints: [
        { method: "GET", path: "/api/users", description: "Lista real", authRequired: true, targetEntity: "User" },
        { method: "POST", path: "/api/users", description: "Crea real", authRequired: true, targetEntity: "User" },
        { method: "DELETE", path: "/api/users/{id}", description: "Borra real", authRequired: true, targetEntity: "User" },
      ],
    } as unknown as ProjectArchitectureGraph;
    const doc = cleanDocumentContent(compilePagToApiContractsMarkdown(g));
    assert.equal(runApiConformanceCheck(mdd3, doc).ok, true);
    const outs = applyN(repairApiProgrammaticGaps, mdd3, doc, 3);
    for (const o of outs) {
      assert.ok(o.includes("Lista real"));
      assert.ok(o.includes("Crea real"));
      assert.ok(o.includes("Borra real"));
      assert.ok(!o.includes("MDD §4 | Bearer"));
    }
    assert.equal(outs[1], outs[0]);
    assert.equal(outs[2], outs[1]);
  });

  it("#1 PAG con **GET** al que le falta un endpoint conserva las descripciones reales", () => {
    const g = {
      projectName: "Demo",
      endpoints: [{ method: "POST", path: "/api/users", description: "Crea real", authRequired: true, targetEntity: "User" }],
    } as unknown as ProjectArchitectureGraph;
    const doc = cleanDocumentContent(compilePagToApiContractsMarkdown(g));
    const outs = applyN(repairApiProgrammaticGaps, MDD, doc, 3);
    assert.ok(/\|\s*\**POST\**\s*\|[^\n]*Crea real/.test(outs[0]!));
    assert.equal(outs[1], outs[0]);
    assert.ok(runApiConformanceCheck(MDD, outs[0]!).ok);
  });

  it("#2 tabla «Convenciones» con ruta en prosa no se toma como tabla de endpoints", () => {
    const doc = `# Contratos API\n\n## Convenciones\n\n| Tema | Detalle |\n|---|---|\n| Autenticación | Token vía /api/auth/token |\n| Versionado | Prefijo /api |\n\n## Endpoints\n\n| Método | Ruta | Descripción |\n|---|---|---|\n| GET | /api/users | Lista real |\n`;
    const outs = applyN(reconcileApiContractsToMdd, MDD, doc, 3);
    const o = outs[0]!;
    assert.ok(o.includes("| Autenticación | Token vía /api/auth/token |"));
    assert.ok(o.includes("| Versionado | Prefijo /api |"));
    assert.ok(o.includes("Lista real"));
    assert.ok(/\|\s*POST\s*\|\s*`\/api\/users`/.test(o));
    assert.ok(o.indexOf("POST") > o.indexOf("## Endpoints"));
    assert.equal(outs[1], o);
    assert.equal(outs[2], o);
    assert.ok(checkApiVsMdd(MDD, o, { tablesOnly: true }).ok);
  });

  it("#4a documento sin tabla conserva ## Autenticación y ## Errores", () => {
    const doc = "# Contratos API\n\nIntro.\n\n## Autenticación\n\nUsa JWT.\n\n## Errores\n\nTexto.\n";
    const outs = applyN(reconcileApiContractsToMdd, MDD, doc, 3);
    const o = outs[0]!;
    assert.ok(o.includes("## Autenticación") && o.includes("Usa JWT."));
    assert.ok(o.includes("## Errores") && o.includes("Texto."));
    assert.equal(countBlocks(o), 1);
    assert.ok(o.indexOf("## Contratos API (MDD §4)") < o.indexOf("## Autenticación"));
    assert.equal(outs[1], o);
    assert.equal(outs[2], o);
  });

  it("#4b bloque heredado incompleto seguido de §2/§3 los conserva y repone el bloque en su sitio", () => {
    const doc = `# Contratos API\n\nPreámbulo.\n\n## Contratos API (MDD §4)\n\n| Método | Ruta | Descripción | Auth | Notas |\n|---|---|---|---|---|\n| GET | \`/api/users\` | Lista real | JWT | — |\n\n## 2. Esquemas\n\nEsquema importante.\n\n## 3. Códigos\n\n| Código | Significado |\n|---|---|\n| 200 | OK |\n`;
    const outs = applyN(reconcileApiContractsToMdd, MDD, doc, 3);
    const o = outs[0]!;
    assert.ok(o.includes("## 2. Esquemas") && o.includes("Esquema importante."));
    assert.ok(o.includes("## 3. Códigos") && o.includes("| 200 | OK |"));
    assert.equal(countBlocks(o), 1);
    assert.ok(/\|\s*POST\s*\|\s*`\/api\/users`/.test(o));
    assert.ok(o.indexOf("POST") < o.indexOf("## 2. Esquemas"));
    assert.equal(outs[1], o);
    assert.equal(outs[2], o);
    assert.ok(checkApiVsMdd(MDD, o, { tablesOnly: true }).ok);
  });

  it("#5 no borra filas de otras tablas (Errores, Ejemplos) que citan rutas", () => {
    const doc = `# Contratos API\n\n| Método | Ruta | Descripción |\n|---|---|---|\n| GET | /api/users | Lista |\n| DELETE | /api/extra | Sobra |\n\n## Errores\n\n| Código | Método | Ruta ejemplo |\n|---|---|---|\n| 404 | GET | /api/users/{id} |\n\n## Ejemplos\n\n| Ejemplo | Llamada |\n|---|---|\n| path-first | /api/legacy | GET |\n`;
    const outs = applyN(reconcileApiContractsToMdd, MDD, doc, 3);
    const o = outs[0]!;
    assert.ok(o.includes("| 404 | GET | /api/users/{id} |"));
    assert.ok(o.includes("| path-first | /api/legacy | GET |"));
    assert.ok(!o.includes("/api/extra"));
    assert.equal(outs[1], o);
    assert.equal(outs[2], o);
  });

  it("#8 §4 que cita una ruta en prosa no hace que el reparador añada filas extra", () => {
    const mdd = `# MDD\n\n## 4. Contratos de API\n\n| Método | Ruta |\n|---|---|\n| GET | /api/users |\n\nAdemás el healthcheck GET /api/health.\n`;
    const doc = `# API\n\nDocumento de contratos del servicio de usuarios para la verificación.\n\n| Método | Ruta | Desc |\n|---|---|---|\n| GET | /api/users | Lista |\n| PUT | /api/x | extra |\n`;
    const outs = applyN(reconcileApiContractsToMdd, mdd, doc, 3);
    const o = outs[0]!;
    assert.ok(!o.includes("/api/health"));
    assert.ok(!o.includes("/api/x"));
    assert.ok(checkApiVsMdd(mdd, o, { tablesOnly: true }).ok);
    assert.equal(outs[1], o);
    assert.equal(outs[2], o);
  });

  it("#11 fila por defecto + fila real del mismo endpoint: se conserva la real", () => {
    const doc = `# Contratos API\n\n| Método | Ruta | Descripción | Auth | Notas |\n|---|---|---|---|---|\n| GET | \`/api/users\` | MDD §4 | Bearer | auto |\n\n## Contratos API (MDD §4)\n\n| Método | Ruta | Descripción | Auth | Notas |\n|---|---|---|---|---|\n| GET | \`/api/users\` | Lista de verdad | JWT | — |\n| POST | \`/api/users\` | Crea de verdad | JWT | — |\n`;
    const outs = applyN(reconcileApiContractsToMdd, MDD, doc, 3);
    const o = outs[0]!;
    assert.ok(!o.includes("MDD §4 | Bearer"));
    assert.ok(o.includes("Lista de verdad") && o.includes("Crea de verdad"));
    assert.equal(outs[1], o);
    assert.equal(outs[2], o);
    assert.ok(checkApiVsMdd(MDD, o, { tablesOnly: true }).ok);
  });
});
