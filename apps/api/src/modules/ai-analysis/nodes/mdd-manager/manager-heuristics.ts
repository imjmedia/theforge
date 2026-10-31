import {
  INITIAL_TOPIC_PATTERN,
  PLAN_APPROVAL_CONFIRM_PATTERN,
  PLAN_APPROVAL_MAX_CHARS,
  PLAN_HOLD_PATTERN,
  PLAN_MODIFICATION_VERB,
  PLAN_REJECTION_PATTERN,
  REFORMAT_DOCUMENT_PATTERN,
  REGENERATE_ER_DIAGRAM_PATTERN,
  REGENERATE_SECTION_N_PATTERN,
  SHORT_AGREEMENT_PATTERN,
  CONTINUE_REFINING_PATTERN,
} from "./manager-constants.js";
import type { MddComplexityLevel } from "../../state/mdd-state.schema.js";
import { agentsForArchitectSection } from "../../utils/mdd-architect-pipeline.util.js";
import { STACK_SECTION2_REGEX } from "./manager-plan.js";

/** Infiere qué agentes toca la petición a partir del texto (modelo de datos, lógica §5, seguridad, integración). */
export function inferSectionsFromMessage(text: string): string[] {
  // "§3" → "sección 3": `\b` no delimita antes de "§" (no es \w), así los patrones `sección N` cubren ambas grafías.
  const t = (text ?? "").toLowerCase().replace(/§\s*/g, "sección ");
  const out: string[] = [];
  const needsModelOrApi =
    /\b(modelo\s+de\s+datos|modelo\s+datos|tablas?|entidades?|schema|sql|roles?|permisos?|aplicaciones?|secci[oó]n\s*3)\b/i.test(t) ||
    /\b(contratos?\s+api|endpoints?|secci[oó]n\s*4)\b/i.test(t) ||
    /\b(arquitectura|stack|frontend|kubernetes|kubernets|k8s|dokploy|coolify|despliegue|contenedores?|secci[oó]n\s*2)\b/i.test(t) ||
    /\b(base\s+de\s+datos|campo|columna|guardar(?:se)?\s+en|almacenar\s+en|token\s+en\s+bd)\b/i.test(t);
  if (needsModelOrApi) out.push("software_architect");
  // §5 Lógica y Edge Cases: paso dedicado del grafo (`section5`, o dentro de `tail_parallel` al expandir).
  if (/\b(l[oó]gica|edge\s*cases?|casos?\s+(?:de\s+)?borde|casos?\s+l[ií]mite|secci[oó]n\s*5|paso\s*5)\b/i.test(t)) {
    out.push("section5");
  }
  if (
    /\b(seguridad|mfa|2fa|autenticaci[oó]n|autorizaci[oó]n|rbac|secci[oó]n\s*6|paso\s*6)\b/i.test(t) ||
    /\b(?:regenera|actualiza|rehacer).*(?:paso|secci[oó]n)\s*6\b/i.test(t)
  ) {
    out.push("security");
  }
  if (
    /\b(infraestructura|docker|kubernetes|kubernets|k8s|dokploy|coolify|despliegue|secci[oó]n\s*7|secci[oó]n\s*6\.3|6\.3)\b/i.test(t)
  ) {
    out.push("integration");
  }
  if (/\b(secci[oó]n\s*6|6\.3)\b/i.test(t) && !out.includes("security")) {
    out.push("security");
  }
  return [...new Set(out)];
}

/** Cambio concreto sobre stack/despliegue/infra (mensajes cortos que el LLM suele clasificar como reply). */
export function looksLikeExplicitMddModificationRequest(msg: string): boolean {
  const t = (msg ?? "").trim();
  if (t.length < 10) return false;
  if (/^\s*¿/.test(t) && !/\b(cambiar|reemplaz|no\s+se\s+usar|usar[ií]a|sustitu|modific|actualiz)\b/i.test(t)) {
    return false;
  }
  const staleDocComplaint =
    /\b(no\s+veo\s+(los\s+)?cambios|sigue\s+(haciendo\s+)?menci|a[uú]n\s+(dice|menciona|tiene|aparece|contiene)|no\s+se\s+(reflej|aplic|guard)|documento\s+sigue|persiste|sigue\s+igual)\b/i.test(
      t,
    );
  if (
    staleDocComplaint &&
    /\b(kubernetes|kubernets|k8s|dokploy|docker|despliegue|infra|§\s*[67]|secci[oó]n\s*[67]|6\.\d)\b/i.test(t)
  ) {
    return true;
  }
  const changeIntent =
    /\b(no\s+se\s+usar[aá]?|usar[ií]a|usar[aá]?|cambiar|cambio|reemplaz|sustitu|modific|actualiz|eliminar|quitar|en\s+vez\s+de|en\s+lugar\s+de|pasar(?:emos)?\s+a|ajust)\b/i.test(
      t,
    );
  const mddSurface =
    /\b(kubernetes|kubernets|k8s|dokploy|coolify|docker|despliegue|deploy|infra|stack|§\s*[267]|secci[oó]n\s*[267]|6\.\d|7\.)\b/i.test(
      t,
    );
  return changeIntent && mddSurface;
}

/** El Manager no debe afirmar cambios en el MDD con action reply (sin ejecutar agentes). */
export function replyClaimsDocumentWasModified(reply: string): boolean {
  const r = (reply ?? "").trim();
  if (r.length < 20) return false;
  return /\b(ajust[eé]|ajustamos|elimin[eé]|eliminamos|actualic[eé]|modifiqu[eé]|reescrib[ií]|reescribimos|ya\s+no\s+(contiene|menciona|incluye)|sin\s+referencias|sin\s+menciones|qued[oó]\s+(ajustad|actualizad)|hemos\s+(ajustad|actualizad|eliminad|modificad)|no\s+(contiene|menciona|incluye)\s+(ya|más)|se\s+(ajust|actualiz|modific|elimin)[oa]|documento\s+(est[aá]|qued[oó]))\b/i.test(
    r,
  );
}

/** Regeneración completa del MDD (constitución); plan aprobado + pipeline, no solo reply del Manager. */
export function looksLikeFullMddRegenerateRequest(msg: string): boolean {
  const m = (msg ?? "").trim();
  if (m.length < 10) return false;
  if (REGENERATE_ER_DIAGRAM_PATTERN.test(m)) return false;
  if (REFORMAT_DOCUMENT_PATTERN.test(m)) return false;
  return (
    /(?:re)?genera(?:rá|ra|r|mos|da)\s+(?:de\s+nuevo\s+)?(?:todo\s+)?(?:el\s+|la\s+)?(?:mdd|master\s+design\s+document(?:\s*\(mdd\))?|documento\s+(?:maestro|completo))\b/i.test(m) ||
    /\b(?:vuelve|volver)\s+a\s+generar\s+(?:el\s+|la\s+)?(?:mdd|documento)\b/i.test(m) ||
    /\brehacer\s+(?:el\s+|la\s+)?(?:mdd|documento)(?:\s+desde\s+cero)?\b/i.test(m) ||
    /\bactualiza(?:r)?\s+(?:el\s+|la\s+)?(?:mdd|documento)\s+completo\b/i.test(m)
  );
}

/**
 * Usuario pide explícitamente solo generar/regenerar contexto y alcance a partir del documento.
 * Si coincide, delegar solo al Clarifier y fusionar solo sección 1 (no ejecutar el resto del pipeline).
 */
export function looksLikeContextScopeOnlyRequest(msg: string): boolean {
  const m = (msg ?? "").trim().toLowerCase();
  if (m.length < 20) return false;
  return (
    /\b(no\s+)?generaste\s+(el\s+)?contexto\s+y\s+alcance\b/i.test(m) ||
    /\b(genera|generar|generen)\s+(solo\s+)?(el\s+)?contexto\s+y\s+alcance\b/i.test(m) ||
    /\bcontexto\s+y\s+alcance\b.*\b(a\s+partir\s+del\s+documento|del\s+documento|del\s+contenido)\b/i.test(m) ||
    /\b(solo\s+)?contexto\s+y\s+alcance\b.*\b(genera|generar|debes\s+generarlo)\b/i.test(m)
  );
}

export function parseRegenerateSectionNumber(msg: string): number | null {
  const m = (msg ?? "").trim().match(REGENERATE_SECTION_N_PATTERN);
  if (!m) return null;
  const n = parseInt(m[1]!, 10);
  return n >= 1 && n <= 7 ? n : null;
}

/** Mapea número de sección MDD → agente del pipeline (§6 → security). */
export function agentsForMddSection(section: number, complexity?: MddComplexityLevel): string[] {
  if (section === 1) return ["clarifier"];
  if (section >= 2 && section <= 4) return agentsForArchitectSection(section as 2 | 3 | 4, complexity);
  if (section === 5) return ["section5"];
  if (section === 6) return ["security"];
  if (section === 7) return ["integration"];
  return [];
}

export function wantsToContinueRefining(msg: string): boolean {
  return (msg ?? "").trim().length >= 10 && CONTINUE_REFINING_PATTERN.test(msg.trim());
}

export function looksLikeShortAgreement(msg: string): boolean {
  const t = (msg ?? "").trim();
  return t.length <= 80 && SHORT_AGREEMENT_PATTERN.test(t);
}

export type PlanResponseKind =
  /** Afirmación pura ("sí", "me parece bien", "procede"). */
  | "approve"
  /** Afirmación + instrucción adicional ("sí, pero agrega X"): se aprueba Y se arrastra `extra` a los agentes. */
  | "approve_with_extra"
  /** El usuario quiere cambiar/rechazar el plan: se descarta y el mensaje se re-procesa como petición nueva. */
  | "modify"
  /** No es ni aprobación ni rechazo claro (duda, pregunta): re-preguntar sin descartar el plan. */
  | "ambiguous";

export type PlanResponseClassification = { kind: PlanResponseKind; extra?: string };

/**
 * Clasifica la respuesta del usuario al plan pendiente (HITL 4.4).
 * - Empieza afirmando y no trae rechazo explícito → aprueba; si añade texto (verbo de modificación
 *   u otra instrucción) ese texto viaja como `extra`.
 * - Rechazo explícito ("no", "espera", "cancela") o instrucción larga/verbo de modificación sin afirmación → modify.
 * - Mensaje corto sin señal clara ("hmm", "¿qué hace el paso 3?") → ambiguous.
 */
export function classifyPlanResponse(msg: string): PlanResponseClassification {
  const t = (msg ?? "").trim();
  if (!t) return { kind: "ambiguous" };
  const affirmation = PLAN_APPROVAL_CONFIRM_PATTERN.exec(t);
  if (affirmation) {
    const rest = t.slice(affirmation[0].length).replace(/^[\s.,;:!?¡¿\-–—]+/, "").trim();
    if (PLAN_HOLD_PATTERN.test(rest)) return { kind: "modify" };
    if (!rest) return { kind: "approve" };
    // Afirmaciones encadenadas ("sí, adelante", "ok, procede", "adelante con el plan") no son instrucciones extra.
    if (!PLAN_MODIFICATION_VERB.test(rest) && rest.length <= PLAN_APPROVAL_MAX_CHARS) {
      if (PLAN_APPROVAL_CONFIRM_PATTERN.test(rest)) return { kind: "approve" };
      if (/^(?:con\s+(?:el\s+plan|eso|todo)|el\s+plan|todo|gracias|por\s+favor|ahora|ya)\b[^,;]{0,30}$/i.test(rest)) {
        return { kind: "approve" };
      }
    }
    const extra = rest.replace(/^(?:pero|y|aunque|solo\s+que|eso\s+s[ií])\b[\s,:;\-–—]*/i, "").trim();
    return extra ? { kind: "approve_with_extra", extra } : { kind: "approve" };
  }
  if (PLAN_REJECTION_PATTERN.test(t)) return { kind: "modify" };
  if (PLAN_MODIFICATION_VERB.test(t) || t.length > PLAN_APPROVAL_MAX_CHARS) return { kind: "modify" };
  if (looksLikeModificationCommand(t)) return { kind: "modify" };
  return { kind: "ambiguous" };
}

/** Imperativos de cambio que no están en PLAN_MODIFICATION_VERB y suelen venir sin afirmación previa. */
function looksLikeModificationCommand(t: string): boolean {
  return /^(?:quiero|necesito|prefiero|mejor|usa|usar|usemos|pon|haz|hagamos|genera|regenera|revisa|replantea)\b/i.test(t);
}

/**
 * Aprobación del plan pendiente (HITL 4.4): afirmación al inicio del mensaje ("sí", "me parece bien",
 * "claro", "procede", "ok, dale"), con o sin nota adicional ("sí, procede, no olvides §6").
 * El texto extra se obtiene con `getPlanApprovalExtra()`.
 */
export function isPlanApproval(msg: string): boolean {
  const kind = classifyPlanResponse(msg).kind;
  return kind === "approve" || kind === "approve_with_extra";
}

/** Instrucción adicional que acompaña a una aprobación ("sí, pero agrega X" → "pero agrega X"). */
export function getPlanApprovalExtra(msg: string): string | undefined {
  const c = classifyPlanResponse(msg);
  return c.kind === "approve_with_extra" ? c.extra : undefined;
}

/** Infiere qué agentes deben aplicar la propuesta a partir del feedback del auditor. */
export function inferAgentsFromAuditorFeedback(feedback: string): string[] {
  const agents: string[] = [];
  if (
    /\b(modelo\s+de\s+datos|sql|tablas?|fk|clave\s+externa|integridad\s+referencial|references|create\s+table|entidades?)\b/i.test(feedback)
  ) {
    agents.push("software_architect");
  }
  if (STACK_SECTION2_REGEX.test(feedback)) {
    if (!agents.includes("software_architect")) agents.push("software_architect");
  }
  if (/\b(seguridad|auth|mfa|contraseñas?|tokens?|rbac)\b/i.test(feedback)) {
    agents.push("security");
  }
  if (/\b(infra|docker|kubernetes|despliegue|manifest|orquestación)\b/i.test(feedback)) {
    agents.push("integration");
  }
  if (agents.length === 0) agents.push("software_architect");
  return agents;
}

export function looksLikeInitialTopic(msg: string): boolean {
  const t = (msg ?? "").trim();
  return t.length >= 25 && (INITIAL_TOPIC_PATTERN.test(t) || /\b(sistema|plataforma|aplicación|api|backend|servicio)\b.*\b(con|que|para|maneje)\b/i.test(t));
}
