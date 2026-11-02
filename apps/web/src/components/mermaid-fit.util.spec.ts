import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  clampPanZoomScale,
  computeMermaidFitTransform,
  PAN_ZOOM_MAX,
  PAN_ZOOM_MIN,
} from "./mermaid-fit.util.js";

describe("computeMermaidFitTransform", () => {
  it("centers and scales content to fit viewport", () => {
    const fit = computeMermaidFitTransform(1000, 800, 2000, 1000, 0);
    assert.equal(fit.scale, 0.5);
    assert.equal(fit.x, 0);
    assert.equal(fit.y, 150);
  });

  it("respects padding", () => {
    const fit = computeMermaidFitTransform(500, 500, 400, 400, 50);
    assert.ok(Math.abs(fit.scale - 1) < 1e-9);
    assert.ok(Math.abs(fit.x - 50) < 1e-9);
    assert.ok(Math.abs(fit.y - 50) < 1e-9);
  });

  it("devuelve la identidad si el viewport o el contenido miden 0", () => {
    const identity = { scale: 1, x: 0, y: 0 };
    assert.deepEqual(computeMermaidFitTransform(0, 800, 100, 100, 0), identity);
    assert.deepEqual(computeMermaidFitTransform(800, 0, 100, 100, 0), identity);
    assert.deepEqual(computeMermaidFitTransform(800, 600, 0, 100, 0), identity);
    assert.deepEqual(computeMermaidFitTransform(800, 600, 100, 0, 0), identity);
  });

  it("limita la escala al rango de zoom permitido", () => {
    assert.equal(computeMermaidFitTransform(1000, 1000, 1, 1, 0).scale, PAN_ZOOM_MAX);
    assert.equal(computeMermaidFitTransform(100, 100, 100000, 100000, 0).scale, PAN_ZOOM_MIN);
    assert.equal(clampPanZoomScale(1), 1);
  });
});
