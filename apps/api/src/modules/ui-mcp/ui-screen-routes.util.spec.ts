import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { inferPageComponentName } from "./ui-screen-routes.util.js";

describe("inferPageComponentName (CHANGELOG [Unreleased] → Fixed → 'Pantallas: PascalCase limpio')", () => {
  it("snake_case → PascalCase limpio (AppPackages, no App_packages)", () => {
    assert.equal(inferPageComponentName("Gestionar app_packages"), "GestionarAppPackagesPage");
  });

  it("kebab-case → PascalCase limpio", () => {
    assert.equal(inferPageComponentName("Gestionar app-packages"), "GestionarAppPackagesPage");
  });

  it("SCREAMING_SNAKE_CASE → PascalCase limpio", () => {
    assert.equal(inferPageComponentName("APP_PACKAGES"), "AppPackagesPage");
  });

  it("multi-palabra con espacios → PascalCase", () => {
    assert.equal(inferPageComponentName("Chat del copiloto"), "ChatDelCopilotoPage");
    assert.equal(inferPageComponentName("Dashboard ejecutivo"), "DashboardEjecutivoPage");
  });

  it("acentos se normalizan a ASCII (NFD + strip combining marks)", () => {
    assert.equal(inferPageComponentName("Gestión de app_packages"), "GestionDeAppPackagesPage");
    assert.equal(inferPageComponentName("Inicio de sesión"), "InicioDeSesionPage");
    assert.equal(inferPageComponentName("Bitácora de peticiones"), "BitacoraDePeticionesPage");
  });

  it("string vacío o solo separadores → ScreenPage (fallback)", () => {
    assert.equal(inferPageComponentName(""), "ScreenPage");
    assert.equal(inferPageComponentName("   "), "ScreenPage");
    assert.equal(inferPageComponentName("---"), "ScreenPage");
  });

  it("mayúsculas iniciales se preservan solo en la primera letra (PascalCase, no ALL_CAPS)", () => {
    assert.equal(inferPageComponentName("GESTION"), "GestionPage");
  });

  it("dígitos se preservan", () => {
    assert.equal(inferPageComponentName("renovación 2026"), "Renovacion2026Page");
  });
});

