import { createHash } from "node:crypto";

/**
 * Serialización JSON estable (claves ordenadas recursivamente). Evita el bug del replacer-array de
 * `JSON.stringify`, que filtra claves anidadas y descartaba `projectId` del hash.
 */
export function stableStringify(value: unknown): string {
  return JSON.stringify(value, (_k, v: unknown) => {
    if (v && typeof v === "object" && !Array.isArray(v)) {
      const sorted: Record<string, unknown> = {};
      for (const k of Object.keys(v as Record<string, unknown>).sort()) {
        sorted[k] = (v as Record<string, unknown>)[k];
      }
      return sorted;
    }
    return v;
  });
}

export interface NodeCacheKeyParts {
  /** Nombre del nodo del grafo. */
  node: string;
  /** Entrada ya extraída del estado por el hash del nodo (incluye `projectId`). */
  input: Record<string, unknown>;
  /** Cadena de modelos efectiva (providerId + modelIds en orden de fallback); ver `describeLlmModelChain`. */
  models: string;
  /** `MDD_PROMPT_VERSION`: cambia al editar cualquier prompt del MDD. */
  promptVersion: string;
}

/**
 * Clave determinista de la caché por nodo: `node:<node>:<sha256(12)>` sobre
 * `{ node, input, models, promptVersion }`. Cambiar el modelo, la versión de prompt, el nodo o la
 * entrada produce otra clave, así un HIT nunca devuelve la salida de un modelo o prompt anterior.
 * Conserva el prefijo `node:<node>:` que usa `NodeCacheService.invalidateNode`.
 */
export function buildNodeCacheKey(parts: NodeCacheKeyParts): string {
  const raw = stableStringify({
    node: parts.node,
    input: parts.input,
    models: parts.models,
    promptVersion: parts.promptVersion,
  });
  const hash = createHash("sha256").update(raw).digest("hex").slice(0, 12);
  return `node:${parts.node}:${hash}`;
}
