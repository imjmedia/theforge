import type { AuditorOutcome } from "@theforge/shared-types";
import type { AuditorGapsState } from "../state/mdd-state.schema.js";

export const MDD_AUDIT_PASS_THRESHOLD = 85;
export const MDD_MIN_AUDIT_CHARS = 200;
export const MDD_MAX_AUDIT_QUESTIONS = 5;

export const MDD_AUDIT_COMPLETE_MESSAGE =
  "No quedan gaps críticos en el MDD. El documento está listo para Spec y entregables.";

export const MDD_AUDIT_DONE_MESSAGE =
  "Auditoría completada. El MDD se actualizó con tus respuestas.";

export const MDD_AUDIT_UNAVAILABLE_MESSAGE =
  "El Auditor no estuvo disponible: el MDD queda sin nota. Reintenta la auditoría más tarde.";

export interface MddAuditQuestionItem {
  sections: string[];
  issue: string;
  sugerenciaPregunta: string;
}

export interface MddAuditQA {
  pregunta: string;
  respuesta: string;
  issue?: string;
}

export interface MddManualAuditState {
  projectId: string;
  stageId: string;
  threadId: string;
  mddDraft: string;
  /** `undefined` = sin nota (Auditor no disponible); nunca se persiste ni se muestra como 0. */
  auditorScore?: number;
  auditorOutcome?: AuditorOutcome;
  auditorFeedback: string;
  auditorGaps: AuditorGapsState | null;
  questionPlan: MddAuditQuestionItem[];
  planCursor: number;
  preguntasRealizadas: number;
  maxPreguntas: number;
  historial: MddAuditQA[];
  ultimaPregunta?: string;
  status: "interviewing" | "done";
  mddComplexity: "LOW" | "MEDIUM" | "HIGH";
}

export type MddManualAuditEvent =
  | {
      type: "audit_complete";
      message: string;
      mddContent: string;
      auditorScore?: number;
      auditorOutcome?: AuditorOutcome;
      gaps?: AuditorGapsState | null;
    }
  | {
      type: "audit_started";
      threadId: string;
      question: string;
      n: number;
      total: number;
      mddContent: string;
      auditorScore?: number;
      auditorOutcome?: AuditorOutcome;
      gaps?: AuditorGapsState | null;
    }
  | {
      type: "question";
      question: string;
      n: number;
      total: number;
      mddContent?: string;
    }
  | {
      type: "done";
      mddContent: string;
      message?: string;
      auditorScore?: number;
      auditorOutcome?: AuditorOutcome;
      gaps?: AuditorGapsState | null;
    }
  | { type: "error"; message: string; code?: string };
