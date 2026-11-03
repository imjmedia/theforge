/**
 * Versión de los prompts del pipeline MDD. Forma parte de la clave de la caché por nodo
 * (`checkpoint/node-cache-key.ts`): cambiar cualquier `prompts/mdd/*.md` o `prompts/benchmark/*.md`
 * altera el hash y invalida todas las salidas cacheadas.
 *
 * Derivado en runtime por `computeMddPromptVersion()` (SHA-256 del contenido de esos archivos).
 * No hace falta bump manual al editar prompts.
 */
export { MDD_PROMPT_VERSION, computeMddPromptVersion } from "./compute-mdd-prompt-version.js";
