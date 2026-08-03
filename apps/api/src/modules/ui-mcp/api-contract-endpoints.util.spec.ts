import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  inferPageNameFromApiPathSegment,
  matchEndpointsForEntity,
  scoreEndpointEntityMatch,
} from "./api-contract-endpoints.util.js";

describe("api-contract-endpoints — entity matching", () => {
  const endpoints = [
    { method: "GET", path: "/api/v1/keys" },
    { method: "POST", path: "/api/v1/keys" },
    { method: "GET", path: "/api/v1/export-requests" },
    { method: "POST", path: "/api/v1/auth/login" },
    { method: "GET", path: "/api/v1/users" },
  ];

  it("prioriza segmento final keys para cryptographic_keys", () => {
    const matched = matchEndpointsForEntity("cryptographic_keys", endpoints);
    assert.ok(matched.some((e) => e.path === "/api/v1/keys"));
    assert.equal(matched[0]?.path, "/api/v1/keys");
    assert.ok(!matched.some((e) => e.path === "/api/v1/export-requests"));
  });

  it("export_requests no roba endpoints de keys", () => {
    const matched = matchEndpointsForEntity("export_requests", endpoints);
    assert.ok(matched.some((e) => e.path === "/api/v1/export-requests"));
    assert.ok(!matched.some((e) => e.path === "/api/v1/keys"));
  });

  it("login auth endpoint puntúa alto para stories auth", () => {
    const score = scoreEndpointEntityMatch("auth-login", {
      method: "POST",
      path: "/api/v1/auth/login",
    });
    assert.ok(score >= 20);
  });

  it("inferPageNameFromApiPathSegment produce KeysPage y LoginPage", () => {
    assert.equal(inferPageNameFromApiPathSegment("keys"), "KeysPage");
    assert.equal(inferPageNameFromApiPathSegment("auth"), "LoginPage");
  });
});
