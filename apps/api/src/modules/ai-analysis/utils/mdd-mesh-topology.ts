/**
 * @fileoverview Formateo de directivas internas para comunicación entre agentes.
 */

import type { MDDStateType } from "../state/index.js";

/**
 * Formatea las directivas internas recibidas para un nodo específico.
 * Mesh Topology: permite que los agentes lean avisos de otros agentes.
 */
export function getInternalDirectivesContext(state: MDDStateType, nodeName: string): string {
    const directives = state.internalDirectives ?? [];
    const incoming = directives.filter((d) => d.to === nodeName || d.to === "all");

    if (incoming.length === 0) return "";

    return [
        "\n---",
        "**MENSAJES INTERNOS DE OTROS AGENTES (Mesh Topology):**",
        ...incoming.map((d) => `- **De ${d.from}:** ${d.message}`),
        "Debes tener en cuenta estos avisos técnicos críticos al redactar tu sección.",
        "---\n"
    ].join("\n");
}

/**
 * Extrae directivas internas de la respuesta de un agente si usa el formato [DIRECTIVE: target] mensaje.
 * Mesh Topology: permite que los agentes envíen avisos a otros agentes.
 */
export function extractInternalDirectives(text: string, fromNode: string): Array<{ from: string; to: string; message: string }> {
    const directives: Array<{ from: string; to: string; message: string }> = [];
    // Formato: [DIRECTIVE: TargetNode] Mensaje
    // Ejemplo: [DIRECTIVE: software_architect] Los puertos 80 y 443 deben estar abiertos en infra.
    const regex = /\[DIRECTIVE:\s*(\w+|all)\]\s*([^\n\[]+)/gi;
    let match;
    while ((match = regex.exec(text)) !== null) {
        if (match[1] && match[2]) {
            directives.push({
                from: fromNode,
                to: match[1].trim().toLowerCase(),
                message: match[2].trim()
            });
        }
    }
    return directives;
}
