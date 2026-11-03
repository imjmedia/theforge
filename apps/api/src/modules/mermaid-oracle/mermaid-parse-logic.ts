/**
 * Parser Mermaid real (jsdom + mermaid). Usado en worker_thread y en tooling de pruebas.
 */
import type { MermaidParseResult, MermaidParser } from "@theforge/shared-types/mermaid-oracle";

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
  const jsdomSpecifier = "jsdom";
  const { JSDOM } = (await import(jsdomSpecifier)) as unknown as JsdomLike;
  const dom = new JSDOM("<!doctype html><html><body></body></html>", {
    pretendToBeVisual: true,
  });
  defineGlobal("window", dom.window);
  defineGlobal("document", dom.window.document);
  defineGlobal("navigator", dom.window.navigator);

  const mod = (await import("mermaid")) as unknown as {
    default: MermaidLike;
  };
  return mod.default;
}

function getMermaid(): Promise<MermaidLike> {
  if (!mermaidPromise) {
    mermaidPromise = loadMermaid().catch((err: unknown) => {
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
 * Valida el cuerpo de un diagrama con el parser real de mermaid dentro de jsdom.
 * Nunca lanza: devuelve `ok`, `invalid` o `unavailable`.
 */
export async function parseMermaidDiagram(text: string): Promise<MermaidParseResult> {
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
}

/** Parser inyectable para tests y scripts en el hilo actual (no usar en producción HTTP). */
export function createNodeMermaidParser(): MermaidParser {
  return (body: string) => parseMermaidDiagram(body);
}
