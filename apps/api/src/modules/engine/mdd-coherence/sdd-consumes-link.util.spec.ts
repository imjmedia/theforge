import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  extractForeignKeyTargetsByTable,
  extractTableRefsFromSql,
  inferConsumedTableStorageNames,
} from "./sdd-consumes-link.util.js";

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
});
