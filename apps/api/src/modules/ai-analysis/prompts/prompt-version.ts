/**
 * Versión de los prompts del pipeline MDD. Forma parte de la clave de la caché por nodo
 * (`checkpoint/node-cache-key.ts`): subirla invalida todas las salidas cacheadas.
 *
 * OBLIGATORIO: súbela (string de fecha `AAAA-MM-DD`, o `AAAA-MM-DD.n` si hay varias el mismo día)
 * al cambiar CUALQUIER prompt del MDD (`prompts/mdd/*.md`, `prompts/load-prompts.ts`, fallbacks
 * inline de los nodos o reglas inyectadas en ellos). Si no, un HIT de la caché puede devolver la
 * salida de un prompt antiguo (y el eval mediría prompts viejos con coste $0).
 *
 * Mejora futura (lote posterior): derivar la versión de un hash del contenido de los prompts
 * (`prompts/mdd/*.md` + fallbacks inline) en vez de mantenerla a mano, de modo que un prompt editado sin
 * subir esta constante no pueda servir salidas viejas desde la caché. No implementado aquí a propósito.
 */
export const MDD_PROMPT_VERSION = "2026-11-03";
