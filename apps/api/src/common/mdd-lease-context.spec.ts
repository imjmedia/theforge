import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getActiveMddLeaseFence, runWithMddLeaseContext } from "./mdd-lease-context.js";

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

describe("mdd-lease-context", () => {
  it("fuera de un contexto no hay fence", () => {
    assert.equal(getActiveMddLeaseFence(), undefined);
  });

  it("dentro de runWithMddLeaseContext devuelve el fence, también tras await", async () => {
    await runWithMddLeaseContext({ fence: 42, key: "p:s" }, async () => {
      assert.equal(getActiveMddLeaseFence(), 42);
      await sleep(5);
      assert.equal(getActiveMddLeaseFence(), 42);
    });
  });

  it("al salir del contexto vuelve a undefined, incluso si fn lanza", async () => {
    assert.throws(() => runWithMddLeaseContext({ fence: 7, key: "p:s" }, () => { throw new Error("boom"); }), /boom/);
    assert.equal(getActiveMddLeaseFence(), undefined);
  });

  it("un contexto anidado sustituye al exterior y lo restaura al salir", () => {
    runWithMddLeaseContext({ fence: 1, key: "a:_" }, () => {
      runWithMddLeaseContext({ fence: 2, key: "b:_" }, () => {
        assert.equal(getActiveMddLeaseFence(), 2);
      });
      assert.equal(getActiveMddLeaseFence(), 1);
    });
  });

  it("los pasos de un generador asíncrono ven el fence cuando cada next() se ejecuta en el contexto", async () => {
    async function* gen() {
      yield getActiveMddLeaseFence();
      await sleep(2);
      yield getActiveMddLeaseFence();
    }
    const it = gen();
    const first = await runWithMddLeaseContext({ fence: 9, key: "g:_" }, () => it.next());
    const second = await runWithMddLeaseContext({ fence: 9, key: "g:_" }, () => it.next());
    assert.equal(first.value, 9);
    assert.equal(second.value, 9);
    const fuera = await it.return(undefined);
    assert.equal(fuera.done, true);
  });
});
