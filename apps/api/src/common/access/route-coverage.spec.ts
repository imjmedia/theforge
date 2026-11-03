/**
 * Cobertura de acceso por proyecto: deniega por defecto.
 *
 * Método de descubrimiento: importación dinámica de cada `*.controller.ts` (vía tsx) y lectura de la
 * metadata real de Nest con `Reflect.getMetadata` (`PATH_METADATA`, `METHOD_METADATA`). Se eligió sobre
 * el escaneo AST porque ve exactamente lo que Nest registra (rutas con array de paths, prefijo de clase,
 * alias apilados) y porque importar los controllers no tiene efectos secundarios (verificado: no abren
 * conexiones ni leen env que lance; solo declaran clases). Si algún controller futuro rompe esa
 * condición, el test de descubrimiento falla con el archivo y el error de importación.
 *
 * Una ruta "requiere scope" (ver `requiresProjectScope`) si no es `@Public` y trae un projectId en la
 * ruta, o pertenece a un controller que recibe el proyecto por body/query. Debe tener `@ProjectScoped`
 * o `@ProjectAccessExempt(motivo)`, o estar en `PENDING`.
 */
import "reflect-metadata";
import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { METHOD_METADATA, PATH_METADATA } from "@nestjs/common/constants";
import { IS_PUBLIC_KEY } from "../decorators/public.decorator.js";
import {
  PROJECT_ACCESS_EXEMPT_KEY,
  PROJECT_SCOPED_KEY,
} from "./project-access.metadata.js";

// ---------------------------------------------------------------------------------------------
// Heurística de "ruta que requiere scope"
// ---------------------------------------------------------------------------------------------

/**
 * Prefijos de ruta donde `:id` NO es un proyecto (usuarios, grupos, instancias, evals...). `sessions` NO está:
 * `sessions/:id*` es un id de sesión, pero cada ruta debe resolver el proyecto de la sesión y llevar
 * `@ProjectAccessExempt(motivo)` (la autorización se hace en el handler con `ProjectAccessService`).
 */
const NON_PROJECT_ID_PREFIXES: readonly string[] = [
  "admin",
  "ai-analysis/eval",
  "auth",
  "design-refs",
  "project-groups",
  "provider-instances",
  "ui-mcp",
  "user-providers",
  "users",
];

/**
 * Controllers que reciben el proyecto por body/query: todas sus rutas requieren scope salvo
 * las de `NO_PROJECT_ROUTES`. (`ai-analysis/eval` queda fuera: es el arnés de evals, solo admin.)
 */
const PROJECT_IN_BODY_OR_QUERY_PREFIXES: readonly string[] = ["ai-analysis", "ai-orchestrator"];

/** Rutas con proyecto en body/query que no caen en un prefijo de la lista anterior. */
const EXTRA_PROJECT_ROUTES: ReadonlySet<string> = new Set(["POST /sessions"]);

/** Rutas dentro de `PROJECT_IN_BODY_OR_QUERY_PREFIXES` que de verdad no tienen proyecto. */
const NO_PROJECT_ROUTES: ReadonlySet<string> = new Set(["GET /ai-analysis/mdd/config"]);

/**
 * Rutas que requieren scope y aún no lo tienen. SOLO PUEDE ENCOGER: al decorar una ruta hay que
 * borrarla de aquí (el spec falla si queda una entrada ya cubierta). Nunca se agregan rutas nuevas:
 * una ruta nueva debe nacer con `@ProjectScoped` o `@ProjectAccessExempt`.
 * Orden alfabético estricto (lo verifica el spec).
 */
const PENDING: ReadonlySet<string> = new Set<string>([
  // Vacía desde el lote 1 de seguridad (2026-11-02): toda ruta nueva debe nacer decorada.
]);

// ---------------------------------------------------------------------------------------------
// Descubrimiento
// ---------------------------------------------------------------------------------------------

const METHOD_NAMES: Record<number, string> = {
  0: "GET",
  1: "POST",
  2: "PUT",
  3: "DELETE",
  4: "PATCH",
  5: "ALL",
  6: "OPTIONS",
  7: "HEAD",
};

interface DiscoveredRoute {
  /** `GET /projects/:id/generation-status` */
  key: string;
  method: string;
  path: string;
  /** Ruta del archivo relativa a `src/`. */
  file: string;
  controller: string;
  handler: string;
  isPublic: boolean;
  scoped: boolean;
  exemptReason: string | undefined;
}

const srcRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function findControllerFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "__fixtures__" || entry.name === "node_modules") continue;
      out.push(...findControllerFiles(full));
    } else if (entry.isFile() && entry.name.endsWith(".controller.ts")) {
      out.push(full);
    }
  }
  return out.sort();
}

function toPaths(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.length ? raw.map(String) : [""];
  return [typeof raw === "string" ? raw : ""];
}

function joinPath(prefix: string, sub: string): string {
  const joined = `${prefix}/${sub}`.replace(/\/{2,}/g, "/").replace(/^\/|\/$/g, "");
  return joined;
}

/** Mismo criterio que `Reflector.getAllAndOverride([handler, clase])`: manda el handler. */
function readMeta<T>(key: string, handler: object, cls: object): T | undefined {
  const own = Reflect.getMetadata(key, handler) as T | undefined;
  return own !== undefined ? own : (Reflect.getMetadata(key, cls) as T | undefined);
}

interface Discovery {
  routes: DiscoveredRoute[];
  importErrors: string[];
  controllerFiles: number;
}

async function discoverRoutes(): Promise<Discovery> {
  const files = findControllerFiles(srcRoot);
  const routes: DiscoveredRoute[] = [];
  const importErrors: string[] = [];

  for (const file of files) {
    const rel = path.relative(srcRoot, file).split(path.sep).join("/");
    let mod: Record<string, unknown>;
    try {
      mod = (await import(pathToFileURL(file).href)) as Record<string, unknown>;
    } catch (err) {
      importErrors.push(`${rel}: ${err instanceof Error ? err.message : String(err)}`);
      continue;
    }
    for (const [exportName, cls] of Object.entries(mod)) {
      if (typeof cls !== "function" || !Reflect.hasMetadata(PATH_METADATA, cls)) continue;
      const proto = (cls as { prototype: object }).prototype;
      const prefixes = toPaths(Reflect.getMetadata(PATH_METADATA, cls));
      for (const handlerName of Object.getOwnPropertyNames(proto)) {
        if (handlerName === "constructor") continue;
        const handler = (proto as Record<string, unknown>)[handlerName];
        if (typeof handler !== "function") continue;
        if (!Reflect.hasMetadata(METHOD_METADATA, handler)) continue;
        const method = METHOD_NAMES[Reflect.getMetadata(METHOD_METADATA, handler) as number] ?? "UNKNOWN";
        const subPaths = toPaths(Reflect.getMetadata(PATH_METADATA, handler));
        const reasonRaw = readMeta<unknown>(PROJECT_ACCESS_EXEMPT_KEY, handler, cls);
        for (const prefix of prefixes) {
          for (const sub of subPaths) {
            const routePath = `/${joinPath(prefix, sub)}`;
            routes.push({
              key: `${method} ${routePath}`,
              method,
              path: routePath,
              file: rel,
              controller: exportName,
              handler: handlerName,
              isPublic: readMeta<boolean>(IS_PUBLIC_KEY, handler, cls) === true,
              scoped: readMeta<unknown>(PROJECT_SCOPED_KEY, handler, cls) !== undefined,
              exemptReason: typeof reasonRaw === "string" ? reasonRaw.trim() : undefined,
            });
          }
        }
      }
    }
  }
  return { routes, importErrors, controllerFiles: files.length };
}

function startsWithPrefix(routePath: string, prefix: string): boolean {
  const p = routePath.replace(/^\//, "");
  return p === prefix || p.startsWith(`${prefix}/`);
}

/** Decide si la ruta debe llevar `@ProjectScoped` / `@ProjectAccessExempt`. Exportada solo para pruebas. */
function requiresProjectScope(route: Pick<DiscoveredRoute, "key" | "path" | "isPublic">): boolean {
  if (route.isPublic) return false;
  if (/:projectId(?![A-Za-z0-9_])/.test(route.path)) return true;
  if (startsWithPrefix(route.path, "projects")) return true;
  const idIsNotProject = NON_PROJECT_ID_PREFIXES.some((p) => startsWithPrefix(route.path, p));
  if (/:id(?![A-Za-z0-9_])/.test(route.path) && !idIsNotProject) return true;
  if (EXTRA_PROJECT_ROUTES.has(route.key)) return true;
  if (
    PROJECT_IN_BODY_OR_QUERY_PREFIXES.some((p) => startsWithPrefix(route.path, p)) &&
    !startsWithPrefix(route.path, "ai-analysis/eval") &&
    !NO_PROJECT_ROUTES.has(route.key)
  ) {
    return true;
  }
  return false;
}

function isCovered(route: DiscoveredRoute): boolean {
  return route.scoped || (route.exemptReason !== undefined && route.exemptReason.length > 0);
}

function describeRoutes(routes: DiscoveredRoute[]): string {
  return routes
    .map((r) => `  - ${r.key}  [${r.file} :: ${r.controller}.${r.handler}]`)
    .join("\n");
}

// ---------------------------------------------------------------------------------------------
// Specs
// ---------------------------------------------------------------------------------------------

describe("cobertura de rutas por proyecto (deniega por defecto)", async () => {
  const { routes, importErrors, controllerFiles } = await discoverRoutes();
  const required = routes.filter(requiresProjectScope);

  it("descubre todos los controllers sin errores de importación", () => {
    assert.deepEqual(importErrors, [], `Controllers que no se pudieron importar:\n${importErrors.join("\n")}`);
    assert.ok(controllerFiles > 0, "no se encontró ningún *.controller.ts");
    assert.ok(routes.length > 0, "no se descubrió ninguna ruta");
  });

  it("las rutas son únicas por método + path", () => {
    const seen = new Set<string>();
    const dup = routes.filter((r) => (seen.has(r.key) ? true : (seen.add(r.key), false)));
    assert.deepEqual(
      dup.map((r) => r.key),
      [],
      `Rutas duplicadas:\n${describeRoutes(dup)}`,
    );
  });

  it("toda ruta que requiere scope lleva @ProjectScoped, @ProjectAccessExempt(motivo) o está en PENDING", () => {
    const uncovered = required.filter((r) => !isCovered(r) && !PENDING.has(r.key));
    assert.equal(
      uncovered.length,
      0,
      `${uncovered.length} ruta(s) con proyecto sin @ProjectScoped ni @ProjectAccessExempt(motivo):\n` +
        `${describeRoutes(uncovered)}\n` +
        "Decóralas (ver common/access/README.md, sección Cobertura). No las agregues a PENDING.",
    );
  });

  it("PENDING solo encoge: ninguna entrada ya cubierta, inexistente o que ya no requiera scope", () => {
    const byKey = new Map(routes.map((r) => [r.key, r]));
    const covered: string[] = [];
    const missing: string[] = [];
    const notRequired: string[] = [];
    for (const key of PENDING) {
      const route = byKey.get(key);
      if (!route) missing.push(key);
      else if (!requiresProjectScope(route)) notRequired.push(key);
      else if (isCovered(route)) covered.push(key);
    }
    assert.deepEqual(covered, [], `Ya cubiertas: retíralas de PENDING:\n  - ${covered.join("\n  - ")}`);
    assert.deepEqual(missing, [], `No existen como ruta: retíralas de PENDING:\n  - ${missing.join("\n  - ")}`);
    assert.deepEqual(
      notRequired,
      [],
      `Ya no requieren scope: retíralas de PENDING:\n  - ${notRequired.join("\n  - ")}`,
    );
  });

  it("PENDING está ordenada alfabéticamente y sin duplicados", () => {
    const list = [...PENDING];
    assert.deepEqual(list, [...list].sort(), "PENDING debe estar ordenada alfabéticamente");
  });

  it("@ProjectAccessExempt exige un motivo no vacío", () => {
    const empty = routes.filter((r) => r.exemptReason !== undefined && r.exemptReason.length === 0);
    assert.equal(empty.length, 0, `@ProjectAccessExempt sin motivo:\n${describeRoutes(empty)}`);
  });

  it("ninguna ruta tiene a la vez @Public y @ProjectScoped", () => {
    const both = routes.filter((r) => r.isPublic && r.scoped);
    assert.equal(
      both.length,
      0,
      `Rutas @Public con @ProjectScoped (contradicción: sin JWT no hay actor):\n${describeRoutes(both)}`,
    );
  });

  it("la heurística clasifica los casos conocidos", () => {
    const r = (key: string, isPublic = false) => {
      const [, p] = key.split(" ");
      return { key, path: p as string, isPublic };
    };
    assert.equal(requiresProjectScope(r("GET /projects/:id")), true);
    assert.equal(requiresProjectScope(r("GET /projects")), true);
    assert.equal(requiresProjectScope(r("GET /sessions/project/:projectId")), true);
    assert.equal(requiresProjectScope(r("GET /sessions/:id")), true);
    assert.equal(requiresProjectScope(r("POST /sessions/:id/chat")), true);
    assert.equal(requiresProjectScope(r("POST /sessions/:id/messages")), true);
    assert.equal(requiresProjectScope(r("PATCH /sessions/:id/context")), true);
    assert.equal(requiresProjectScope(r("GET /users/:id/mcp-secret")), false);
    assert.equal(requiresProjectScope(r("PATCH /project-groups/:id")), false);
    assert.equal(requiresProjectScope(r("GET /plugins/projects/:id/plugin-data/:pluginId")), true);
    assert.equal(requiresProjectScope(r("GET /plugins/installed/:pluginId")), false);
    assert.equal(requiresProjectScope(r("GET /ai-analysis/eval/mdd/cases/:id")), false);
    assert.equal(requiresProjectScope(r("GET /ai-analysis/mdd/config")), false);
    assert.equal(requiresProjectScope(r("POST /ai-analysis/mdd/jobs")), true);
    assert.equal(requiresProjectScope(r("GET /health", true)), false);
    assert.equal(requiresProjectScope(r("GET /projects/:id", true)), false);
  });
});
