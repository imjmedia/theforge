/**
 * Conversión Mermaid -> Excalidraw serializada con el resto de operaciones de Mermaid.
 *
 * `@excalidraw/mermaid-to-excalidraw` solo llama `mermaid.initialize` cuando cambia el hash de SU config
 * (`lastConfigHash` en `parseMermaid.js`). Como el runtime restaura la config web al terminar cada
 * conversión, a partir de la segunda conversión el hash de la librería no cambia, ella no re-inicializa y
 * convertiría con la config web (curva, tamaño de fuente). Por eso aquí se aplica explícitamente la config
 * que la librería espera ANTES de convertir, y se restaura la web en `finally`.
 *
 * Es puro respecto de React y de `mermaid`: todo entra por `deps`, así se prueba con `node:test`.
 */
import type { MermaidConfig } from "mermaid";
import { EXCALIDRAW_CONVERSION_TIMEOUT_MS } from "./mermaid-runtime";

/**
 * Reproduce la config que `parseMermaid` de la librería (2.2.2) construye al llamarla sin `config`:
 * su `MERMAID_CONFIG` por defecto con `fontSize` resuelto en la raíz y en `themeVariables`.
 */
export function buildExcalidrawLibraryMermaidConfig(
  defaults: Readonly<MermaidConfig>,
): MermaidConfig {
  const fontSize = defaults.themeVariables?.fontSize;
  return {
    ...defaults,
    ...(fontSize !== undefined ? { fontSize: fontSize as unknown as number } : {}),
    themeVariables: {
      ...defaults.themeVariables,
      ...(fontSize !== undefined ? { fontSize } : {}),
    },
  };
}

export interface ExcalidrawExclusiveDeps<T> {
  runExclusive: <R>(task: () => Promise<R>, options?: { timeoutMs?: number }) => Promise<R>;
  /** Aplica una config global de mermaid (solo se llama dentro de `runExclusive`). */
  initializeFor: (config: Readonly<MermaidConfig>) => Promise<void>;
  /** Restaura la config web (solo se llama dentro de `runExclusive`). */
  restoreWebConfig: () => Promise<void>;
  /** Config que la librería de conversión espera tener aplicada. */
  libraryConfig: Readonly<MermaidConfig>;
  /** La conversión en sí (`parseMermaidToExcalidraw`). */
  convert: () => Promise<T>;
  timeoutMs?: number;
}

/**
 * Orden garantizado en cada llamada: `initialize(libraryConfig)` -> `convert` -> `initialize(webConfig)`.
 * La restauración corre aunque la conversión lance o venza el timeout (la cola se libera al vencer; la
 * restauración de una conversión zombi puede llegar tarde, pero cada operación de la cola vuelve a
 * aplicar su propia config antes de actuar).
 */
export function convertMermaidToExcalidrawExclusive<T>(deps: ExcalidrawExclusiveDeps<T>): Promise<T> {
  return deps.runExclusive(
    async () => {
      try {
        await deps.initializeFor(deps.libraryConfig);
        return await deps.convert();
      } finally {
        await deps.restoreWebConfig().catch(() => undefined);
      }
    },
    { timeoutMs: deps.timeoutMs ?? EXCALIDRAW_CONVERSION_TIMEOUT_MS },
  );
}
