import { FileText, Target, X } from "lucide-react";
import { TraceabilityGapList } from "@/components/TraceabilityGapList";
import {
  MDD_QUALITY_SCORE_COMPLETE,
  MDD_QUALITY_TABLE_ROWS,
  resolveMddReadinessHintActions,
} from "@/utils/mddSectionRegen";
import type { WorkshopAuditModalProps } from "./workshopModals.types";

/** MDD audit breakdown modal (precision, traceability, agent logs). */
export function WorkshopAuditModal({
  open,
  onClose,
  liveMetrics,
  documentCompleteness,
  consistencyScore,
  precisionBreakdown,
  mddReadinessHints,
  traceabilityHints,
  crossDocumentGaps,
  auditTrail,
  projectId,
  activeStageId,
  effectiveMddTrimmed,
  canRegenerateMddSection,
  mddSectionRegenDisabledReason,
  onRegenerateMddSection,
  onReapplyMddFormat,
}: WorkshopAuditModalProps) {
  if (!open) return null;

  return (
  <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm" onClick={() => onClose()}>
    <div className="bg-[var(--background)] border border-[var(--border)] rounded-xl w-full max-w-3xl max-h-[85vh] flex flex-col shadow-2xl" onClick={e => e.stopPropagation()}>
      <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--border)] shrink-0">
        <div>
          <h2 className="text-lg font-semibold text-[var(--foreground)] flex items-center gap-2">
            <FileText className="w-5 h-5 text-[var(--primary)]" />
            Detalles de Auditoría MDD
          </h2>
          {liveMetrics ? (
            <p className="mt-1 text-sm text-[var(--muted-foreground)]">
              Precisión integral: <span className="font-semibold text-[var(--foreground)]">{liveMetrics.precision}%</span>
              {documentCompleteness != null || consistencyScore != null || liveMetrics.mddQualityScore != null ? (
                <span className="text-xs text-[var(--foreground-subtle)]">
                  {" "}
                  (
                  {[
                    documentCompleteness != null ? `Docs ${documentCompleteness.overall}%` : null,
                    consistencyScore != null ? `BRD→MDD ${consistencyScore}%` : null,
                    liveMetrics.mddQualityScore != null ? `MDD ${liveMetrics.mddQualityScore}%` : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                  )
                </span>
              ) : null}
            </p>
          ) : null}
        </div>
        <button onClick={() => onClose()} className="text-[var(--muted-foreground)] hover:text-[var(--foreground)]">
          <X className="w-5 h-5" />
        </button>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto p-6 space-y-8 custom-scrollbar">
        {/* Sección Desglose MDD */}
        <div>
          <h3 className="text-sm font-medium text-[var(--muted-foreground)] mb-1 uppercase tracking-wider">
            Calidad MDD (Constitución)
          </h3>
          <p className="text-xs text-[var(--foreground-subtle)] mb-1">
            Componente calidad MDD (45% del total)
          </p>
          <p className="text-xs text-[var(--foreground-subtle)] mb-3">
            Evalúa §1 Contexto, §3 Modelo, §4 API, §5 Lógica, §6 Seguridad y §7 Integración del Master Design Document.
          </p>
          {precisionBreakdown ? (
            <div className="overflow-x-auto -mx-2 px-2 sm:mx-0 sm:px-0 rounded-lg border border-[var(--border)]">
              <table className="w-full text-sm text-left">
                <thead className="bg-[color-mix(in_oklch,var(--muted)_50%,var(--card))] text-[var(--muted-foreground)] border-b border-[var(--border)]">
                  <tr>
                    <th className="px-4 py-3 font-medium">Sección</th>
                    <th className="px-4 py-3 font-medium">Agente</th>
                    <th className="px-4 py-3 font-medium text-right">Calificación</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[color-mix(in_oklch,var(--border)_70%,transparent)]">
                  {MDD_QUALITY_TABLE_ROWS.map((row) => {
                    const value = precisionBreakdown[row.reasonKey] ?? 0;
                    const reason = precisionBreakdown.sectionReasons?.[row.reasonKey];
                    const needsAction = value < MDD_QUALITY_SCORE_COMPLETE;
                    return (
                      <tr key={row.reasonKey} className="hover:bg-[var(--card)]/30">
                        <td className="px-4 py-2.5 text-[color-mix(in_oklch,var(--foreground)_88%,var(--muted-foreground))] align-top">
                          {row.label}
                          {reason ? (
                            <p className="text-[var(--foreground-subtle)] text-xs mt-1 leading-tight max-w-[260px]">
                              {reason}
                            </p>
                          ) : null}
                          {needsAction ? (
                            <button
                              type="button"
                              onClick={() => void onRegenerateMddSection(row.section)}
                              disabled={!canRegenerateMddSection}
                              title={
                                canRegenerateMddSection
                                  ? `Regenerar solo §${row.section} (pipeline parcial, sin MDD completo)`
                                  : mddSectionRegenDisabledReason
                              }
                              className="mt-1.5 block text-left text-xs font-medium text-[var(--primary)] underline-offset-2 hover:underline disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              Regenerar §{row.section}
                            </button>
                          ) : null}
                        </td>
                        <td className="px-4 py-2.5 text-[var(--muted-foreground)] align-top">{row.agent}</td>
                        <td
                          className={`px-4 py-2.5 text-right font-mono font-medium align-top ${value >= 90 ? "text-[color-mix(in_oklch,var(--success)_88%,var(--foreground))]" : value >= 50 ? "text-[var(--primary)]" : "text-[color-mix(in_oklch,var(--destructive)_88%,var(--foreground))]"}`}
                        >
                          {value}%
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-[var(--foreground-subtle)] italic">No hay desglose disponible aún.</p>
          )}

          {mddReadinessHints && mddReadinessHints.length > 0 && (
            <div className="mt-4">
              <h4 className="text-sm font-medium text-[var(--primary)] mb-2 flex items-center gap-2">
                <Target className="w-3.5 h-3.5" />
                Pendientes MDD
              </h4>
              <ul className="space-y-2">
                {mddReadinessHints.map((hint: string, i: number) => {
                  const hintActions = resolveMddReadinessHintActions(hint);
                  return (
                    <li key={i} className="flex items-start gap-2 text-xs text-[var(--muted-foreground)]">
                      <span className="text-[var(--primary)] mt-0.5 shrink-0">▶</span>
                      <div className="min-w-0 space-y-1">
                        <span>{hint}</span>
                        {hintActions.length > 0 ? (
                          <div className="flex flex-wrap gap-x-3 gap-y-1">
                            {hintActions.map((action) =>
                              action.kind === "reapply-format" ? (
                                <button
                                  key={`${i}-${action.label}`}
                                  type="button"
                                  onClick={() => void onReapplyMddFormat()}
                                  disabled={!canRegenerateMddSection}
                                  className="text-xs font-medium text-[var(--primary)] underline-offset-2 hover:underline disabled:opacity-50"
                                >
                                  {action.label}
                                </button>
                              ) : (
                                <button
                                  key={`${i}-${action.label}`}
                                  type="button"
                                  onClick={() => void onRegenerateMddSection(action.section)}
                                  disabled={!canRegenerateMddSection}
                                  className="text-xs font-medium text-[var(--primary)] underline-offset-2 hover:underline disabled:opacity-50"
                                >
                                  {action.label}
                                </button>
                              ),
                            )}
                          </div>
                        ) : null}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          {(consistencyScore != null || documentCompleteness != null) && (
            <div className="mt-4 rounded-lg border border-[var(--border)] bg-[color-mix(in_oklch,var(--card)_40%,transparent)] p-3">
              <h4 className="text-sm font-medium text-[var(--muted-foreground)] mb-2">
                Componentes de precisión integral
              </h4>
              <ul className="space-y-1 text-xs text-[var(--muted-foreground)]">
                {documentCompleteness != null ? (
                  <li>
                    Completitud documentos (30%):{" "}
                    <span className="font-mono font-medium text-[var(--foreground)]">
                      {documentCompleteness.overall}%
                    </span>
                  </li>
                ) : null}
                {consistencyScore != null ? (
                  <li>
                    Trazabilidad BRD→MDD (25%):{" "}
                    <span className="font-mono font-medium text-[var(--foreground)]">
                      {consistencyScore}%
                    </span>
                  </li>
                ) : null}
                {liveMetrics?.mddQualityScore != null ? (
                  <li>
                    Calidad MDD (45%):{" "}
                    <span className="font-mono font-medium text-[var(--foreground)]">
                      {liveMetrics.mddQualityScore}%
                    </span>
                  </li>
                ) : null}
              </ul>
              {consistencyScore === 50 &&
              (crossDocumentGaps?.length ?? 0) === 0 &&
              (traceabilityHints?.length ?? 0) === 0 ? (
                <p className="mt-2 text-[11px] leading-snug text-[color-mix(in_oklch,var(--warning)_82%,var(--foreground))]">
                  BRD sin ítems trazables; trazabilidad neutra al 50%.
                </p>
              ) : null}
            </div>
          )}

          {(traceabilityHints && traceabilityHints.length > 0) ||
          consistencyScore != null ||
          documentCompleteness != null ? (
            <div className="mt-4">
              <h4 className="text-sm font-medium text-[color-mix(in_oklch,var(--warning)_75%,var(--foreground))] mb-2 flex items-center gap-2">
                <Target className="w-3.5 h-3.5" />
                Trazabilidad BRD → MDD
                {consistencyScore != null && (
                  <span className="text-[10px] font-normal text-[var(--foreground-subtle)]">
                    ({consistencyScore}% cubierto)
                  </span>
                )}
              </h4>
              <p className="text-[10px] text-[var(--foreground-subtle)] mb-2">
                Capacidades de negocio del BRD que aún no se reflejan en §1, §4 o §5 del MDD.
              </p>
              {crossDocumentGaps && crossDocumentGaps.length > 0 ? (
                <TraceabilityGapList
                  gaps={crossDocumentGaps}
                  projectId={projectId}
                  stageId={activeStageId}
                  mddContent={effectiveMddTrimmed}
                  maxVisible={12}
                />
              ) : traceabilityHints && traceabilityHints.length > 0 ? (
                <ul className="space-y-1.5">
                  {traceabilityHints.map((hint: string, i: number) => (
                    <li key={i} className="flex items-start gap-2 text-xs text-[var(--muted-foreground)]">
                      <span className="text-[color-mix(in_oklch,var(--warning)_75%,var(--foreground))] mt-0.5 shrink-0">▶</span>
                      <span>{hint}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-xs italic text-[var(--foreground-subtle)]">
                  Sin brechas BRD→MDD detectadas en este momento.
                </p>
              )}
            </div>
          ) : null}
        </div>

        {/* Sección Logs */}
        <div>
          <h3 className="text-sm font-medium text-[var(--muted-foreground)] mb-3 uppercase tracking-wider flex items-center justify-between">
            <span>Audit Trail (Logs)</span>
            <span className="text-xs normal-case text-[var(--foreground-subtle)] font-normal">Secuencia de ejecución de agentes</span>
          </h3>
          {auditTrail && auditTrail.length > 0 ? (
            <div className="bg-[var(--background)] rounded-lg border border-[var(--border)] p-4 overflow-x-auto max-h-60 overflow-y-auto custom-scrollbar">
              <pre className="font-mono text-xs text-[color-mix(in_oklch,var(--success)_82%,var(--foreground))] whitespace-pre-wrap leading-relaxed">
                {auditTrail.join(" -> ")}
              </pre>
            </div>
          ) : (
            <p className="text-[var(--foreground-subtle)] italic">
              No hay logs de auditoría disponibles aún. Ejecuta el pipeline MDD (Manager) o recarga tras generar el documento.
            </p>
          )}
        </div>
      </div>
      <div className="p-4 border-t border-[var(--border)] bg-[color-mix(in_oklch,var(--background)_50%,var(--card))] flex justify-end shrink-0">
        <button
          onClick={() => onClose()}
          className="px-4 py-2 rounded-lg bg-[var(--card)] hover:bg-[var(--muted)] text-[var(--foreground)] text-sm font-medium transition-colors"
        >
          Cerrar
        </button>
      </div>
    </div>
  </div>
  );
}
