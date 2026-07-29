/**
 * @fileoverview Nodo de integración — maneja especificaciones de integración.
 */

import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type { MDDStateType } from "../state/index.js";
import { createMddSecurityNode } from "./mdd-security.node.js";
import { createMddIntegrationNode } from "./mdd-integration.node.js";
import { getMddDraftSummary, replaceSection6Or7InDraft } from "../utils/mdd-sanitize.js";
import { resolveSection7BodyForMerge } from "../utils/mdd-tail-parallel.util.js";
import type { MddStructured } from "../state/mdd-structured.schema.js";

const LOG = (msg: string, ...args: unknown[]) => console.log(`[MDD:SecurityIntegration] ${msg}`, ...args);

/**
 * Nodo combinado: ejecuta Security e Integration en paralelo (Promise.all).
 * Security genera §6, Integration genera §7 independientemente del mismo state base.
 * Combina el resultado: draft de Security (con §6) + §7 extraído de Integration.
 * Ahorra ~60s vs ejecución secuencial (Integration se solapa con Security).
 */
export function createMddSecurityIntegrationNode(llm: BaseChatModel) {
  const securityFn = createMddSecurityNode(llm);
  const integrationFn = createMddIntegrationNode(llm);

  return async (state: MDDStateType): Promise<Partial<MDDStateType>> => {
    LOG("entry parallel mddDraftLen=%s", (state.mddDraft ?? "").length);

    const [secResult, intResult] = await Promise.all([
      securityFn(state),
      integrationFn(state),
    ]);

    // secResult.mddDraft = base + §6 (Integration no vio §6 → no le afecta)
    // intResult.mddDraft = base + §7 (Security no vio §7 → no le afecta)
    const secDraft = (secResult.mddDraft ?? state.mddDraft ?? "").trim();
    const intDraft = (intResult.mddDraft ?? state.mddDraft ?? "").trim();

    // Extraer §7 del resultado de Integration e inyectarlo en el draft de Security (que tiene §6)
    let finalDraft = secDraft;
    const section7Body = resolveSection7BodyForMerge(intResult, intDraft);
    if (section7Body) {
      finalDraft = replaceSection6Or7InDraft(secDraft, 7, section7Body);
    } else {
      LOG("warn: §7 no encontrado en resultado de Integration, usando solo §6");
    }

    // Merge mddStructured: base = resultado de Security (tiene §6 real); solo tomamos
    // `integracion` de Integration. NO usar shallow spread con intResult al final porque
    // intResult.mddStructured.seguridad viene vacía (hidratada de draft sin §6) y
    // sobrescribiría la §6 real de Security.
    const secStructured = secResult.mddStructured ?? state.mddStructured ?? {};
    const intStructured = intResult.mddStructured;
    const mergedStructured: MddStructured = {
      ...(secStructured as MddStructured),
      ...(intStructured?.integracion !== undefined
        ? { integracion: intStructured.integracion }
        : {}),
    } as MddStructured;

    const directives = [
      ...(Array.isArray((secResult as Record<string, unknown>).internalDirectives) ? (secResult as Record<string, unknown>).internalDirectives as { from: string; to: string; message: string }[] : []),
      ...(Array.isArray((intResult as Record<string, unknown>).internalDirectives) ? (intResult as Record<string, unknown>).internalDirectives as { from: string; to: string; message: string }[] : []),
    ];

    const sum = getMddDraftSummary(finalDraft);
    LOG("ok parallel done finalDraftLen=%s section2=%s §6=%s §7=%s",
      sum.length, sum.section2,
      /##\s+(?:6\.\s*)?Seguridad\b/i.test(finalDraft) ? "✓" : "✗",
      /##\s+(?:7\.\s*)?(?:Infraestructura|Integración)\b/i.test(finalDraft) ? "✓" : "✗",
    );

    return {
      mddDraft: finalDraft,
      mddStructured: mergedStructured,
      ...(directives.length > 0 ? { internalDirectives: directives } : {}),
    };
  };
}
