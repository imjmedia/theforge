import { AlertTriangle, Layers, ListChecks, Loader2, RefreshCw, Sparkles, Trash2, Wand2, X } from "lucide-react";
import {
  LEGACY_CHANGE_GATE_MESSAGE,
  LEGACY_INTEGRATION_HANDOFF_GATE_MESSAGE,
} from "@theforge/shared-types";
import MddViewer from "@/components/MddViewer";
import { DocumentClarificationSection } from "@/components/DocumentClarificationSection";
import { MddManualAudit } from "@/components/MddManualAudit";
import {
  AiGenerationPanel,
  AiGenerativeDots,
} from "@/components/AiGenerationLoader";
import {
  WorkshopDirtySaveBar,
  WorkshopMddActionButton,
  WorkshopPanelActionRegion,
  WorkshopPanelButton,
  WorkshopButtonIcon,
} from "@/components/WorkshopButtons";
import type { WorkshopMddPanelProps } from "./workshopMddPanel.types";

export function WorkshopMddPanel({
  projectId,
  activeStageId,
  mddContent,
  effectiveMddTrimmed,
  mddViewMode,
  mddDirty,
  mddReviewing,
  mddPersisting,
  mddReapplyingFormat,
  mddJustGeneratedFromBenchmark,
  loading,
  loadingReason,
  notice,
  isLegacyProject,
  isStage1Legacy,
  legacyMddNeedsCodebaseDoc,
  legacyHandoffGatePending,
  legacyChangeGateBlocked,
  legacyHandoffGateBlocked,
  legacyGenerateBlocked,
  handoffGateStrict,
  patternsWizardAnalyzing,
  canGenerate,
  cascadeRunning,
  cascadeCompleted,
  cascadeTotal,
  cascadePostPassRunning,
  buildDocClarification,
  isGenerationGateBlocked,
  onHandoffGateStrictChange,
  onClearMddJustGeneratedFromBenchmark,
  onRequestGenerateMdd,
  onReapplyMddFormat,
  canRegenerateMddSection,
  mddSectionRegenDisabledReason,
  onRegenerateMddSection: _onRegenerateMddSection,
  onRegenerateMddSection5Pipeline,
  onOpenSuggestMddPatterns,
  onOpenEditMddPatterns,
  onOpenClearMddConfirm,
  onOpenClearMddDeliverablesConfirm,
  onGenerateDeliverables,
  onMddContentChange,
  onRevertMddContent,
  onPersistAndReviewMdd,
  onMddAuditUpdated,
}: WorkshopMddPanelProps) {
  return (
    <>
      {mddJustGeneratedFromBenchmark && (
                      <div className="shrink-0 flex items-center justify-between gap-2 py-2 px-3 rounded-lg bg-[color-mix(in_oklch,var(--success)_12%,transparent)] border border-[color-mix(in_oklch,var(--success)_30%,var(--border))] mb-3">
                        <span className="text-sm text-[color-mix(in_oklch,var(--success)_72%,var(--foreground))]">
                          Revisa el MDD en esta pestaña y refina con el chat si algo no cuadra.
                        </span>
                        <button
                          type="button"
                          onClick={onClearMddJustGeneratedFromBenchmark}
                          className="shrink-0 px-2 py-1 rounded text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-[var(--muted)] text-sm"
                          aria-label="Cerrar aviso"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                    )}
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
                        className="shrink-0 flex gap-2 items-start rounded-lg bg-[color-mix(in_oklch,var(--warning)_12%,transparent)] px-4 py-3 mb-3 text-sm text-[color-mix(in_oklch,var(--warning)_75%,var(--foreground))]"
                        role="status"
                      >
                        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                        <p>{LEGACY_CHANGE_GATE_MESSAGE}</p>
                      </div>
                    ) : null}
                    <WorkshopPanelActionRegion role="region" aria-label="Generar o regenerar el MDD">
                      {loading && loadingReason === "mdd-section" ? (
                        <p
                          className="mb-3 rounded-lg border border-[color-mix(in_oklch,var(--primary)_22%,var(--border))] bg-[color-mix(in_oklch,var(--primary)_6%,var(--card))] px-3 py-2 text-xs text-[color-mix(in_oklch,var(--primary)_72%,var(--foreground))]"
                          role="status"
                          aria-live="polite"
                        >
                          {notice ?? "Regenerando sección del MDD…"}
                        </p>
                      ) : null}
                      {loading && (loadingReason === "mdd" || loadingReason === "legacy-mdd") ? (
                        <AiGenerationPanel
                          title={
                            mddContent?.trim() ? "Regenerando el MDD…" : "Generando el MDD…"
                          }
                          subtitle={
                            isLegacyProject
                              ? isStage1Legacy
                                ? "A partir de la documentación de partida (MDD Inicial). No vuelve a llamar a Ariadne."
                                : "A partir de BRD, doc. de partida y descripción del cambio de la etapa activa."
                              : "A partir del DBGA / Benchmark guardado en Paso 0. Puede tardar unos minutos."
                          }
                        />
                      ) : (
                        <>
                          <div className="flex flex-col gap-2 lg:flex-row lg:flex-wrap lg:items-center">
                            <WorkshopMddActionButton
                              tone="primary"
                              onClick={() => void onRequestGenerateMdd()}
                              disabled={
                                legacyMddNeedsCodebaseDoc ||
                                legacyGenerateBlocked ||
                                (loading &&
                                  (loadingReason === "mdd" ||
                                    loadingReason === "legacy-mdd" ||
                                    loadingReason === "legacy-codebase-doc"))
                              }
                              title={
                                legacyHandoffGateBlocked
                                  ? LEGACY_INTEGRATION_HANDOFF_GATE_MESSAGE
                                  : legacyChangeGateBlocked
                                    ? LEGACY_CHANGE_GATE_MESSAGE
                                    : undefined
                              }
                            >
                              {mddContent?.trim() ? (
                                <>
                                  <WorkshopButtonIcon icon={RefreshCw} tone="primary" />
                                  Regenerar MDD
                                </>
                              ) : (
                                <>
                                  <WorkshopButtonIcon icon={RefreshCw} tone="primary" />
                                  Generar MDD
                                </>
                              )}
                            </WorkshopMddActionButton>
                            {effectiveMddTrimmed.length > 0 && (
                              <WorkshopPanelButton
                                tone="secondary"
                                onClick={() => void onReapplyMddFormat()}
                                disabled={loading || mddReviewing || mddReapplyingFormat}
                                className="w-full justify-center lg:w-auto"
                                title="Ejecuta sanitizers deterministas (headings, JSON §4, SQL, coherencia) sin regenerar con IA"
                              >
                                <WorkshopButtonIcon
                                  icon={mddReapplyingFormat ? Loader2 : Wand2}
                                  tone="secondary"
                                  className={mddReapplyingFormat ? "animate-spin" : undefined}
                                />
                                {mddReapplyingFormat ? "Aplicando formato…" : "Re-aplicar formato"}
                              </WorkshopPanelButton>
                            )}
                            {effectiveMddTrimmed.length > 0 && (
                              <WorkshopPanelButton
                                tone="secondary"
                                onClick={() => void onRegenerateMddSection5Pipeline()}
                                disabled={!canRegenerateMddSection}
                                className="w-full justify-center lg:w-auto"
                                title={
                                  canRegenerateMddSection
                                    ? "Regenera §5 con la misma secuencia del MDD completo (section5 → Formatter → prepare). Más lento que /logica; no regenera §1–§4 ni §6–§7."
                                    : mddSectionRegenDisabledReason
                                }
                              >
                                <WorkshopButtonIcon icon={RefreshCw} tone="secondary" />
                                Regenerar §5 (pipeline)
                              </WorkshopPanelButton>
                            )}
                            {effectiveMddTrimmed.length > 0 && (
                              <WorkshopPanelButton
                                tone="secondary"
                                onClick={() => void onOpenSuggestMddPatterns()}
                                disabled={
                                  loading ||
                                  mddReviewing ||
                                  mddReapplyingFormat ||
                                  patternsWizardAnalyzing
                                }
                                className="w-full justify-center lg:w-auto"
                                title="Analiza Fase 0, Benchmark y BRD con IA y abre el wizard con patrones preseleccionados (sin regenerar §1–§7)"
                              >
                                <WorkshopButtonIcon
                                  icon={patternsWizardAnalyzing ? Loader2 : Sparkles}
                                  tone="secondary"
                                  className={patternsWizardAnalyzing ? "animate-spin" : undefined}
                                />
                                {patternsWizardAnalyzing
                                  ? "Analizando patrones…"
                                  : "Analizar y sugerir patrones"}
                              </WorkshopPanelButton>
                            )}
                            {effectiveMddTrimmed.length > 0 && (
                              <WorkshopPanelButton
                                tone="secondary"
                                onClick={onOpenEditMddPatterns}
                                disabled={loading || mddReviewing || mddReapplyingFormat}
                                className="w-full justify-center lg:w-auto"
                              >
                                <WorkshopButtonIcon icon={ListChecks} tone="secondary" />
                                Editar patrones (SSOT)
                              </WorkshopPanelButton>
                            )}
                            {effectiveMddTrimmed.length > 0 && (
                              <WorkshopPanelButton
                                tone="secondary"
                                onClick={() => {
                                  if (!projectId?.trim()) return;
                                  onOpenClearMddConfirm();
                                }}
                                disabled={loading || mddReviewing || mddReapplyingFormat}
                                className="w-full justify-center lg:w-auto"
                              >
                                <WorkshopButtonIcon icon={Trash2} tone="secondary" />
                                Limpiar MDD
                              </WorkshopPanelButton>
                            )}
                            {effectiveMddTrimmed.length > 0 && (
                              <WorkshopPanelButton
                                tone="secondary"
                                onClick={() => {
                                  if (!projectId?.trim()) return;
                                  onOpenClearMddDeliverablesConfirm();
                                }}
                                disabled={loading || mddReviewing || mddReapplyingFormat || cascadeRunning}
                                className="w-full justify-center lg:w-auto"
                                title="Borra spec, blueprint, tasks y demás entregables generados desde el MDD (no borra el MDD)"
                              >
                                <WorkshopButtonIcon icon={Trash2} tone="secondary" />
                                Limpiar todos los archivos
                              </WorkshopPanelButton>
                            )}
                            {effectiveMddTrimmed.length > 200 && (
                              <WorkshopMddActionButton
                                tone="success"
                                onClick={onGenerateDeliverables}
                                disabled={!canGenerate || cascadeRunning || mddReviewing || isGenerationGateBlocked("cascade")}
                              >
                                {cascadeRunning ? (
                                  <span className="inline-flex items-center gap-2">
                                    <span className="text-[var(--success-foreground)]">
                                      <AiGenerativeDots />
                                    </span>
                                  </span>
                                ) : (
                                  <WorkshopButtonIcon icon={Layers} tone="success" />
                                )}
                                {cascadeRunning
                                  ? cascadePostPassRunning
                                    ? "Refinando precisión (W4)…"
                                    : cascadeCompleted > 0
                                      ? `Generando documentos (${cascadeCompleted}/${cascadeTotal})`
                                      : "Generando documentos…"
                                  : "Generar todos los documentos"}
                              </WorkshopMddActionButton>
                            )}
                          </div>
                          <p className="text-sm leading-relaxed text-[var(--foreground-subtle)]">
                            {legacyMddNeedsCodebaseDoc ? (
                              <>
                                Genera primero la documentación de partida en la pestaña{" "}
                                <strong>MDD Inicial</strong> (Ariadne). Luego aquí sintetizas el MDD
                                canónico (7 secciones) a partir de ese contenido.
                              </>
                            ) : isLegacyProject ? (
                              isStage1Legacy ? (
                                <>
                                  Regenera el MDD canónico desde el <strong>MDD Inicial</strong> ya
                                  guardado. Para re-indexar Ariadne, usa la pestaña MDD Inicial.
                                </>
                              ) : (
                                <>
                                  Genera el MDD de cambio desde BRD, doc. de partida y la descripción
                                  en Modificación.
                                </>
                              )
                            ) : (
                              "Genera el MDD a partir del DBGA / Benchmark guardado en Paso 0."
                            )}{" "}
                            El wizard de patrones solo aparece con MDD vacío (o tras «Limpiar MDD»). Al
                            regenerar se conservan los patrones actuales; cámbialos con «Editar patrones» o
                            re-analiza con «Analizar y sugerir patrones».
                          </p>
                        </>
                      )}
                    </WorkshopPanelActionRegion>
                    {(mddContent ?? "").trim().length > 0 ? (
                      <MddManualAudit
                        projectId={projectId}
                        stageId={activeStageId}
                        mddContent={mddContent}
                        onUpdated={() => void onMddAuditUpdated()}
                      />
                    ) : null}
                    {mddDirty && (
                      <WorkshopDirtySaveBar
                        message="Tienes cambios sin guardar. Graba para revisar consistencia (ER, etc.)."
                        onCancel={() => onRevertMddContent()}
                        onSave={() => onPersistAndReviewMdd()}
                        saving={mddReviewing || mddPersisting}
                        disabled={mddReviewing || mddPersisting}
                        savingLabel={mddPersisting ? "Guardando MDD…" : "Grabando y revisando…"}
                      />
                    )}
                    {buildDocClarification("mddContent", (c) => onMddContentChange(c)) ? (
                      <DocumentClarificationSection
                        {...buildDocClarification("mddContent", (c) => onMddContentChange(c))!}
                        content={mddContent}
                      />
                    ) : null}
                    {mddViewMode === "preview" ? (
                      <MddViewer content={mddContent || ""} documentTimestamps={null} />
                    ) : (
                      <>
                        <textarea
                          value={mddContent}
                          onChange={(e) => onMddContentChange(e.target.value)}
                          placeholder="# Master Design Doc\n\nEl contenido del MDD se irá generando aquí..."
                          className="w-full min-h-full bg-[color-mix(in_oklch,var(--muted)_50%,var(--card))] border border-[var(--border)] rounded-lg p-4 text-sm font-mono text-[var(--foreground)] placeholder:text-[var(--muted-foreground)] focus:ring-2 focus:ring-[var(--primary)] focus:border-transparent outline-none resize-none"
                          spellCheck={false}
                        />
                      </>
      )}
    </>
  );
}
