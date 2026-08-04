import { AlertTriangle, Check, Copy, FileText, Loader2, RefreshCw } from "lucide-react";
import {
  LEGACY_CHANGE_GATE_MESSAGE,
  LEGACY_INTEGRATION_HANDOFF_GATE_MESSAGE,
} from "@theforge/shared-types";
import MddViewer from "@/components/MddViewer";
import LegacyMcpDebugPanel from "@/components/LegacyMcpDebugPanel/LegacyMcpDebugPanel";
import { IntegrationPanel } from "@/components/IntegrationPanel";
import { AiGenerativeDots } from "@/components/AiGenerationLoader";
import {
  LEGACY_CODEBASE_DOC_STEPS,
  LEGACY_DELIVERABLES_STEPS,
  LEGACY_MDD_STEPS,
} from "@/constants/legacy-workshop-loading-steps";
import { type WorkshopLegacyPanelsProps } from "./workshopLegacyPanels.types";

export function WorkshopLegacyPanels({
  centralPanel,
  projectId,
  projectType,
  projectMddContent,
  projectName,
  convergeWebhookUrl,
  canGenerateFromCodebase,
  activeStageId,
  activeLegacyState,
  isStage1Legacy,
  loading,
  loadingReason,
  error,
  legacyStepIndex,
  mddInicialLocalContent,
  mddInicialViewMode,
  mddInicialCopyOk,
  legacyMcpDebugTrace,
  legacyDescriptionInput,
  legacyAnswersInput,
  legacyHandoffGatePending,
  legacyHandoffGateBlocked,
  legacyChangeGateBlocked,
  legacyGenerateBlocked,
  handoffGateStrict,
  legacyAnalyzeDone,
  workshopStagesList,
  activeStageHandoffImportedAt,
  activeStageWorkflowStatus,
  activeStageHandoffSnapshot,
  tasksHydrated,
  tasksSource,
  docTs,
  onCopyMddInicialMarkdown,
  onMddInicialContentChange,
  onLegacyDescriptionChange,
  onLegacyAnswersChange,
  onHandoffGateStrictChange,
  resolveLegacyAnswerValue,
  onNavigatePanel,
  onFetchProject,
  onLegacyUpdateCodebaseDoc,
  onLegacySuggestBrdFromCodebaseDoc,
  onSetBrdWorkshopDraft,
  onLegacyGenerateMdd,
  onLegacyGenerateDeliverables,
  onLegacyGenerateCodebaseDoc,
  onLegacyStart,
  onLegacyAnswer,
}: WorkshopLegacyPanelsProps) {
  return (
    <>
                  {canGenerateFromCodebase ? (
                    <div className="shrink-0 mb-3 rounded-lg border border-[color-mix(in_oklch,var(--primary)_28%,var(--border))] bg-[color-mix(in_oklch,var(--primary)_8%,var(--card))] px-3 py-2.5">
                      <p className="text-sm font-medium text-[color-mix(in_oklch,var(--primary)_65%,var(--foreground))] mb-2">
                        Etapa 1 — Documentación AS-IS
                      </p>
                      <p className="text-xs text-[var(--muted-foreground)] leading-relaxed">
                        Estás en la etapa inicial del proyecto legacy. Los paneles vacíos tienen un botón para generar su documento desde el <strong>MDD Inicial (codebase)</strong>.
                        También puedes ir al panel <strong>MDD</strong> y usar "Generar todos los documentos" para generar todo de una vez.
                      </p>
                    </div>
                  ) : null}
                  {centralPanel === "mdd-inicial" && projectType === "LEGACY" && projectId && (
                    <div className="rounded-lg bg-[color-mix(in_oklch,var(--card)_88%,transparent)] border border-[var(--border)] p-6 text-[color-mix(in_oklch,var(--foreground)_88%,var(--muted-foreground))] text-sm space-y-4 flex flex-col min-h-0 flex-1">
                      <div className="shrink-0 space-y-3">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <p className="min-w-0 flex-1 font-medium text-[color-mix(in_oklch,var(--primary)_88%,var(--foreground))] leading-snug pr-1">
                            MDD Inicial — Documentación del codebase (partida)
                          </p>
                          {(mddInicialLocalContent || activeLegacyState?.codebaseDoc)?.trim() ? (
                            <button
                              type="button"
                              title="Copiar el markdown del MDD inicial al portapapeles (p. ej. para pegar en un chat con IA)"
                              onClick={() => void onCopyMddInicialMarkdown()}
                              className="inline-flex shrink-0 items-center gap-1.5 self-start rounded-md border border-[color-mix(in_oklch,var(--primary)_35%,var(--border))] bg-[color-mix(in_oklch,var(--primary)_12%,var(--card))] px-2.5 py-1.5 text-[11px] font-medium text-[color-mix(in_oklch,var(--primary)_62%,var(--foreground))] hover:bg-[color-mix(in_oklch,var(--primary)_10%,var(--card))]"
                            >
                              {mddInicialCopyOk ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                              {mddInicialCopyOk ? "Copiado" : "Copiar MDD"}
                            </button>
                          ) : null}
                        </div>
                        <p className="text-[var(--foreground-subtle)] text-xs leading-relaxed max-w-3xl">
                          Reconstrucción AS-IS desde el índice Ariadne (`generate_legacy_documentation`): MDD determinista desde Falkor, sin modos alternos de `ask_codebase`. Opcional: puedes ir directo a <strong>Modificación</strong> si solo quieres un cambio puntual.
                        </p>
                      </div>
                      {activeLegacyState?.codebaseDoc || mddInicialLocalContent ? (
                        <>
                          <div className="flex-1 overflow-auto min-h-0 flex flex-col">
                            {mddInicialViewMode === "preview" ? (
                              <div className="rounded border border-[var(--border)] bg-[color-mix(in_oklch,var(--background)_78%,var(--card))] p-4">
                                <MddViewer
                                  content={mddInicialLocalContent || activeLegacyState?.codebaseDoc || ""}
                                  documentTimestamps={docTs("codebaseDoc")}
                                />
                              </div>
                            ) : (
                              <textarea
                                value={mddInicialLocalContent}
                                onChange={(e) => onMddInicialContentChange(e.target.value)}
                                placeholder="# Documentación del Codebase (partida)\n\nGenera la documentación o escribe aquí..."
                                className="flex-1 min-h-[200px] w-full bg-[color-mix(in_oklch,var(--muted)_50%,var(--card))] border border-[var(--border)] rounded-lg p-4 text-sm font-mono text-[var(--foreground)] placeholder:text-[var(--muted-foreground)] focus:ring-2 focus:ring-[var(--primary)] focus:border-transparent outline-none resize-none"
                                spellCheck={false}
                              />
                            )}
                          </div>
                          <LegacyMcpDebugPanel trace={legacyMcpDebugTrace} />
                          <div className="shrink-0 pt-4 border-t border-[var(--border)] mt-4 flex flex-wrap gap-2">
                            <button
                              type="button"
                              onClick={async () => {
                                const hasLocalChanges = mddInicialLocalContent?.trim() && mddInicialViewMode === "source" && mddInicialLocalContent !== (activeLegacyState?.codebaseDoc ?? "");
                                if (hasLocalChanges) await onLegacyUpdateCodebaseDoc(projectId, mddInicialLocalContent);
                                const res = await onLegacySuggestBrdFromCodebaseDoc(projectId, activeStageId ?? undefined);
                                if (res?.brdContent) onSetBrdWorkshopDraft(res.brdContent);
                                onNavigatePanel("brd");
                              }}
                              disabled={loading || !(mddInicialLocalContent || activeLegacyState?.codebaseDoc)?.trim()}
                              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[color-mix(in_oklch,var(--primary)_18%,transparent)] text-[var(--primary)] hover:bg-[color-mix(in_oklch,var(--primary)_26%,transparent)] disabled:opacity-50 disabled:cursor-not-allowed text-sm font-medium"
                              title="Genera el BRD (Business Requirements Document) a partir del MDD Inicial del codebase"
                            >
                              {loading && loadingReason === "legacy-brd-suggest" ? (
                                <Loader2 className="w-4 h-4 animate-spin shrink-0" />
                              ) : (
                                <FileText className="w-4 h-4 shrink-0" />
                              )}
                              Generar BRD desde MDD Inicial
                            </button>
                            <button
                              type="button"
                              onClick={async () => {
                                const hasLocalChanges = mddInicialLocalContent?.trim() && mddInicialViewMode === "source" && mddInicialLocalContent !== (activeLegacyState?.codebaseDoc ?? "");
                                if (hasLocalChanges) await onLegacyUpdateCodebaseDoc(projectId, mddInicialLocalContent);
                                if (projectId) onNavigatePanel("mdd");
                                await onLegacyGenerateMdd(projectId, activeStageId ?? undefined);
                              }}
                              disabled={loading || !(mddInicialLocalContent || activeLegacyState?.codebaseDoc)?.trim()}
                              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[color-mix(in_oklch,var(--primary)_18%,transparent)] text-[var(--primary)] hover:bg-[color-mix(in_oklch,var(--primary)_26%,transparent)] disabled:opacity-50 disabled:cursor-not-allowed text-sm font-medium"
                              title="Genera el MDD completo desde el MDD Inicial y el BRD de la etapa activa"
                            >
                              {loading && loadingReason === "legacy-mdd" ? (
                                <Loader2 className="w-4 h-4 animate-spin shrink-0" />
                              ) : (
                                <RefreshCw className="w-4 h-4 shrink-0" />
                              )}
                              Generar MDD Completo
                            </button>
                            <button
                              type="button"
                              onClick={async () => {
                                if ((mddInicialLocalContent || activeLegacyState?.codebaseDoc) && mddInicialViewMode === "source" && mddInicialLocalContent !== (activeLegacyState?.codebaseDoc ?? "")) {
                                  await onLegacyUpdateCodebaseDoc(projectId, mddInicialLocalContent);
                                }
                                await onLegacyGenerateDeliverables(projectId);
                                if (projectId) onFetchProject(projectId);
                              }}
                              disabled={loading || !(mddInicialLocalContent || activeLegacyState?.codebaseDoc)?.trim()}
                              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[color-mix(in_oklch,var(--success)_18%,transparent)] text-[color-mix(in_oklch,var(--success)_88%,var(--foreground))] hover:bg-[color-mix(in_oklch,var(--success)_28%,transparent)] disabled:opacity-50 disabled:cursor-not-allowed"
                              title="Genera Spec, Arq., Casos, Blueprint, API, etc. desde la documentación del codebase (ingeniería inversa)"
                            >
                              {loading && loadingReason === "legacy-deliverables" ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                              Generar entregables (ingeniería inversa)
                            </button>
                          </div>
                        </>
                      ) : (
                        <div className="rounded border border-dashed border-[var(--border)] bg-[color-mix(in_oklch,var(--background)_50%,var(--card))] p-8 text-center text-[var(--foreground-subtle)] space-y-4">
                          {loading && loadingReason === "legacy-codebase-doc" ? (
                            <p className="flex items-center justify-center gap-2 text-[color-mix(in_oklch,var(--primary)_72%,var(--muted-foreground))]">
                              <Loader2 className="w-4 h-4 animate-spin shrink-0" />
                              {LEGACY_CODEBASE_DOC_STEPS[legacyStepIndex % LEGACY_CODEBASE_DOC_STEPS.length]}
                            </p>
                          ) : (
                            <>
                              <p className="text-[var(--muted-foreground)] text-sm max-w-md mx-auto">
                                Aún no hay documentación de partida. Genera un borrador largo desde AriadneSpecs (varias consultas al MCP); luego puedes usar <strong>Generar entregables</strong> para Spec, arquitectura, etc. (ingeniería inversa).
                              </p>
                              <button
                                type="button"
                                onClick={async () => {
                                  const res = await onLegacyGenerateCodebaseDoc(projectId, {
                                    stageId: activeStageId ?? undefined,
                                  });
                                  if (res?.codebaseDoc) onNavigatePanel("mdd-inicial");
                                }}
                                disabled={loading}
                                className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-lg bg-[color-mix(in_oklch,var(--primary)_22%,transparent)] text-[color-mix(in_oklch,var(--primary)_72%,var(--foreground))] border border-[color-mix(in_oklch,var(--primary)_40%,var(--border))] hover:bg-[color-mix(in_oklch,var(--primary)_28%,transparent)] disabled:opacity-50 disabled:cursor-not-allowed font-medium text-sm"
                              >
                                {loading && loadingReason === "legacy-codebase-doc" ? (
                                  <Loader2 className="w-4 h-4 animate-spin" />
                                ) : null}
                                Generar MDD inicial desde AriadneSpecs
                              </button>
                              <p className="text-xs text-[color-mix(in_oklch,var(--foreground-subtle)_82%,var(--background))]">
                                También: &quot;Generar documentación de partida&quot; en la barra superior (misma acción).
                              </p>
                            </>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                  {centralPanel === "integration" && projectId && (
                    <div className="space-y-4">
                    <IntegrationPanel
                      projectId={projectId}
                      projectName={projectName}
                      projectType={projectType === "LEGACY" ? "LEGACY" : "NEW"}
                      activeStageId={activeStageId}
                      activeStageOrdinal={
                        workshopStagesList.find((s) => s.id === activeStageId)?.ordinal ?? 1
                      }
                      convergeWebhookUrl={convergeWebhookUrl ?? null}
                      legacyAnalyzeDone={legacyAnalyzeDone}
                      activeStageHandoffImportedAt={activeStageHandoffImportedAt}
                      activeStageWorkflowStatus={activeStageWorkflowStatus}
                      activeStageHandoffSnapshot={activeStageHandoffSnapshot}
                      tasksHydrated={tasksHydrated}
                      tasksSource={tasksSource}
                      stageOrigin={activeLegacyState?.stageOrigin ?? null}
                      onOpenModification={() => onNavigatePanel("legacy")}
                      onOpenTasks={() => onNavigatePanel("tasks")}
                      onProjectRefresh={() => {
                        void onFetchProject(projectId);
                      }}
                    />
                    </div>
                  )}
                  {centralPanel === "legacy" && projectType === "LEGACY" && projectId && (
                    <div className="rounded-lg bg-[color-mix(in_oklch,var(--card)_88%,transparent)] border border-[var(--border)] p-6 text-[color-mix(in_oklch,var(--foreground)_88%,var(--muted-foreground))] text-sm space-y-6">
                      <p className="font-medium text-[color-mix(in_oklch,var(--primary)_88%,var(--foreground))]">Flujo de modificación (Legacy)</p>
                      {legacyHandoffGatePending ? (
                        <div
                          className="flex gap-2 rounded-lg bg-[color-mix(in_oklch,var(--warning)_10%,transparent)] px-4 py-3 text-sm text-[color-mix(in_oklch,var(--warning)_75%,var(--foreground))]"
                          role="status"
                        >
                          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                          <div className="space-y-2">
                            <p>{LEGACY_INTEGRATION_HANDOFF_GATE_MESSAGE}</p>
                            <label className="flex items-center gap-2 text-xs cursor-pointer">
                              <input
                                type="checkbox"
                                checked={handoffGateStrict}
                                onChange={(e) => onHandoffGateStrictChange(e.target.checked)}
                              />
                              Bloquear generate-mdd / entregables hasta importar handoff (equiv.{" "}
                              <code className="text-[10px]">LEGACY_INTEGRATION_HANDOFF_GATE=1</code>)
                            </label>
                          </div>
                        </div>
                      ) : null}
                      {legacyChangeGateBlocked ? (
                        <div
                          className="flex gap-2 rounded-lg bg-[color-mix(in_oklch,var(--warning)_12%,transparent)] px-4 py-3 text-sm text-[color-mix(in_oklch,var(--warning)_75%,var(--foreground))]"
                          role="status"
                        >
                          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                          <p>{LEGACY_CHANGE_GATE_MESSAGE}</p>
                        </div>
                      ) : null}
                      {isStage1Legacy && !activeLegacyState?.codebaseDoc?.trim() ? (
                        <div className="rounded-lg border border-[color-mix(in_oklch,var(--primary)_35%,var(--border))] bg-[color-mix(in_oklch,var(--primary)_10%,var(--background))] px-4 py-3 space-y-3 text-sm text-[color-mix(in_oklch,var(--primary)_55%,var(--foreground))]">
                          <p>
                            <strong className="text-[color-mix(in_oklch,var(--primary)_72%,var(--foreground))]">Primera documentación del repo:</strong> en la pestaña{" "}
                            <strong>MDD Inicial</strong> puedes generar (o regenerar) un documento de partida desde AriadneSpecs —
                            base para entregables AS-IS. Cada <strong>nueva etapa</strong> del taller es una modificación que mantiene
                            actualizada la doc consultando Ariadne.
                          </p>
                          <div className="flex flex-wrap gap-2">
                            <button
                              type="button"
                              onClick={async () => {
                                const res = await onLegacyGenerateCodebaseDoc(projectId, {
                                  stageId: activeStageId ?? undefined,
                                });
                                if (res?.codebaseDoc?.trim()) onNavigatePanel("mdd-inicial");
                              }}
                              disabled={loading}
                              className="inline-flex items-center gap-2 px-3 py-1.5 rounded-md bg-[color-mix(in_oklch,var(--primary)_26%,transparent)] text-[color-mix(in_oklch,var(--primary)_58%,var(--foreground))] border border-[color-mix(in_oklch,var(--primary)_45%,var(--border))] hover:bg-[color-mix(in_oklch,var(--primary)_34%,transparent)] text-xs font-medium disabled:opacity-50"
                            >
                              {loading && loadingReason === "legacy-codebase-doc" ? (
                                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                              ) : null}
                              Generar MDD inicial (Ariadne)
                            </button>
                            <button
                              type="button"
                              onClick={() => onNavigatePanel("mdd-inicial")}
                              className="inline-flex items-center gap-2 px-3 py-1.5 rounded-md border border-[var(--border)] text-[color-mix(in_oklch,var(--foreground)_88%,var(--muted-foreground))] hover:bg-[color-mix(in_oklch,var(--muted)_62%,var(--card))] text-xs"
                            >
                              Ir a MDD Inicial
                            </button>
                          </div>
                        </div>
                      ) : isStage1Legacy ? (
                        <p className="text-xs text-[var(--foreground-subtle)]">
                          Documentación de partida lista. Puedes regenerarla en <strong>MDD Inicial</strong>. Este panel es para el{" "}
                          <strong>MDD de cambio</strong> de esta etapa.
                        </p>
                      ) : null}
                      {!activeLegacyState?.filesToModify?.length && !activeLegacyState?.questions?.length ? (
                        <>
                          {activeLegacyState?.description?.trim() ? (
                            <p className="text-xs text-[var(--foreground-muted)]">
                              Descripción del handoff cargada abajo. Pulsa{" "}
                              <strong className="text-[var(--foreground)]">Analizar</strong> si aún no hay archivos Ariadne
                              (p. ej. tras importar antes del despliegue auto-analyze).
                            </p>
                          ) : null}
                          <p>Describe la modificación que quieres hacer al proyecto. AriadneSpecs analizará el código y te devolverá archivos a modificar y preguntas para afinar.</p>
                          <textarea
                            value={legacyDescriptionInput}
                            onChange={(e) => onLegacyDescriptionChange(e.target.value)}
                            placeholder="Ej.: Añadir endpoint POST /users para registro con validación de email..."
                            className="w-full min-h-[120px] bg-[var(--background)] border border-[var(--border)] rounded-lg p-3 text-[var(--foreground)] placeholder:text-[var(--muted-foreground)] focus:ring-2 focus:ring-[var(--primary)] outline-none resize-y"
                          />
                          <button
                            type="button"
                            onClick={async () => {
                              await onLegacyStart(projectId, legacyDescriptionInput, activeStageId ?? undefined);
                            }}
                            disabled={loading || !legacyDescriptionInput.trim()}
                            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[color-mix(in_oklch,var(--primary)_18%,transparent)] text-[var(--primary)] hover:bg-[color-mix(in_oklch,var(--primary)_26%,transparent)] disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                            Analizar con AriadneSpecs
                          </button>
                        </>
                      ) : (
                        <>
                          <div>
                            <h4 className="text-[var(--muted-foreground)] font-medium mb-2">Solicitud de cambio</h4>
                            <p className="text-xs text-[var(--foreground-subtle)] mb-2">
                              Puedes editar la descripción y volver a analizar si el alcance cambió.
                            </p>
                            <textarea
                              value={legacyDescriptionInput}
                              onChange={(e) => onLegacyDescriptionChange(e.target.value)}
                              placeholder="Describe la modificación que quieres hacer al proyecto…"
                              className="w-full min-h-[100px] bg-[var(--background)] border border-[var(--border)] rounded-lg p-3 text-[var(--foreground)] placeholder:text-[var(--muted-foreground)] focus:ring-2 focus:ring-[var(--primary)] outline-none resize-y text-sm"
                            />
                            <button
                              type="button"
                              onClick={async () => {
                                await onLegacyStart(projectId, legacyDescriptionInput, activeStageId ?? undefined);
                              }}
                              disabled={loading || !legacyDescriptionInput.trim()}
                              className="mt-2 flex items-center gap-2 px-3 py-1.5 rounded-lg bg-[color-mix(in_oklch,var(--primary)_14%,transparent)] text-[var(--primary)] hover:bg-[color-mix(in_oklch,var(--primary)_22%,transparent)] disabled:opacity-50 disabled:cursor-not-allowed text-sm"
                            >
                              {loading && loadingReason !== "legacy-mdd" && loadingReason !== "legacy-deliverables" ? (
                                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                              ) : null}
                              Actualizar análisis
                            </button>
                          </div>
                          {activeLegacyState?.filesToModify?.length ? (
                            <div>
                              <h4 className="text-[var(--muted-foreground)] font-medium mb-2">Archivos a modificar</h4>
                              <ul className="list-disc list-inside text-[var(--muted-foreground)] space-y-1">
                                {activeLegacyState.filesToModify.map((f, i) => {
                                  const path = typeof f === "string" ? f : f.path;
                                  const repoId = typeof f === "string" ? null : f.repoId;
                                  return (
                                    <li key={i} className="font-mono text-xs">
                                      {path}
                                      {repoId ? <span className="text-[var(--foreground-subtle)] ml-1">(repo: {repoId.slice(0, 8)}…)</span> : null}
                                    </li>
                                  );
                                })}
                              </ul>
                            </div>
                          ) : null}
                          {activeLegacyState?.questions?.length ? (
                            <div>
                              <h4 className="text-[var(--muted-foreground)] font-medium mb-2">Preguntas para afinar</h4>
                              {activeLegacyState.suggestedAnswers && Object.keys(activeLegacyState.suggestedAnswers).length > 0 ? (
                                <p className="text-[var(--foreground-subtle)] text-xs mb-2">Respuestas sugeridas por AriadneSpecs (puedes editarlas).</p>
                              ) : null}
                              <div className="space-y-3">
                                {activeLegacyState.questions.map((q, i) => (
                                  <div key={i}>
                                    <label className="block text-[var(--muted-foreground)] text-xs mb-1">{q}</label>
                                    <input
                                      type="text"
                                      value={resolveLegacyAnswerValue(i)}
                                      onChange={(e) => onLegacyAnswersChange({ ...legacyAnswersInput, [i]: e.target.value })}
                                      placeholder={activeLegacyState?.suggestedAnswers?.[i] ? undefined : "Escribe tu respuesta…"}
                                      className="w-full bg-[var(--background)] border border-[var(--border)] rounded px-2 py-1.5 text-[var(--foreground)] focus:ring-2 focus:ring-[var(--primary)] outline-none"
                                    />
                                  </div>
                                ))}
                              </div>
                            </div>
                          ) : null}
                          <div className="flex flex-wrap gap-2">
                            <button
                              type="button"
                              onClick={async () => {
                                const answers: Record<string, string> = {};
                                activeLegacyState?.questions?.forEach((_, i) => {
                                  const v = resolveLegacyAnswerValue(i).trim();
                                  if (v) answers[String(i)] = v;
                                });
                                const ok = await onLegacyAnswer(projectId, answers, activeStageId ?? undefined);
                                if (ok) onLegacyAnswersChange({});
                              }}
                              disabled={loading}
                              className="px-3 py-1.5 rounded bg-[var(--muted)] text-[color-mix(in_oklch,var(--foreground)_88%,var(--muted-foreground))] hover:bg-[var(--muted)] text-sm disabled:opacity-50"
                            >
                              Guardar respuestas
                            </button>
                            <button
                              type="button"
                              onClick={async () => {
                                const answers: Record<string, string> = {};
                                activeLegacyState?.questions?.forEach((_, i) => {
                                  const v = resolveLegacyAnswerValue(i).trim();
                                  if (v) answers[String(i)] = v;
                                });
                                await onLegacyAnswer(projectId, answers, activeStageId ?? undefined);
                                onLegacyAnswersChange({});
                                const ok = await onLegacyGenerateMdd(projectId, activeStageId ?? undefined);
                                if (ok) onNavigatePanel("mdd");
                              }}
                              disabled={loading || legacyGenerateBlocked}
                              className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[color-mix(in_oklch,var(--primary)_18%,transparent)] text-[var(--primary)] hover:bg-[color-mix(in_oklch,var(--primary)_26%,transparent)] disabled:opacity-50"
                              title={
                                legacyHandoffGateBlocked
                                  ? LEGACY_INTEGRATION_HANDOFF_GATE_MESSAGE
                                  : legacyChangeGateBlocked
                                    ? LEGACY_CHANGE_GATE_MESSAGE
                                    : undefined
                              }
                            >
                              {loading ? (
                                <span className="text-[var(--primary)]" aria-hidden>
                                  <AiGenerativeDots />
                                </span>
                              ) : null}
                              Generar MDD
                            </button>
                          </div>
                          {loading && loadingReason === "legacy-mdd" && (
                            <p className="mt-2 flex items-center gap-2 text-xs text-[color-mix(in_oklch,var(--primary)_65%,var(--muted-foreground))]">
                              <span className="shrink-0 text-[var(--primary)]" aria-hidden>
                                <AiGenerativeDots />
                              </span>
                              {LEGACY_MDD_STEPS[legacyStepIndex % LEGACY_MDD_STEPS.length]}
                            </p>
                          )}
                        </>
                      )}
                      {((projectMddContent ?? "").trim() || (activeLegacyState?.codebaseDoc ?? "").trim()) ? (
                        <div className="border-t border-[var(--border)] pt-4">
                          <button
                            type="button"
                            onClick={async () => {
                              await onLegacyGenerateDeliverables(projectId);
                              if (projectId) onFetchProject(projectId);
                            }}
                            disabled={loading}
                            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[color-mix(in_oklch,var(--success)_18%,transparent)] text-[color-mix(in_oklch,var(--success)_88%,var(--foreground))] hover:bg-[color-mix(in_oklch,var(--success)_28%,transparent)] disabled:opacity-50"
                          >
                            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                            {(projectMddContent ?? "").trim() ? "Generar entregables" : "Generar entregables (ingeniería inversa)"}
                          </button>
                          {loading && loadingReason === "legacy-deliverables" && (
                            <p className="mt-2 text-[color-mix(in_oklch,var(--success)_55%,var(--muted-foreground))] text-xs flex items-center gap-2">
                              <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />
                              {LEGACY_DELIVERABLES_STEPS[legacyStepIndex % LEGACY_DELIVERABLES_STEPS.length]}
                            </p>
                          )}
                        </div>
                      ) : null}
                      {error ? <p className="text-[color-mix(in_oklch,var(--destructive)_88%,var(--foreground))] text-xs">{error}</p> : null}
                    </div>
                  )}
          </>
  );
}
