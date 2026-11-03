import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { resolveOtpDevExposeCode } from "./otp-dev-expose.util.js";

describe("resolveOtpDevExposeCode", () => {
  it("en producción nunca expone el código, aunque el flag esté activo", () => {
    assert.equal(resolveOtpDevExposeCode(true, true), false);
    assert.equal(resolveOtpDevExposeCode(false, true), false);
  });

  it("fuera de producción respeta el flag", () => {
    assert.equal(resolveOtpDevExposeCode(true, false), true);
    assert.equal(resolveOtpDevExposeCode(false, false), false);
  });
});
