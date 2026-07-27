/**
 * @fileoverview Logger de Architecture Decision Records en agentGovernanceContent.
 */

import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { HumanMessage } from "@langchain/core/messages";
import { extractFirstJsonObject, parseJsonOrThrow } from "./parse-json.js";
import { z } from "zod";
import type { PrismaService } from "../../../prisma/prisma.service.js";
import { persistProjectAdrsToGovernance } from "../../engine/mdd-coherence/project-adrs-from-governance.util.js";

const adrExtractionSchema = z.object({
  decisions: z.array(
    z.object({
      title: z.string(),
      context: z.string(),
      consequence: z.string(),
      status: z.enum(["Accepted", "Proposed", "Superseeded"]).optional().default("Accepted"),
    }),
  ),
});

/**
 * Analiza un MDD finalizado y persiste las decisiones arquitectónicas clave (ADRs) en governance.
 */
export async function extractAndLogAdrs(
  llm: BaseChatModel,
  prisma: PrismaService,
  projectId: string,
  mddDraft: string,
) {
  const prompt = `
Analiza el siguiente Master Design Document (MDD) y extrae las decisiones arquitectónicas invariantes más importantes.
Busca decisiones sobre:
- Stack tecnológico y por qué se eligió.
- Patrones de diseño de base de datos (ej: borrado lógico, particionamiento).
- Estrategias de seguridad (ej: MFA obligatorio, tokens en memoria).
- Patrones de comunicación e integración.

Para cada decisión, identifica:
1. **Título**: Nombre corto de la decisión.
2. **Contexto**: El problema o necesidad que motivó la decisión.
3. **Consecuencia**: El impacto técnico resultante (positivo o negativo).

Responde únicamente con un JSON válido siguiendo este esquema:
{
  "decisions": [
    { "title": "...", "context": "...", "consequence": "...", "status": "Accepted" }
  ]
}

MDD:
---
${mddDraft.slice(0, 15000)}
---
`;

  try {
    const response = await llm.invoke([new HumanMessage(prompt)]);
    const text = typeof response.content === "string" ? response.content : "";
    const jsonStr = extractFirstJsonObject(text);
    if (!jsonStr) return;

    const parsed = parseJsonOrThrow(jsonStr, adrExtractionSchema);
    await persistProjectAdrsToGovernance(prisma, projectId, parsed.decisions);
    console.log(
      `[ADRLogger] Extraídas y guardadas ${parsed.decisions.length} decisiones para el proyecto ${projectId}`,
    );
  } catch (err) {
    console.error(`[ADRLogger] Error extrayendo ADRs: ${err instanceof Error ? err.message : String(err)}`);
  }
}
