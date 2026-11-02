/**
 * Parser Mermaid real para Node (oráculo de pruebas).
 *
 * Monta las globales mínimas de jsdom que mermaid y DOMPurify necesitan al
 * cargarse (`window`, `document`, `navigator`) y delega en `mermaid.parse`.
 *
 * Solo tooling de pruebas y scripts: NO está registrado en ningún módulo Nest y
 * `tsconfig.build.json` lo excluye del build, de modo que no viaja a `dist` ni a
 * la imagen Docker. En F2 el parser de la API irá en un `worker_thread` para no
 * contaminar el hilo principal con globales de DOM.
 */
import { isMainThread } from "node:worker_threads";
import type { MermaidParseResult, MermaidParser } from "@theforge/shared-types/mermaid-oracle";

// Guardia: este módulo define `window`/`document`/`navigator` en `globalThis`. Cargarlo en el hilo
// principal del proceso de producción (p. ej. por un import accidental desde un módulo Nest) alteraría
// librerías que detectan entorno por esas globales. Es tooling de pruebas, así que leer `NODE_ENV`
// directamente (sin pasar por la capa de configuración) es aceptable.
if (isMainThread && process.env.NODE_ENV === "production") {
  throw new Error(
    "node-mermaid-parser es solo para pruebas y scripts: monta globales de DOM (window/document/navigator) " +
      "y no debe cargarse en el hilo principal de la API en producción. Usa el worker_thread de la fase 2.",
  );
}

interface MermaidLike {
  parse(
    text: string,
    options?: { suppressErrors?: boolean },
  ): Promise<false | { diagramType: string }>;
}

/** Superficie mínima de jsdom que usamos (evita depender de @types/jsdom). */
interface JsdomLike {
  JSDOM: new (
    html: string,
    options?: { pretendToBeVisual?: boolean },
  ) => {
    window: { document: unknown; navigator: unknown };
  };
}

let mermaidPromise: Promise<MermaidLike> | null = null;

function defineGlobal(name: string, value: unknown): void {
  Object.defineProperty(globalThis, name, {
    value,
    configurable: true,
    writable: true,
  });
}

async function loadMermaid(): Promise<MermaidLike> {
  // Las globales deben existir ANTES de importar mermaid (DOMPurify las lee al cargar).
  // Especificador en variable: jsdom no trae tipos y no queremos añadir @types/jsdom.
  const jsdomSpecifier = "jsdom";
  const { JSDOM } = (await import(jsdomSpecifier)) as unknown as JsdomLike;
  const dom = new JSDOM("<!doctype html><html><body></body></html>", {
    pretendToBeVisual: true,
  });
  defineGlobal("window", dom.window);
  defineGlobal("document", dom.window.document);
  // `navigator` es un getter de solo lectura en Node >= 21: hay que redefinirlo.
  defineGlobal("navigator", dom.window.navigator);

  const mod = (await import("mermaid")) as unknown as {
    default: MermaidLike;
  };
  return mod.default;
}

function getMermaid(): Promise<MermaidLike> {
  if (!mermaidPromise) {
    mermaidPromise = loadMermaid().catch((err: unknown) => {
      // No cachear el fallo: un reintento posterior puede funcionar.
      mermaidPromise = null;
      throw err;
    });
  }
  return mermaidPromise;
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

/** Errores que indican un entorno roto (DOM ausente), no un diagrama inválido. */
function isEnvironmentError(err: unknown): boolean {
  if (err instanceof ReferenceError) return true;
  const msg = errorMessage(err);
  return /DOMPurify|(document|window|navigator) is not defined|document is not/i.test(
    msg,
  );
}

/**
 * Crea un parser que valida el texto de un diagrama con el parser real de
 * mermaid dentro de jsdom. Nunca lanza: devuelve `ok`, `invalid` (mensaje real
 * del parser) o `unavailable` (fallo de entorno; no implica diagrama inválido).
 */
export function createNodeMermaidParser(): MermaidParser {
  return async (text: string): Promise<MermaidParseResult> => {
    let mermaid: MermaidLike;
    try {
      mermaid = await getMermaid();
    } catch (err) {
      return { status: "unavailable", error: errorMessage(err) };
    }
    try {
      const result = await mermaid.parse(text, { suppressErrors: false });
      if (result === false) {
        return { status: "invalid", error: "mermaid.parse devolvió false" };
      }
      return { status: "ok", diagramType: result.diagramType };
    } catch (err) {
      if (isEnvironmentError(err)) {
        return { status: "unavailable", error: errorMessage(err) };
      }
      return { status: "invalid", error: errorMessage(err) };
    }
  };
}
