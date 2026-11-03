import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { installBigIntJsonSupport } from "./json-bigint.js";

describe("installBigIntJsonSupport", () => {
  it("serializa un BigInt seguro como número", () => {
    installBigIntJsonSupport();
    assert.equal(JSON.stringify({ a: BigInt(10) }), '{"a":10}');
  });

  it("es idempotente", () => {
    installBigIntJsonSupport();
    installBigIntJsonSupport();
    assert.equal(JSON.stringify([BigInt(1730000000000)]), "[1730000000000]");
  });

  it("lanza RangeError si el BigInt supera Number.MAX_SAFE_INTEGER", () => {
    installBigIntJsonSupport();
    const unsafe = BigInt(Number.MAX_SAFE_INTEGER) + BigInt(1);
    assert.throws(() => JSON.stringify({ a: unsafe }), RangeError);
  });
});
