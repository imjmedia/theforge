import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { checkBrdDecisionLogClosure } from "./brd-decision-log.util.js";

const BRD_A = `
## 3. Alcance
El monto es Por validar con el cliente.
Otro punto por validar.

## 6. Riesgos
Plazo Por validar.
`;
const BRD_B = `
## 1. Contexto
Texto general del documento sin pendientes pero suficientemente largo para pasar el umbral mínimo del gate.
Impuesto fiscal % sin dato.
`;

describe("brd-decision-log.util checkBrdDecisionLogClosure", () => {
  it("emite un único aviso con conteo y headings cuando no hay sección de decision log", () => {
    const r = checkBrdDecisionLogClosure(BRD_A);
    assert.equal(r.warnings.length, 1);
    assert.match(r.warnings[0], /3 «Por validar»/);
    assert.match(r.warnings[0], /§3\. Alcance/);
    assert.match(r.warnings[0], /§6\. Riesgos/);
    assert.ok(!r.findings.some((f) => f.ref === "Por validar suelto"));
  });

  it("usa número de línea si no hay heading previo", () => {
    const r = checkBrdDecisionLogClosure("Cuerpo largo sin encabezados que menciona un monto Por validar y suficiente texto para el umbral mínimo del gate.");
    assert.equal(r.warnings.length, 1);
    assert.match(r.warnings[0], /línea 1/);
  });

  it("no arrastra lastIndex entre llamadas seguidas (regresión /g)", () => {
    const aislada = checkBrdDecisionLogClosure(BRD_B);
    checkBrdDecisionLogClosure(BRD_A);
    const trasOtra = checkBrdDecisionLogClosure(BRD_B);
    assert.deepEqual(trasOtra, aislada);
    assert.ok(trasOtra.warnings.some((w) => /fiscal % sin cerrar/.test(w)));
    // y A repetido da lo mismo
    assert.deepEqual(checkBrdDecisionLogClosure(BRD_A), checkBrdDecisionLogClosure(BRD_A));
  });
});
