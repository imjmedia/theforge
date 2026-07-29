/**
 * @fileoverview Nodo blackboard — espacio compartido de coordinación entre agentes.
 */

import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { HumanMessage } from "@langchain/core/messages";
import type { MDDStateType } from "../state/index.js";
import { extractFirstJsonObject, parseJsonOrThrow } from "../utils/parse-json.js";
import { extractLlmText, invokeLlmWithRetry } from "../utils/mdd-llm-retry.util.js";
import { z } from "zod";

const blackboardOutputSchema = z.object({
    resolution: z.string(),
    reasoning: z.string(),
    impacted_nodes: z.array(z.string())
});

const LOG = (msg: string, ...args: unknown[]) => console.log(`[MDD:Blackboard] ${msg}`, ...args);

/**
 * Nodo Blackboard (El Juez): Resuelve conflictos entre agentes especialistas.
 * Se dispara cuando el Auditor detecta un conflicto técnico insalvable entre agentes 
 * (ej: Seguridad vs Integración).
 */
export function createMddBlackboardNode(llm: BaseChatModel) {
    return async (state: MDDStateType): Promise<Partial<MDDStateType>> => {
        LOG("Iniciando debate técnico para resolver conflictos...");

        const gaps = state.auditorGaps?.critical_gaps || [];
        const conflicts = gaps.filter(g => g.issue.includes("[CONFLICTO]"));

        if (conflicts.length === 0) {
            LOG("No se detectaron etiquetas de [CONFLICTO] explícitas. Usando gaps generales.");
        }

        const prompt = `
Eres el **Juez Técnico (Blackboard)**. Tu misión es resolver un conflicto entre agentes especialistas en el diseño de un sistema.

**Contexto del Proyecto (Constitución):**
${state.clarifiedScope || "No disponible"}

**Conflictos detectados:**
${conflicts.map(c => `- ${c.issue}`).join("\n")}

**Borrador actual (MDD):**
${(state.mddDraft || "").slice(0, 8000)}

**Instrucción:**
Analiza los argumentos de los agentes implícitos en el conflicto. Compara sus propuestas contra la "Constitución" (alcance clarificado). Toma una **Resolución Ejecutiva** que sea técnicamente sólida y coherente con el proyecto.

Responde únicamente con un JSON válido:
{
  "resolution": "La directiva exacta que deben seguir los agentes para resolver el conflicto.",
  "reasoning": "Breve explicación de por qué esta resolución es la mejor.",
  "impacted_nodes": ["software_architect", "security", "integration"]
}
`;

        try {
            const response = await invokeLlmWithRetry(llm, [new HumanMessage(prompt)], {
                tag: "Blackboard",
                maxAttempts: 2,
                isResponseValid: (text) => {
                    const jsonStr = extractFirstJsonObject(text);
                    if (!jsonStr) return false;
                    try {
                        return blackboardOutputSchema.safeParse(JSON.parse(jsonStr)).success;
                    } catch {
                        return false;
                    }
                },
            });
            const text = response ? extractLlmText(response) : "";
            const jsonStr = text.trim() ? extractFirstJsonObject(text) : null;
            if (!jsonStr) throw new Error("No se pudo extraer JSON de resolución.");

            const parsed = parseJsonOrThrow(jsonStr, blackboardOutputSchema);

            LOG("Resolución emitida: %s", parsed.resolution);

            // Inyectamos la resolución como una directiva aceptada
            return {
                acceptedProposalDirective: parsed.resolution,
                blackboardReasoning: parsed.reasoning,
                // Reiniciamos los gaps de conflicto para que el Auditor no vuelva a disparar al Juez inmediatamente
                auditorFeedback: `Resolución del Juez: ${parsed.resolution}`,
                delegateTarget: "sections",
                sectionsToRun: parsed.impacted_nodes
            };
        } catch (err) {
            LOG("Error en el debate del Blackboard (sin resolución tras retries): %s", err instanceof Error ? err.message : String(err));
            return {
                auditorFeedback: "El Juez no pudo emitir una resolución. Revisión manual requerida."
            };
        }
    };
}
