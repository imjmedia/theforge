import { describe, it } from "node:test";
import assert from "node:assert";
import type { MDDStateType } from "../state/index.js";
import { getPlanDirective } from "./mdd-user-brief.js";

const st = (p: Partial<MDDStateType>) => p as unknown as MDDStateType;

describe("getPlanDirective", () => {
  it("incluye lastUserMessage como PRIMER bloque aunque el acumulado y el alcance ya estén poblados", () => {
    const d = getPlanDirective(
      st({
        userInputAccumulated:
          "Petición: Necesito un sistema de gestión de inventarios con almacenes y reportes\n\n---\n\nUsuario: usa PostgreSQL con particiones por almacén",
        clarifiedScope: "Alcance clarificado del sistema de inventarios con varios almacenes y reportes semanales.",
        lastUserMessage: "agrega el módulo de devoluciones con aprobación del supervisor",
      }),
    );
    const idxCurrent = d.indexOf("agrega el módulo de devoluciones");
    assert.ok(idxCurrent >= 0, "la petición actual debe estar en la directiva");
    assert.ok(idxCurrent < d.indexOf("sistema de gestión de inventarios"), "debe ir antes de los bloques acumulados");
    assert.ok(idxCurrent < d.indexOf("PostgreSQL con particiones"));
    assert.ok(d.includes("Alcance clarificado"));
  });

  it("no duplica el mensaje cuando ya está en el acumulado", () => {
    const msg = "agrega el módulo de devoluciones con aprobación del supervisor";
    const d = getPlanDirective(
      st({ userInputAccumulated: `Petición: Sistema de inventarios\n\n---\n\nUsuario: ${msg}`, lastUserMessage: msg }),
    );
    assert.equal(d.split(msg).length - 1, 1);
  });

  it("ignora mensajes triviales/aprobaciones como lastUserMessage", () => {
    for (const trivial of ["sí", "sí, procede", "Me parece bien", "ok", "claro", "no"]) {
      const d = getPlanDirective(
        st({ userInputAccumulated: "Petición: Sistema de inventarios con almacenes y reportes", lastUserMessage: trivial }),
      );
      assert.equal(d.includes(trivial), false, `no debe incluir '${trivial}'`);
      assert.ok(d.includes("Sistema de inventarios"));
    }
  });

  it("sin acumulado ni alcance usa solo el mensaje actual", () => {
    const d = getPlanDirective(st({ lastUserMessage: "Quiero un MDD para una app de reservas de salas" }));
    assert.ok(d.includes("app de reservas de salas"));
  });
});
