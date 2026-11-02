import test from "node:test";
import assert from "node:assert/strict";
import { JwtUserCache } from "./jwt-user-cache.js";

class FakeClockCache extends JwtUserCache {
  t = 1_000;
  protected override now(): number {
    return this.t;
  }
}

const u = (id: string) => ({ id, email: `${id}@t.com`, role: "developer", tokenVersion: 0 });

test("JwtUserCache — get/set/invalidate/clear", () => {
  const c = new JwtUserCache();
  assert.equal(c.get("a"), undefined);
  c.set("a", u("a"));
  assert.equal(c.get("a")?.email, "a@t.com");
  c.invalidate("a");
  assert.equal(c.get("a"), undefined);
  c.set("a", u("a"));
  c.set("b", u("b"));
  c.clear();
  assert.equal(c.size, 0);
});

test("JwtUserCache — caduca a los 30 s", () => {
  const c = new FakeClockCache();
  c.set("a", u("a"));
  c.t += JwtUserCache.TTL_MS - 1;
  assert.ok(c.get("a"));
  c.t += 1;
  assert.equal(c.get("a"), undefined);
  assert.equal(c.size, 0);
});

test("JwtUserCache — respeta el tope de entradas evictando la más antigua", () => {
  const c = new FakeClockCache();
  for (let i = 0; i < JwtUserCache.MAX_ENTRIES; i++) c.set(`u${i}`, u(`u${i}`));
  assert.equal(c.size, JwtUserCache.MAX_ENTRIES);
  c.set("nuevo", u("nuevo"));
  assert.equal(c.size, JwtUserCache.MAX_ENTRIES);
  assert.equal(c.get("u0"), undefined);
  assert.ok(c.get("u1"));
  assert.ok(c.get("nuevo"));
});

test("JwtUserCache — al llenarse purga primero las caducadas", () => {
  const c = new FakeClockCache();
  for (let i = 0; i < JwtUserCache.MAX_ENTRIES; i++) c.set(`u${i}`, u(`u${i}`));
  c.t += JwtUserCache.TTL_MS + 1;
  c.set("nuevo", u("nuevo"));
  assert.equal(c.size, 1);
});

test("JwtUserCache — carrera: lectura previa a invalidate no puede cachear la fila vieja", () => {
  const c = new JwtUserCache();
  const gen = c.generation("a"); // A empieza a leer la BD (tokenVersion = 0)
  c.invalidate("a"); // en paralelo se rota el secret: update + invalidate
  assert.equal(c.set("a", { ...u("a"), tokenVersion: 0 }, gen), false); // A llega tarde con la fila vieja
  assert.equal(c.get("a"), undefined);
  // Una lectura posterior (con la generación nueva) sí se guarda.
  assert.equal(c.set("a", { ...u("a"), tokenVersion: 1 }, c.generation("a")), true);
  assert.equal(c.get("a")?.tokenVersion, 1);
});

test("JwtUserCache — set sin generación guarda siempre; invalidar a un usuario no afecta la generación de otro", () => {
  const c = new JwtUserCache();
  const genB = c.generation("b");
  c.invalidate("a");
  assert.equal(c.set("b", u("b"), genB), true);
  assert.equal(c.set("a", u("a")), true);
});

test("JwtUserCache — clear invalida también los set en vuelo", () => {
  const c = new JwtUserCache();
  const gen = c.generation("a");
  c.clear();
  assert.equal(c.set("a", u("a"), gen), false);
  assert.equal(c.set("a", u("a"), c.generation("a")), true);
});

test("JwtUserCache — al pasar el tope de generaciones se reinicia sin dejar colar sets viejos", () => {
  const c = new JwtUserCache();
  const gen = c.generation("viejo");
  for (let i = 0; i < JwtUserCache.MAX_GENERATIONS + 1; i++) c.invalidate(`u${i}`);
  assert.equal(c.set("viejo", u("viejo"), gen), false);
});
