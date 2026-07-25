/**
 * @fileoverview Análisis de impacto de cambios en secciones MDD.
 */

import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { HumanMessage } from "@langchain/core/messages";
import type { MDDStateType } from "../state/index.js";

/**
 * Genera un resumen del impacto de los nuevos requisitos sobre el diseño actual.
 * Compara el borrador actual (tablas, endpoints) con la nueva petición del usuario.
 */
export async function generateImpactAnalysis(
    llm: BaseChatModel,
    state: MDDStateType,
    newInput: string
): Promise<string> {
    const currentDraft = state.mddDraft ?? "";
    if (!currentDraft.trim()) return "";

    const prompt = `
Eres un **Analista de Impacto Arquitectónico**. Tu tarea es evaluar cómo los nuevos requisitos del usuario afectarán el diseño actual del Master Design Document (MDD).

**Borrador actual del MDD:**
${currentDraft.slice(0, 15000)} ... [truncado si es muy largo]

**Nuevos requisitos / Petición del usuario:**
${newInput}

**Tu objetivo:** 
Identifica qué elementos del diseño actual sufrirán cambios. Sé específico pero conciso.
Indica claramente:
- Cuántas tablas se verán afectadas (creadas, modificadas, eliminadas).
- Cuántos contratos de API (endpoints) cambiarán.
- Impacto en Seguridad o Infraestructura si aplica.

**Formato de respuesta (Markdown):**
"Este cambio impactará a X tablas y Y contratos API. Específicamente:
- **Tablas:** {lista breve de cambios en tablas}
- **API:** {lista breve de cambios en endpoints}
- **Otros:** {otros impactos si existen}"

Si el impacto es mínimo o nulo, indica "Impacto mínimo: solo ajustes de documentación".

Responde solo con el resumen del impacto en español.
`.trim();

    try {
        const response = await llm.invoke([new HumanMessage(prompt)]);
        return typeof response.content === "string" ? response.content.trim() : "";
    } catch (error) {
        console.error("[ImpactAnalysis] Error generating analysis:", error);
        return "Error al generar el análisis de impacto.";
    }
}
