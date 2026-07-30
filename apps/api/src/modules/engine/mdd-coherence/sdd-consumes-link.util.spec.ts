import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  extractForeignKeyReferrersByTable,
  extractForeignKeyTargetsByTable,
  extractTableRefsFromSql,
  inferConsumedTableStorageNames,
} from "./sdd-consumes-link.util.js";
import { isExemptPlatformEndpoint } from "./mdd-coherence-exemptions.util.js";

describe("sdd-consumes-link", () => {
  it("extracts schema-qualified tables", () => {
    const sql = `
CREATE TABLE public.users (id UUID PRIMARY KEY);
CREATE TABLE public.roles (id UUID PRIMARY KEY);
`;
    const refs = extractTableRefsFromSql(sql);
    assert.deepEqual(
      refs.map((r) => r.storageName),
      ["public.users", "public.roles"],
    );
    assert.deepEqual(
      refs.map((r) => r.bareName),
      ["users", "roles"],
    );
  });

  it("maps FK REFERENCES between tables", () => {
    const sql = `
CREATE TABLE public.users (id UUID PRIMARY KEY);
CREATE TABLE public.user_roles (
  user_id UUID NOT NULL REFERENCES public.users(id),
  role_id UUID NOT NULL REFERENCES public.roles(id)
);
CREATE TABLE public.roles (id UUID PRIMARY KEY);
`;
    const fk = extractForeignKeyTargetsByTable(sql);
    assert.equal(fk.get("public.user_roles")?.has("public.users"), true);
    assert.equal(fk.get("public.user_roles")?.has("public.roles"), true);
  });

  it("matches path segments to bare table names (not substring false positives)", () => {
    const tables = extractTableRefsFromSql(`
CREATE TABLE public.users (id UUID PRIMARY KEY);
CREATE TABLE public.applications (id UUID PRIMARY KEY);
`);
    const consumed = inferConsumedTableStorageNames("/api/v1/users/{id}", tables);
    assert.ok(consumed.includes("public.users"));
    assert.ok(!consumed.includes("public.applications"));
  });

  it("includes FK targets for matched owner tables", () => {
    const sql = `
CREATE TABLE public.orders (id UUID PRIMARY KEY);
CREATE TABLE public.order_items (
  order_id UUID REFERENCES public.orders(id)
);
`;
    const tables = extractTableRefsFromSql(sql);
    const fk = extractForeignKeyTargetsByTable(sql);
    const consumed = inferConsumedTableStorageNames("/api/v1/orders", tables, fk);
    assert.ok(consumed.includes("public.orders"));
  });

  it("matches hyphen path segments to underscore table names (audit-logs)", () => {
    const tables = extractTableRefsFromSql(`
CREATE TABLE public.audit_logs (id UUID PRIMARY KEY);
`);
    const consumed = inferConsumedTableStorageNames("/api/v1/audit-logs", tables);
    assert.ok(consumed.includes("public.audit_logs"));
  });

  it("matches junction table user_roles from /users/{id}/roles", () => {
    const sql = `
CREATE TABLE public.users (id UUID PRIMARY KEY);
CREATE TABLE public.roles (id UUID PRIMARY KEY);
CREATE TABLE public.user_roles (
  user_id UUID REFERENCES public.users(id),
  role_id UUID REFERENCES public.roles(id)
);
`;
    const tables = extractTableRefsFromSql(sql);
    const fk = extractForeignKeyTargetsByTable(sql);
    const consumed = inferConsumedTableStorageNames("/api/v1/users/{id}/roles", tables, fk);
    assert.ok(consumed.includes("public.user_roles"));
    assert.ok(consumed.includes("public.users"));
    assert.ok(consumed.includes("public.roles"));
  });

  it("expands reverse FK referrers when parent table matches", () => {
    const sql = `
CREATE TABLE public.users (id UUID PRIMARY KEY);
CREATE TABLE public.sessions (user_id UUID REFERENCES public.users(id));
CREATE TABLE public.user_roles (
  user_id UUID REFERENCES public.users(id),
  role_id UUID REFERENCES public.roles(id)
);
CREATE TABLE public.roles (id UUID PRIMARY KEY);
`;
    const tables = extractTableRefsFromSql(sql);
    const fk = extractForeignKeyTargetsByTable(sql);
    const referrers = extractForeignKeyReferrersByTable(fk);
    assert.ok(referrers.get("public.users")?.has("public.sessions"));
    assert.ok(referrers.get("public.users")?.has("public.user_roles"));

    const consumed = inferConsumedTableStorageNames("/api/v1/users", tables, fk);
    assert.ok(consumed.includes("public.sessions"));
    assert.ok(consumed.includes("public.user_roles"));
  });
});

describe("mdd-coherence-exemptions", () => {
  it("exempts platform/auth endpoints", () => {
    assert.equal(isExemptPlatformEndpoint("/health"), true);
    assert.equal(isExemptPlatformEndpoint("/api/v1/health"), true);
    assert.equal(isExemptPlatformEndpoint("/auth/login"), true);
    assert.equal(isExemptPlatformEndpoint("/api/v1/auth/refresh"), true);
    assert.equal(isExemptPlatformEndpoint("/api/v1/orders"), false);
  });
});
