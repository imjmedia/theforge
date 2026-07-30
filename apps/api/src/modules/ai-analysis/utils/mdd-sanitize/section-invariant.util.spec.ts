import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  canonicalH2LabelsLost,
  canonicalH2LabelsOutsideFences,
  guardCanonicalH2Loss,
} from "./section-invariant.util.js";
import { replaceMddSection3Body } from "./section-merge.js";

const FULL_DRAFT = [
  "## 1. Contexto y alcance",
  "",
  "texto",
  "",
  "## 3. Modelo de Datos",
  "",
  "```sql",
  "CREATE TABLE certificates (id uuid PRIMARY KEY);",
  "```",
  "",
  "## 4. Contratos de API",
  "",
  "### GET /health",
  "",
  "## 6. Seguridad",
  "",
  "- TLS 1.3",
].join("\n");

describe("canonicalH2LabelsOutsideFences", () => {
  it("lista solo H2 canónicos reales", () => {
    const labels = canonicalH2LabelsOutsideFences(FULL_DRAFT);
    assert.deepEqual([...labels].sort(), ["1", "3", "4", "6"]);
  });

  it("ignora H2 dentro de fences y subheadings ###", () => {
    const draft = ["## 3. Modelo de Datos", "", "```markdown", "## 4. Contratos de API", "```", "", "### 5. no", ""].join("\n");
    assert.deepEqual([...canonicalH2LabelsOutsideFences(draft)], ["3"]);
  });

  it("cuenta UI/UX como etiqueta canónica", () => {
    assert.ok(canonicalH2LabelsOutsideFences("## UI/UX Intent\n\nx").has("ui-ux"));
  });
});

describe("guardCanonicalH2Loss", () => {
  it("acepta el cambio cuando no pierde secciones", () => {
    const after = FULL_DRAFT.replace("- TLS 1.3", "- TLS 1.3 obligatorio");
    assert.equal(guardCanonicalH2Loss(FULL_DRAFT, after, "test"), after);
  });

  it("descarta el cambio que borraría §4 y §6", () => {
    const after = FULL_DRAFT.slice(0, FULL_DRAFT.indexOf("## 4."));
    assert.equal(guardCanonicalH2Loss(FULL_DRAFT, after, "test"), FULL_DRAFT);
  });

  it("repara en vez de descartar si basta cerrar el fence §3", () => {
    const swallowed = FULL_DRAFT.replace("CREATE TABLE certificates (id uuid PRIMARY KEY);\n```", "CREATE TABLE certificates (id uuid PRIMARY KEY);");
    assert.deepEqual(canonicalH2LabelsLost(FULL_DRAFT, swallowed), ["4", "6"]);
    const guarded = guardCanonicalH2Loss(FULL_DRAFT, swallowed, "test");
    assert.deepEqual(canonicalH2LabelsLost(FULL_DRAFT, guarded), []);
  });
});

describe("replaceMddSection3Body con invariante", () => {
  it("no deja que un cuerpo §3 nuevo se coma §4/§6", () => {
    // Cuerpo con fence abierto: sin guarda, §4 y §6 quedarían dentro del bloque SQL.
    const out = replaceMddSection3Body(FULL_DRAFT, "```sql\nCREATE TABLE audit_log (id uuid PRIMARY KEY);");
    assert.deepEqual(canonicalH2LabelsLost(FULL_DRAFT, out), []);
  });
});
