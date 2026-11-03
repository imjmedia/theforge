/**
 * Auditoría manual del MDD — mismo patrón que Phase0ManualAudit.
 */

import { useCallback, useRef, useState } from "react";
import { Check, ClipboardCheck, Loader2, Send, AlertTriangle } from "lucide-react";
import { apiFetch, API_BASE } from "../utils/apiClient";
import {
  formatUserFacingThrownError,
  parseApiErrorPayloadFromResponse,
} from "../utils/httpError";
import {
  isModelsUnavailableStreamError,
  resolvePhase0ErrorMessage,
} from "../utils/llm-stream-error";
import type { AuditorOutcome } from "@theforge/shared-types";
import { useWorkshopStore } from "../store/workshopStore";
import { WorkshopPanelButton, WorkshopButtonIcon } from "./WorkshopButtons";

type AuditUiStatus = "idle" | "loading" | "interviewing" | "complete" | "error";

type MddAuditPayload = {
  type?: string;
  message?: string;
  code?: string;
  threadId?: string;
  mddContent?: string;
  auditorScore?: number;
  /** `unavailable` = el Auditor no entregó nota (se muestra "sin nota", nunca 0). */
  auditorOutcome?: AuditorOutcome;
  gaps?: unknown;
  question?: string;
  n?: number;
  total?: number;
};

interface Props {
  projectId: string;
  stageId?: string | null;
  /** MDD en pantalla (incluye cambios sin guardar) */
  mddContent?: string | null;
  onUpdated?: () => void | Promise<void>;
  variant?: "inline" | "panel";
  /** true mientras el chat MDD escribe el documento: auditar escribiría el editor y se perdería el stream. */
  disabled?: boolean;
}

export function MddManualAudit({
  projectId,
  stageId,
  mddContent,
  onUpdated,
  variant = "panel",
  disabled = false,
}: Props) {
  const [status, setStatus] = useState<AuditUiStatus>("idle");
  const [threadId, setThreadId] = useState<string | null>(null);
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [preguntaN, setPreguntaN] = useState(0);
  const [totalPreguntas, setTotalPreguntas] = useState(0);
  const [completeMessage, setCompleteMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [noScore, setNoScore] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const applyMddContent = useCallback((content?: string) => {
    if (content?.trim()) {
      useWorkshopStore.getState().setMddContent(content.trim());
    }
  }, []);

  const startAudit = useCallback(async () => {
    if (disabled || !projectId?.trim()) return;
    setStatus("loading");
    setError(null);
    setCompleteMessage(null);
    setThreadId(null);

    try {
      const body: Record<string, string> = { projectId: projectId.trim() };
      if (stageId?.trim()) body.stageId = stageId.trim();
      if (mddContent?.trim()) body.mddContent = mddContent.trim();

      const res = await apiFetch(`${API_BASE}/ai-analysis/mdd/audit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const { message, code } = await parseApiErrorPayloadFromResponse(
          res,
          "No se pudo ejecutar la auditoría del MDD",
        );
        const payload = { message, code };
        if (isModelsUnavailableStreamError(payload)) {
          useWorkshopStore.getState().setModelsUnavailableModalOpen(true);
        }
        throw new Error(resolvePhase0ErrorMessage(payload));
      }

      const data = (await res.json()) as MddAuditPayload;

      if (data.type === "error") {
        throw new Error(resolvePhase0ErrorMessage(data));
      }

      setNoScore(data.auditorOutcome === "unavailable");

      if (data.type === "audit_complete") {
        setCompleteMessage(
          data.message ?? "No quedan gaps críticos en el MDD.",
        );
        applyMddContent(data.mddContent);
        setStatus("complete");
        await onUpdated?.();
        return;
      }

      if (data.type === "audit_started" && data.threadId && data.question) {
        setThreadId(data.threadId);
        setQuestion(data.question);
        setPreguntaN(data.n ?? 1);
        setTotalPreguntas(data.total ?? 1);
        applyMddContent(data.mddContent);
        setStatus("interviewing");
        setAnswer("");
        setTimeout(() => inputRef.current?.focus(), 100);
        return;
      }

      throw new Error("Respuesta inesperada de la auditoría del MDD");
    } catch (e) {
      setError(formatUserFacingThrownError(e, "No se pudo ejecutar la auditoría del MDD"));
      setStatus("error");
    }
  }, [projectId, stageId, mddContent, onUpdated, applyMddContent, disabled]);

  const handleAnswer = useCallback(async () => {
    if (disabled || !answer.trim() || !threadId || isSubmitting) return;
    const currentAnswer = answer.trim();
    setAnswer("");
    setIsSubmitting(true);
    setError(null);

    try {
      const body: Record<string, string> = {
        threadId,
        answer: currentAnswer,
        projectId,
      };
      if (stageId?.trim()) body.stageId = stageId.trim();

      const res = await apiFetch(`${API_BASE}/ai-analysis/mdd/audit/answer`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const { message, code } = await parseApiErrorPayloadFromResponse(
          res,
          "No se pudo enviar tu respuesta",
        );
        const payload = { message, code };
        if (isModelsUnavailableStreamError(payload)) {
          useWorkshopStore.getState().setModelsUnavailableModalOpen(true);
        }
        throw new Error(resolvePhase0ErrorMessage(payload));
      }

      const data = (await res.json()) as MddAuditPayload;

      if (data.type === "error") {
        throw new Error(resolvePhase0ErrorMessage(data));
      }

      if (data.type === "done") {
        if (data.auditorOutcome) setNoScore(data.auditorOutcome === "unavailable");
        setCompleteMessage(data.message ?? "Auditoría del MDD completada.");
        applyMddContent(data.mddContent);
        setStatus("complete");
        setThreadId(null);
        await onUpdated?.();
        return;
      }

      if (data.type === "question" && data.question) {
        setQuestion(data.question);
        setPreguntaN(data.n ?? 1);
        if (typeof data.total === "number") setTotalPreguntas(data.total);
        applyMddContent(data.mddContent);
        setTimeout(() => inputRef.current?.focus(), 100);
        return;
      }

      throw new Error("Respuesta inesperada al enviar tu respuesta");
    } catch (e) {
      setError(formatUserFacingThrownError(e, "No se pudo enviar tu respuesta"));
      setStatus("error");
    } finally {
      setIsSubmitting(false);
    }
  }, [answer, threadId, isSubmitting, projectId, stageId, onUpdated, applyMddContent, disabled]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey && status === "interviewing") {
      e.preventDefault();
      void handleAnswer();
    }
  };

  const reset = () => {
    setStatus("idle");
    setThreadId(null);
    setQuestion("");
    setAnswer("");
    setError(null);
    setCompleteMessage(null);
    setNoScore(false);
  };

  const wrapperClass =
    variant === "inline"
      ? "mt-4 w-full max-w-lg"
      : "rounded-lg border border-[var(--border)] bg-[color-mix(in_oklch,var(--muted)_20%,var(--card))] p-4";

  return (
    <div className={wrapperClass}>
      {status === "idle" && (
        <div className="flex flex-col gap-2">
          <p className="text-xs text-[var(--muted-foreground)] leading-relaxed">
            ¿Crees que el MDD está al 100%? Ejecuta una auditoría: validará el documento visible
            y, si falta algo, te hará preguntas puntuales.
          </p>
          <div>
            <WorkshopPanelButton
              tone="secondary"
              onClick={() => void startAudit()}
              disabled={disabled}
              title={disabled ? "No disponible mientras se genera el documento" : undefined}
            >
              <WorkshopButtonIcon icon={ClipboardCheck} tone="secondary" />
              Auditar MDD
            </WorkshopPanelButton>
          </div>
        </div>
      )}

      {status === "loading" && (
        <div className="flex items-center gap-2 text-sm text-[var(--foreground-subtle)]">
          <Loader2 className="w-4 h-4 animate-spin shrink-0" />
          <span>Analizando completitud del MDD…</span>
        </div>
      )}

      {status === "complete" && completeMessage && (
        <div className="flex flex-col gap-3">
          <div className="flex items-start gap-2 rounded-lg border border-[color-mix(in_oklch,var(--success)_35%,var(--border))] bg-[color-mix(in_oklch,var(--success)_10%,var(--card))] p-3">
            <Check className="w-5 h-5 shrink-0 text-[color-mix(in_oklch,var(--success)_88%,var(--foreground))]" />
            <p className="text-sm text-[var(--foreground)] leading-relaxed">{completeMessage}</p>
          </div>
          {noScore && (
            <p className="text-xs text-[var(--foreground-subtle)]">Sin nota (auditoría no disponible)</p>
          )}
          <WorkshopPanelButton tone="secondary" onClick={reset}>
            Auditar de nuevo
          </WorkshopPanelButton>
        </div>
      )}

      {status === "interviewing" && (
        <div className="flex flex-col gap-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-[var(--primary)]">
            Auditoría MDD · Pregunta {preguntaN} de {totalPreguntas}
          </p>
          {noScore && (
            <p className="text-xs text-[var(--foreground-subtle)]">Sin nota (auditoría no disponible)</p>
          )}
          {isSubmitting && (
            <div className="flex items-center gap-2 text-sm text-[var(--foreground-subtle)]">
              <Loader2 className="w-4 h-4 animate-spin shrink-0" />
              <span>Actualizando MDD…</span>
            </div>
          )}
          <div className="rounded-lg border border-[color-mix(in_oklch,var(--primary)_20%,var(--border))] bg-[color-mix(in_oklch,var(--primary)_8%,var(--card))] p-3">
            <p className="text-sm text-[var(--foreground)]">{question}</p>
          </div>
          <textarea
            ref={inputRef}
            value={answer}
            onChange={(e) => setAnswer(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={isSubmitting || disabled}
            placeholder="Tu respuesta…"
            rows={3}
            className="w-full rounded-lg border border-[var(--border)] bg-[color-mix(in_oklch,var(--muted)_50%,var(--card))] p-3 text-sm text-[var(--foreground)] outline-none focus:ring-2 focus:ring-[var(--primary)] resize-none"
          />
          <div className="flex justify-end">
            <WorkshopPanelButton
              tone="primary"
              onClick={() => void handleAnswer()}
              disabled={!answer.trim() || isSubmitting || disabled}
              loading={isSubmitting}
            >
              <WorkshopButtonIcon icon={Send} tone="primary" />
              Enviar respuesta
            </WorkshopPanelButton>
          </div>
        </div>
      )}

      {status === "error" && (
        <div className="flex flex-col gap-2">
          <div className="flex items-start gap-2 text-sm text-[color-mix(in_oklch,var(--destructive)_88%,var(--foreground))]">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{error ?? "Error en la auditoría"}</span>
          </div>
          <WorkshopPanelButton tone="secondary" onClick={reset}>
            Reintentar
          </WorkshopPanelButton>
        </div>
      )}
    </div>
  );
}
