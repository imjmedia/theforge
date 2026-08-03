/**
 * Workshop panel: cross-project integration NEW ↔ LEGACY (handoff, traces, link picker).
 */
import { useCallback, useEffect, useId, useMemo, useState, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  Archive,
  ArrowLeftRight,
  CheckCircle2,
  Download,
  GitBranch,
  Link2,
  Loader2,
  Plus,
  Pencil,
  RefreshCw,
  Send,
  Sparkles,
  Trash2,
  Unlink,
} from "lucide-react";
import type {
  IntegrationHandoffItem,
  IntegrationStatusResponse,
  IntegrationTraceRow,
} from "@theforge/shared-types";
import { buildHandoffImportDescription, formatIntegrationHandoffPreviewStory } from "@theforge/shared-types";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardTitle,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  EmptyState,
  Input,
} from "@/components/ui";
import { WorkshopPanelButton } from "@/components/WorkshopButtons";
import { cn } from "@/lib/utils";
import { apiFetch, API_BASE } from "@/utils/apiClient";

interface PickerProject {
  id: string;
  name: string;
  projectType: string;
  hasBaselineMdd: boolean;
}

export interface IntegrationPanelProps {
  projectId: string;
  projectName: string;
  projectType: "NEW" | "LEGACY";
  activeStageId: string | null;
  activeStageOrdinal: number;
  convergeWebhookUrl?: string | null;
  /** Stage legacyChangeState: Ariadne analyze already ran (files or questions). */
  legacyAnalyzeDone?: boolean;
  /** Active stage handoff import timestamp (preferred over global integration status). */
  activeStageHandoffImportedAt?: string | null;
  activeStageWorkflowStatus?: string | null;
  onOpenModification?: () => void;
  onProjectRefresh: () => void | Promise<void>;
}

type StepStatus = "done" | "active" | "pending";

export function IntegrationPanel({
  projectId,
  projectName,
  projectType,
  activeStageId,
  activeStageOrdinal,
  convergeWebhookUrl: initialConvergeWebhookUrl,
  legacyAnalyzeDone = false,
  activeStageHandoffImportedAt = null,
  activeStageWorkflowStatus = null,
  onOpenModification,
  onProjectRefresh,
}: IntegrationPanelProps) {
  const [status, setStatus] = useState<IntegrationStatusResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerProjects, setPickerProjects] = useState<PickerProject[]>([]);
  const [pickerLoading, setPickerLoading] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [legacyContextPreview, setLegacyContextPreview] = useState<string | null>(null);
  const [promoteOpen, setPromoteOpen] = useState(false);
  const [promoteStageName, setPromoteStageName] = useState("");
  const [promoteSelectedIds, setPromoteSelectedIds] = useState<string[]>([]);
  const [promoteSubmitting, setPromoteSubmitting] = useState(false);
  const [reconcileSubmitting, setReconcileSubmitting] = useState(false);
  const [abandonOpen, setAbandonOpen] = useState(false);
  const [abandonReason, setAbandonReason] = useState("");
  const [abandonRejectItems, setAbandonRejectItems] = useState(false);
  const [abandonSubmitting, setAbandonSubmitting] = useState(false);
  const [convergeWebhookUrl, setConvergeWebhookUrl] = useState(initialConvergeWebhookUrl ?? "");
  const [convergeWebhookSaving, setConvergeWebhookSaving] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewTrace, setPreviewTrace] = useState<IntegrationTraceRow | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const handoffTitleId = useId();
  const handoffDescriptionId = useId();

  const loadStatus = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await apiFetch(`${API_BASE}/projects/${projectId}/integration`);
      if (!r.ok) throw new Error("No se pudo cargar integración");
      const data = (await r.json()) as IntegrationStatusResponse;
      setStatus(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error");
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  useEffect(() => {
    setConvergeWebhookUrl(initialConvergeWebhookUrl ?? "");
  }, [initialConvergeWebhookUrl, projectId]);

  useEffect(() => {
    if (projectType !== "NEW" || !status?.linkedLegacyProject) {
      setLegacyContextPreview(null);
      return;
    }
    void (async () => {
      const r = await apiFetch(`${API_BASE}/projects/${projectId}/integration/context`);
      if (!r.ok) return;
      const ctx = (await r.json()) as {
        apiSectionMarkdown?: string;
        contextSectionMarkdown?: string;
      };
      setLegacyContextPreview(
        [ctx.contextSectionMarkdown, ctx.apiSectionMarkdown].filter(Boolean).join("\n\n---\n\n") || null,
      );
    })();
  }, [projectId, projectType, status?.linkedLegacyProject?.id]);

  const openPicker = useCallback(async () => {
    setPickerOpen(true);
    setPickerLoading(true);
    try {
      const target = projectType === "NEW" ? "LEGACY" : "NEW";
      const r = await apiFetch(`${API_BASE}/projects/${projectId}/integration/picker?targetType=${target}`);
      const data = (await r.json()) as PickerProject[];
      setPickerProjects(Array.isArray(data) ? data : []);
    } finally {
      setPickerLoading(false);
    }
  }, [projectId, projectType]);

  const linkProject = useCallback(
    async (targetId: string) => {
      const body =
        projectType === "NEW"
          ? { linkedLegacyProjectId: targetId }
          : { linkedNewProjectId: targetId };
      const r = await apiFetch(`${API_BASE}/projects/${projectId}/integration/link`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!r.ok) throw new Error("No se pudo enlazar");
      setPickerOpen(false);
      await loadStatus();
      await onProjectRefresh();
    },
    [projectId, projectType, loadStatus, onProjectRefresh],
  );

  const unlink = useCallback(async () => {
    const body =
      projectType === "NEW" ? { linkedLegacyProjectId: null } : { linkedNewProjectId: null };
    await apiFetch(`${API_BASE}/projects/${projectId}/integration/link`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    await loadStatus();
    await onProjectRefresh();
  }, [projectId, projectType, loadStatus, onProjectRefresh]);

  const addHandoffItem = useCallback(async () => {
    if (!newTitle.trim() || !newDescription.trim()) return;
    const r = await apiFetch(`${API_BASE}/projects/${projectId}/integration/handoff/items`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: newTitle.trim(), description: newDescription.trim() }),
    });
    if (!r.ok) {
      setError("No se pudo crear ítem handoff");
      return;
    }
    setNewTitle("");
    setNewDescription("");
    await loadStatus();
  }, [projectId, newTitle, newDescription, loadStatus]);

  const sendHandoff = useCallback(async () => {
    const r = await apiFetch(`${API_BASE}/projects/${projectId}/integration/handoff/send`, {
      method: "POST",
    });
    if (!r.ok) {
      setError("Envío de handoff falló — verifica que el legacy esté enlazado.");
      return;
    }
    await loadStatus();
  }, [projectId, loadStatus]);

  const importHandoff = useCallback(async () => {
    if (!activeStageId) return;
    const r = await apiFetch(
      `${API_BASE}/projects/${projectId}/integration/stages/${activeStageId}/import-handoff`,
      { method: "POST" },
    );
    if (!r.ok) {
      setError("Importar handoff falló");
      return;
    }
    await loadStatus();
    await onProjectRefresh();
  }, [projectId, activeStageId, loadStatus, onProjectRefresh]);

  const handoffImportedOnActiveStage = activeStageHandoffImportedAt ?? status?.handoffImportedAt;
  const activeStageIsArchived = activeStageWorkflowStatus === "ARCHIVED";

  const abandonHandoffStage = useCallback(async () => {
    if (!activeStageId) return;
    setAbandonSubmitting(true);
    setError(null);
    try {
      const r = await apiFetch(
        `${API_BASE}/projects/${projectId}/integration/stages/${activeStageId}/abandon-handoff`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            reason: abandonReason.trim() || undefined,
            rejectReleasedItems: abandonRejectItems,
          }),
        },
      );
      if (!r.ok) {
        const err = (await r.json().catch(() => null)) as { message?: string } | null;
        throw new Error(err?.message ?? "Abandonar handoff falló");
      }
      setAbandonOpen(false);
      setAbandonReason("");
      setAbandonRejectItems(false);
      await loadStatus();
      await onProjectRefresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Abandonar handoff falló");
    } finally {
      setAbandonSubmitting(false);
    }
  }, [
    projectId,
    activeStageId,
    abandonReason,
    abandonRejectItems,
    loadStatus,
    onProjectRefresh,
  ]);

  const reconcileHandoff = useCallback(async () => {
    if (!activeStageId) return;
    setReconcileSubmitting(true);
    setError(null);
    try {
      const r = await apiFetch(
        `${API_BASE}/projects/${projectId}/integration/stages/${activeStageId}/reconcile-handoff`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ wireAriadne: true, legacyStart: true }),
        },
      );
      if (!r.ok) {
        const err = (await r.json().catch(() => null)) as { message?: string } | null;
        throw new Error(err?.message ?? "Re-sincronizar handoff falló");
      }
      const result = (await r.json()) as {
        legacyStart?: { ok?: boolean; error?: string };
        ariadneWire?: { wired?: boolean; skippedReason?: string; errors?: string[] };
      };
      if (result.legacyStart?.error) {
        setError(`Análisis: ${result.legacyStart.error}`);
      } else if (result.ariadneWire?.errors?.length) {
        setError(`Ariadne: ${result.ariadneWire.errors.join("; ")}`);
      }
      await loadStatus();
      await onProjectRefresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Re-sincronizar handoff falló");
    } finally {
      setReconcileSubmitting(false);
    }
  }, [projectId, activeStageId, loadStatus, onProjectRefresh]);

  const promotableIds = status?.promotableItemIds ?? [];
  const linkedNewHandoffItems = status?.linkedNewHandoff?.items ?? [];

  useEffect(() => {
    if (!promoteOpen) return;
    setPromoteStageName(
      status?.linkedNewProject ? `Integración — ${status.linkedNewProject.name}` : "Integración",
    );
    setPromoteSelectedIds(promotableIds);
  }, [promoteOpen, status?.linkedNewProject, promotableIds]);

  const promotePreviewDescription = useMemo(() => {
    if (!status?.linkedNewProject || promoteSelectedIds.length === 0) return "";
    const selected = linkedNewHandoffItems.filter((item) => promoteSelectedIds.includes(item.id));
    return buildHandoffImportDescription(selected, status.linkedNewProject.name);
  }, [status?.linkedNewProject, promoteSelectedIds, linkedNewHandoffItems]);

  const submitPromoteToStage = useCallback(async () => {
    if (!promoteSelectedIds.length) return;
    setPromoteSubmitting(true);
    setError(null);
    try {
      const r = await apiFetch(`${API_BASE}/projects/${projectId}/integration/promote-to-stage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          itemIds: promoteSelectedIds,
          stageName: promoteStageName.trim() || undefined,
          activate: true,
        }),
      });
      if (!r.ok) {
        const err = (await r.json().catch(() => null)) as { message?: string } | null;
        throw new Error(err?.message ?? "Promover handoff a etapa falló");
      }
      setPromoteOpen(false);
      await loadStatus();
      await onProjectRefresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Promover handoff a etapa falló");
    } finally {
      setPromoteSubmitting(false);
    }
  }, [projectId, promoteSelectedIds, promoteStageName, loadStatus, onProjectRefresh]);

  const deleteItem = useCallback(
    async (itemId: string) => {
      await apiFetch(`${API_BASE}/projects/${projectId}/integration/handoff/items/${itemId}`, {
        method: "DELETE",
      });
      await loadStatus();
    },
    [projectId, loadStatus],
  );

  const updateHandoffItem = useCallback(
    async (
      itemId: string,
      payload: {
        title?: string;
        description?: string;
        actor?: string;
        acceptanceCriteria?: string[];
        status?: IntegrationHandoffItem["status"];
      },
    ) => {
      const body: Record<string, unknown> = {};
      if (payload.title !== undefined) body.title = payload.title.trim();
      if (payload.description !== undefined) body.description = payload.description.trim();
      if (payload.actor !== undefined) body.actor = payload.actor.trim();
      if (payload.acceptanceCriteria !== undefined) body.acceptanceCriteria = payload.acceptanceCriteria;
      if (payload.status !== undefined) body.status = payload.status;
      const r = await apiFetch(`${API_BASE}/projects/${projectId}/integration/handoff/items/${itemId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!r.ok) {
        setError("No se pudo actualizar ítem handoff");
        return false;
      }
      await loadStatus();
      return true;
    },
    [projectId, loadStatus],
  );

  const rejectHandoffItem = useCallback(
    async (itemId: string) => {
      const ok = await updateHandoffItem(itemId, { status: "rejected" });
      if (!ok) setError("No se pudo rechazar ítem handoff");
    },
    [updateHandoffItem],
  );

  const saveConvergeWebhook = useCallback(async () => {
    setConvergeWebhookSaving(true);
    setError(null);
    try {
      const trimmed = convergeWebhookUrl.trim();
      const r = await apiFetch(`${API_BASE}/projects/${projectId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          convergeWebhookUrl: trimmed.length > 0 ? trimmed : null,
        }),
      });
      if (!r.ok) {
        const err = (await r.json().catch(() => null)) as { message?: string } | null;
        throw new Error(err?.message ?? "No se pudo guardar webhook converge");
      }
      await onProjectRefresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo guardar webhook converge");
    } finally {
      setConvergeWebhookSaving(false);
    }
  }, [projectId, convergeWebhookUrl, onProjectRefresh]);

  const openHandoffPreview = useCallback(
    async (trace: IntegrationTraceRow) => {
      setPreviewTrace(trace);
      setPreviewOpen(true);
      setPreviewLoading(true);
      try {
        const r = await apiFetch(`${API_BASE}/projects/${projectId}/integration`);
        if (r.ok) {
          const data = (await r.json()) as IntegrationStatusResponse;
          setStatus(data);
          const fresh = data.traces.find((t) => t.newLegId === trace.newLegId);
          if (fresh) setPreviewTrace(fresh);
        }
      } finally {
        setPreviewLoading(false);
      }
    },
    [projectId],
  );

  const previewMarkdown = useMemo(() => {
    if (!previewTrace?.description?.trim()) return "";
    return formatIntegrationHandoffPreviewStory({
      id: previewTrace.newLegId,
      title: previewTrace.title,
      description: previewTrace.description,
      actor: previewTrace.actor ?? undefined,
      acceptanceCriteria: previewTrace.acceptanceCriteria,
    });
  }, [previewTrace]);

  if (loading && !status) {
    return (
      <div className="flex items-center justify-center gap-2 py-16 text-sm text-[var(--muted-foreground)]">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
        Cargando integración…
      </div>
    );
  }

  const linked =
    projectType === "NEW" ? status?.linkedLegacyProject : status?.linkedNewProject;
  const handoffItems = status?.handoff.items ?? [];
  const linkStepStatus: StepStatus = linked ? "done" : "active";
  const contextStepStatus: StepStatus = !linked
    ? "pending"
    : legacyContextPreview
      ? "done"
      : "active";
  const handoffStepStatus: StepStatus = !linked
    ? "pending"
    : handoffItems.length > 0
      ? "done"
      : "active";

  return (
    <div className="mx-auto max-w-3xl space-y-6 px-2 py-4 sm:px-3">
      <IntegrationOverview
        projectType={projectType}
        projectName={projectName}
        linked={linked ?? null}
        warnings={status?.warnings ?? []}
      />

      {error ? (
        <div
          role="alert"
          className="rounded-lg border border-[color-mix(in_oklch,var(--destructive)_35%,var(--border))] bg-[color-mix(in_oklch,var(--destructive)_10%,var(--card))] px-3.5 py-2.5 text-sm text-[color-mix(in_oklch,var(--destructive)_88%,var(--foreground))]"
        >
          {error}
        </div>
      ) : null}

      <ol className="space-y-6" aria-label="Pasos de integración">
        <IntegrationStep
          step={1}
          status={linkStepStatus}
          title="Enlazar proyectos"
          description={
            projectType === "NEW"
              ? "Conecta este módulo nuevo con el proyecto legacy que documenta el sistema actual."
              : "Conecta el sistema legacy con el proyecto nuevo que solicitará cambios o compartirá contexto."
          }
        >
          {linked ? (
            <LinkedProjectCard linked={linked} onUnlink={() => void unlink()} />
          ) : (
            <UnlinkedProjectCard
              targetLabel={projectType === "NEW" ? "proyecto LEGACY" : "proyecto NEW"}
              onLink={() => void openPicker()}
            />
          )}
        </IntegrationStep>

        {projectType === "NEW" ? (
          <IntegrationStep
            step={2}
            status={contextStepStatus}
            title="Contexto compartido"
            description="El módulo nuevo consulta la documentación AS-IS del legacy sin duplicar el Workshop."
          >
            {linked ? (
              legacyContextPreview ? (
                <pre className="max-h-52 overflow-auto whitespace-pre-wrap rounded-lg border border-[var(--border)] bg-[color-mix(in_oklch,var(--muted)_16%,var(--card))] p-4 text-xs leading-relaxed text-[var(--foreground-muted)]">
                  {legacyContextPreview.slice(0, 4000)}
                  {legacyContextPreview.length > 4000 ? "\n…" : ""}
                </pre>
              ) : (
                <p className="rounded-lg border border-dashed border-[var(--border)] px-4 py-8 text-center text-sm leading-relaxed text-[var(--foreground-muted)]">
                  Enlace activo. El extracto AS-IS aparecerá cuando el legacy tenga MDD de etapa 1.
                </p>
              )
            ) : (
              <p className="text-sm leading-relaxed text-[var(--foreground-muted)]">
                Enlaza un proyecto legacy para acceder a su contexto y APIs actuales.
              </p>
            )}
          </IntegrationStep>
        ) : null}

        {projectType === "NEW" ? (
          <IntegrationStep
            step={projectType === "NEW" ? 3 : 2}
            status={handoffStepStatus}
            title="Handoff al legacy"
            description="Define qué debe cambiar el sistema legacy para soportar este módulo nuevo. Cada ítem se rastrea como NEW-LEG."
          >
            <HandoffEditor
              items={handoffItems}
              newTitle={newTitle}
              newDescription={newDescription}
              titleId={handoffTitleId}
              descriptionId={handoffDescriptionId}
              onTitleChange={setNewTitle}
              onDescriptionChange={setNewDescription}
              onAdd={() => void addHandoffItem()}
              onDelete={(id) => void deleteItem(id)}
              onUpdate={(id, payload) => updateHandoffItem(id, payload)}
              onReject={(id) => void rejectHandoffItem(id)}
              onSend={() => void sendHandoff()}
              linked={!!linked}
            />
          </IntegrationStep>
        ) : null}

        {projectType === "LEGACY" && promotableIds.length > 0 ? (
          <IntegrationStep
            step={2}
            status={linked ? "active" : "pending"}
            title="Nueva etapa desde integración"
            description="Promueve ítems handoff SENT a una etapa dedicada con trazabilidad NEW-LEG."
          >
            <WorkshopPanelButton
              tone="primary"
              disabled={!linked}
              className="inline-flex items-center gap-2"
              onClick={() => setPromoteOpen(true)}
            >
              <GitBranch className="h-3.5 w-3.5" aria-hidden />
              Nueva etapa desde integración
            </WorkshopPanelButton>
          </IntegrationStep>
        ) : null}

        {projectType === "LEGACY" && activeStageOrdinal >= 2 ? (
          <IntegrationStep
            step={promotableIds.length > 0 ? 3 : 2}
            status={
              activeStageIsArchived
                ? "done"
                : handoffImportedOnActiveStage
                  ? "done"
                  : linked
                    ? "active"
                    : "pending"
            }
            title={`Recibir handoff · etapa ${activeStageOrdinal}`}
            description="Importa las solicitudes del proyecto NEW enlazado en esta etapa. Tras importar o promover, The Forge analiza el cambio en Modificación (Ariadne)."
          >
            <div className="space-y-4">
              {activeStageIsArchived ? (
                <p className="flex items-center gap-2.5 text-sm leading-relaxed text-[var(--foreground-muted)]">
                  <Archive className="h-4 w-4 shrink-0" aria-hidden />
                  Etapa <strong className="text-[var(--foreground)]">archivada</strong> — intento de integración
                  revertido. Sigue visible en el selector de etapas; entregables congelados en snapshot.
                </p>
              ) : null}
              {handoffImportedOnActiveStage && !activeStageIsArchived ? (
                <p className="flex items-center gap-2.5 text-sm leading-relaxed text-[color-mix(in_oklch,var(--success)_88%,var(--foreground))]">
                  <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden />
                  Importado: {new Date(handoffImportedOnActiveStage).toLocaleString()}
                </p>
              ) : null}
              {handoffImportedOnActiveStage && legacyAnalyzeDone ? (
                <p className="text-sm leading-relaxed text-[var(--foreground-muted)]">
                  Análisis Ariadne listo — revisa archivos y preguntas en{" "}
                  <strong className="text-[var(--foreground)]">Modificación</strong>.
                </p>
              ) : handoffImportedOnActiveStage ? (
                <p className="text-sm leading-relaxed text-[var(--foreground-muted)]">
                  Handoff en la etapa. Si promoviste antes del deploy o el análisis falló, usa{" "}
                  <strong className="text-[var(--foreground)]">Re-sincronizar Ariadne</strong>.
                </p>
              ) : null}
              {!activeStageIsArchived ? (
              <div className="flex flex-wrap gap-2">
                <WorkshopPanelButton
                  tone="primary"
                  disabled={!linked || !!handoffImportedOnActiveStage}
                  className="inline-flex items-center gap-2"
                  onClick={() => void importHandoff()}
                >
                  <Download className="h-3.5 w-3.5" aria-hidden />
                  Importar handoff del proyecto NEW
                </WorkshopPanelButton>
                {handoffImportedOnActiveStage ? (
                  <>
                    <WorkshopPanelButton
                      tone="secondary"
                      disabled={!linked || reconcileSubmitting}
                      className="inline-flex items-center gap-2"
                      onClick={() => void reconcileHandoff()}
                    >
                      <RefreshCw
                        className={`h-3.5 w-3.5 ${reconcileSubmitting ? "animate-spin" : ""}`}
                        aria-hidden
                      />
                      {reconcileSubmitting ? "Sincronizando…" : "Re-sincronizar Ariadne"}
                    </WorkshopPanelButton>
                    <WorkshopPanelButton
                      tone="secondary"
                      disabled={!linked || abandonSubmitting}
                      className="inline-flex items-center gap-2"
                      onClick={() => setAbandonOpen(true)}
                    >
                      <Archive className="h-3.5 w-3.5" aria-hidden />
                      Revertir promoción
                    </WorkshopPanelButton>
                  </>
                ) : null}
                {onOpenModification ? (
                  <WorkshopPanelButton
                    tone="secondary"
                    className="inline-flex items-center gap-2"
                    onClick={onOpenModification}
                  >
                    <Sparkles className="h-3.5 w-3.5" aria-hidden />
                    Ir a Modificación
                  </WorkshopPanelButton>
                ) : null}
              </div>
              ) : null}
              {handoffImportedOnActiveStage && !activeStageIsArchived && promotableIds.length > 0 ? (
                <p className="text-xs text-[var(--foreground-muted)]">
                  Tras revertir, corrige ítems en el NEW y usa{" "}
                  <strong className="text-[var(--foreground)]">Nueva etapa desde integración</strong> para un lote
                  limpio.
                </p>
              ) : null}
            </div>
          </IntegrationStep>
        ) : null}
      </ol>

      <TraceMatrix traces={status?.traces ?? []} onOpenPreview={(t) => void openHandoffPreview(t)} />

      <Dialog open={abandonOpen} onOpenChange={setAbandonOpen}>
        <DialogContent size="md" className="gap-0 p-0">
          <DialogHeader className="border-b border-[var(--border)] px-4 py-3 text-left">
            <DialogTitle>Revertir promoción de handoff</DialogTitle>
            <DialogDescription>
              Archiva la etapa {activeStageOrdinal} (visible como ARCHIVED + snapshot). Libera los NEW-LEG para
              promover de nuevo en otra etapa. La etapa 1 AS-IS no se modifica.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 p-4">
            <div className="space-y-2">
              <label htmlFor="abandon-reason" className="text-xs font-medium text-[var(--foreground)]">
                Motivo (opcional)
              </label>
              <textarea
                id="abandon-reason"
                className="flex min-h-[72px] w-full rounded-md border border-[var(--input-border)] bg-[var(--input)] px-3 py-2 text-sm"
                value={abandonReason}
                onChange={(e) => setAbandonReason(e.target.value)}
                placeholder="Ej. alcance mal definido, redefinir handoff desde cero"
              />
            </div>
            <label className="flex items-start gap-2 text-sm text-[var(--foreground-muted)] cursor-pointer">
              <input
                type="checkbox"
                className="mt-1"
                checked={abandonRejectItems}
                onChange={(e) => setAbandonRejectItems(e.target.checked)}
              />
              <span>
                Marcar ítems NEW-LEG liberados como <strong className="text-[var(--foreground)]">rejected</strong>{" "}
                (si no, vuelven a <code className="text-xs">sent</code> y podés editarlos en el NEW).
              </span>
            </label>
            <div className="flex flex-wrap justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={() => setAbandonOpen(false)}>
                Cancelar
              </Button>
              <WorkshopPanelButton
                tone="primary"
                disabled={abandonSubmitting}
                onClick={() => void abandonHandoffStage()}
              >
                {abandonSubmitting ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                ) : (
                  <Archive className="h-3.5 w-3.5" aria-hidden />
                )}
                Archivar etapa y liberar handoff
              </WorkshopPanelButton>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent size="lg" className="gap-0 p-0">
          <DialogHeader className="border-b border-[var(--border)] px-4 py-3 text-left">
            <DialogTitle className="font-mono text-base">
              {previewTrace?.newLegId ?? "Handoff"}
            </DialogTitle>
            <DialogDescription>
              Vista previa como historia de usuario (solo integración). Se actualiza al editar el ítem en el
              proyecto NEW. No se escribe en Historias de Usuario del legacy hasta promover a nueva etapa.
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-[70vh] overflow-y-auto p-4">
            {previewLoading ? (
              <div className="flex items-center justify-center gap-2 py-12 text-sm text-[var(--muted-foreground)]">
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                Sincronizando desde proyecto NEW…
              </div>
            ) : previewMarkdown ? (
              <article className="prose prose-sm max-w-none text-[var(--foreground)] dark:prose-invert">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{previewMarkdown}</ReactMarkdown>
              </article>
            ) : (
              <p className="py-8 text-center text-sm text-[var(--foreground-muted)]">
                Sin descripción en el proyecto NEW. Edita el handoff allí para ver la historia aquí.
              </p>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <Card>
        <div className="px-5 pt-5 sm:px-6 sm:pt-6">
          <CardTitle className="text-sm font-semibold">Webhook converge (CI)</CardTitle>
          <CardDescription className="mt-1.5">
            URL por proyecto para <code className="text-xs">POST /projects/:id/converge/trigger</code>.
            Si está vacío, se usa la variable de entorno <code className="text-xs">CONVERGE_WEBHOOK_URL</code>.
          </CardDescription>
        </div>
        <CardContent className="flex flex-col gap-3 px-5 pb-5 pt-4 sm:px-6 sm:pb-6">
          <Input
            type="url"
            placeholder="https://hooks.example.com/theforge-converge"
            value={convergeWebhookUrl}
            onChange={(e) => setConvergeWebhookUrl(e.target.value)}
          />
          <WorkshopPanelButton
            tone="secondary"
            disabled={convergeWebhookSaving}
            className="self-start inline-flex items-center gap-2"
            onClick={() => void saveConvergeWebhook()}
          >
            {convergeWebhookSaving ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
            ) : null}
            Guardar webhook
          </WorkshopPanelButton>
        </CardContent>
      </Card>

      <Dialog open={promoteOpen} onOpenChange={setPromoteOpen}>
        <DialogContent size="lg" className="gap-0 p-0">
          <DialogHeader className="border-b border-[var(--border)] px-4 py-3 text-left">
            <DialogTitle>Nueva etapa desde integración</DialogTitle>
            <DialogDescription>
              Selecciona ítems SENT, revisa la descripción de cambio y crea una etapa legacy dedicada.
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-[70vh] space-y-4 overflow-y-auto p-4">
            <div className="space-y-2">
              <label htmlFor="promote-stage-name" className="text-xs font-medium text-[var(--foreground)]">
                Nombre de etapa
              </label>
              <Input
                id="promote-stage-name"
                value={promoteStageName}
                onChange={(e) => setPromoteStageName(e.target.value)}
              />
            </div>
            <fieldset className="space-y-2">
              <legend className="text-xs font-medium text-[var(--foreground)]">Ítems handoff</legend>
              <ul className="space-y-2">
                {linkedNewHandoffItems
                  .filter((item) => promotableIds.includes(item.id))
                  .map((item) => (
                    <li key={item.id} className="flex items-start gap-2 rounded-lg px-2 py-1.5">
                      <input
                        type="checkbox"
                        className="mt-1"
                        checked={promoteSelectedIds.includes(item.id)}
                        onChange={(e) => {
                          setPromoteSelectedIds((prev) =>
                            e.target.checked
                              ? [...new Set([...prev, item.id])]
                              : prev.filter((id) => id !== item.id),
                          );
                        }}
                      />
                      <span className="min-w-0">
                        <span className="font-mono text-xs text-[var(--primary)]">{item.id}</span>
                        <span className="mt-0.5 block text-sm font-medium text-[var(--foreground)]">
                          {item.title}
                        </span>
                      </span>
                    </li>
                  ))}
              </ul>
            </fieldset>
            {promotePreviewDescription ? (
              <div className="space-y-2">
                <p className="text-xs font-medium text-[var(--foreground)]">Vista previa descripción</p>
                <pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded-lg bg-[color-mix(in_oklch,var(--muted)_16%,var(--card))] p-3 text-xs text-[var(--foreground-muted)]">
                  {promotePreviewDescription}
                </pre>
              </div>
            ) : null}
            <div className="flex flex-wrap justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={() => setPromoteOpen(false)}>
                Cancelar
              </Button>
              <WorkshopPanelButton
                tone="primary"
                disabled={promoteSubmitting || promoteSelectedIds.length === 0}
                onClick={() => void submitPromoteToStage()}
              >
                {promoteSubmitting ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                ) : (
                  <GitBranch className="h-3.5 w-3.5" aria-hidden />
                )}
                Confirmar nueva etapa
              </WorkshopPanelButton>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={pickerOpen} onOpenChange={setPickerOpen}>
        <DialogContent size="md" className="gap-0 p-0">
          <DialogHeader className="border-b border-[var(--border)] px-4 py-3 text-left">
            <DialogTitle>
              {projectType === "NEW" ? "Enlazar proyecto legacy" : "Enlazar proyecto nuevo"}
            </DialogTitle>
            <DialogDescription>
              {projectType === "NEW"
                ? "Elige el sistema existente cuya documentación AS-IS alimentará este módulo."
                : "Elige el proyecto nuevo que gestionará cambios sobre este legacy."}
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-80 overflow-y-auto p-2">
            {pickerLoading ? (
              <div className="flex items-center justify-center gap-2 py-10 text-sm text-[var(--muted-foreground)]">
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                Cargando proyectos…
              </div>
            ) : pickerProjects.length === 0 ? (
              <EmptyState
                className="min-h-[220px] border-none bg-transparent"
                title="Sin proyectos disponibles"
                description={
                  projectType === "NEW"
                    ? "Crea primero un proyecto LEGACY con documentación de etapa 1."
                    : "No hay proyectos NEW compatibles para enlazar."
                }
                icon={Link2}
              />
            ) : (
              <ul className="space-y-1">
                {pickerProjects.map((p) => (
                  <li key={p.id}>
                    <button
                      type="button"
                      className="flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2.5 text-left transition-colors hover:bg-[color-mix(in_oklch,var(--muted)_45%,var(--card))]"
                      onClick={() => void linkProject(p.id).catch(() => setError("Enlace fallido"))}
                    >
                      <span className="min-w-0">
                        <span className="block truncate font-medium text-[var(--foreground)]">{p.name}</span>
                        <span className="mt-0.5 block font-mono text-[10px] text-[var(--foreground-subtle)]">
                          {p.id}
                        </span>
                      </span>
                      <div className="flex shrink-0 items-center gap-1.5">
                        {p.hasBaselineMdd ? (
                          <Badge variant="success" className="text-[10px]">
                            AS-IS
                          </Badge>
                        ) : null}
                        <Badge variant="outline" className="text-[10px] uppercase">
                          {p.projectType}
                        </Badge>
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function IntegrationOverview({
  projectType,
  projectName,
  linked,
  warnings,
}: {
  projectType: "NEW" | "LEGACY";
  projectName: string;
  linked: { name: string; projectType: string } | null;
  warnings: string[];
}) {
  const purposeCopy =
    projectType === "NEW"
      ? "Gestiona este módulo como proyecto independiente, conectado al legacy para heredar contexto AS-IS y coordinar cambios."
      : "Recibe solicitudes de proyectos nuevos enlazados y mantén trazabilidad entre lo existente y lo que se construye.";

  return (
    <Card className="overflow-hidden border-[color-mix(in_oklch,var(--primary)_22%,var(--border))] bg-[color-mix(in_oklch,var(--primary)_4%,var(--card))]">
      <CardContent className="space-y-5 p-5 sm:p-6">
        <p className="text-sm leading-relaxed text-[var(--foreground-muted)]">{purposeCopy}</p>

        <ConnectionDiagram
          currentName={projectName}
          currentType={projectType}
          linkedName={linked?.name ?? null}
          linkedType={linked?.projectType ?? (projectType === "NEW" ? "LEGACY" : "NEW")}
          isLinked={!!linked}
        />

        {warnings.length > 0 ? (
          <ul
            className="space-y-2 rounded-lg border border-[color-mix(in_oklch,var(--info)_30%,var(--border))] bg-[color-mix(in_oklch,var(--info)_7%,var(--card))] px-4 py-3"
            role="list"
            aria-label="Siguientes pasos"
          >
            {warnings.map((warning) => (
              <li
                key={warning}
                className="flex items-start gap-2 text-sm leading-snug text-[color-mix(in_oklch,var(--info)_88%,var(--foreground))]"
              >
                <span
                  className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-[color-mix(in_oklch,var(--info)_75%,var(--foreground))]"
                  aria-hidden
                />
                {warning}
              </li>
            ))}
          </ul>
        ) : null}
      </CardContent>
    </Card>
  );
}

function ConnectionDiagram({
  currentName,
  currentType,
  linkedName,
  linkedType,
  isLinked,
}: {
  currentName: string;
  currentType: string;
  linkedName: string | null;
  linkedType: string;
  isLinked: boolean;
}) {
  return (
    <div
      className="grid gap-3 rounded-xl border border-[var(--border)] bg-[color-mix(in_oklch,var(--card)_88%,var(--background))] p-3 sm:grid-cols-[1fr_auto_1fr] sm:items-center sm:gap-4 sm:p-4"
      aria-label="Diagrama de enlace entre proyectos"
    >
      <ProjectNode name={currentName} type={currentType} emphasis />
      <div className="flex flex-col items-center justify-center gap-1 px-1 text-[var(--foreground-subtle)]">
        <ArrowLeftRight
          className={cn(
            "h-5 w-5",
            isLinked ? "text-[var(--primary)]" : "text-[var(--foreground-subtle)]",
          )}
          aria-hidden
        />
        <span className="text-[10px] font-medium uppercase tracking-wide">
          {isLinked ? "Enlazados" : "Sin enlace"}
        </span>
      </div>
      <ProjectNode
        name={linkedName ?? (linkedType === "LEGACY" ? "Legacy por enlazar" : "Nuevo por enlazar")}
        type={linkedType}
        muted={!isLinked}
      />
    </div>
  );
}

function ProjectNode({
  name,
  type,
  emphasis = false,
  muted = false,
}: {
  name: string;
  type: string;
  emphasis?: boolean;
  muted?: boolean;
}) {
  const isNew = type === "NEW";
  const Icon = isNew ? Sparkles : GitBranch;

  return (
    <div
      className={cn(
        "flex min-w-0 items-start gap-3 rounded-lg border px-3 py-2.5",
        emphasis
          ? "border-[color-mix(in_oklch,var(--primary)_35%,var(--border))] bg-[color-mix(in_oklch,var(--primary)_8%,var(--card))]"
          : "border-[var(--border)] bg-[color-mix(in_oklch,var(--muted)_12%,var(--card))]",
        muted && "opacity-70",
      )}
    >
      <span
        className={cn(
          "flex h-8 w-8 shrink-0 items-center justify-center rounded-md",
          isNew
            ? "bg-[color-mix(in_oklch,var(--success)_14%,var(--card))] text-[color-mix(in_oklch,var(--success)_88%,var(--foreground))]"
            : "bg-[color-mix(in_oklch,var(--primary)_12%,var(--card))] text-[var(--primary)]",
        )}
      >
        <Icon className="h-4 w-4" aria-hidden />
      </span>
      <div className="min-w-0">
        <p className="truncate text-sm font-medium text-[var(--foreground)]">{name}</p>
        <Badge variant="outline" className="mt-1 text-[10px] uppercase tracking-wide">
          {type}
        </Badge>
      </div>
    </div>
  );
}

function IntegrationStep({
  step,
  status,
  title,
  description,
  children,
}: {
  step: number;
  status: StepStatus;
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <li>
      <Card className="overflow-hidden">
        <div className="px-5 pt-5 sm:px-6 sm:pt-6">
          <div className="flex items-start gap-3.5">
            <StepIndicator step={step} status={status} />
            <div className="min-w-0 flex-1 space-y-1.5 pt-0.5">
              <h3 className="text-sm font-semibold leading-snug text-[var(--foreground)]">{title}</h3>
              <p className="text-sm leading-relaxed text-[var(--foreground-muted)]">{description}</p>
            </div>
          </div>
        </div>
        <div className="mx-5 my-5 border-t border-[var(--border)] sm:mx-6" />
        <div className="px-5 pb-5 sm:px-6 sm:pb-6">
          <div className="sm:pl-[2.875rem]">{children}</div>
        </div>
      </Card>
    </li>
  );
}

function StepIndicator({ step, status }: { step: number; status: StepStatus }) {
  return (
    <span
      className={cn(
        "mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold",
        status === "done" &&
          "bg-[color-mix(in_oklch,var(--success)_16%,var(--card))] text-[color-mix(in_oklch,var(--success)_90%,var(--foreground))]",
        status === "active" &&
          "bg-[color-mix(in_oklch,var(--primary)_14%,var(--card))] text-[var(--primary)] ring-2 ring-[color-mix(in_oklch,var(--primary)_28%,transparent)]",
        status === "pending" &&
          "bg-[color-mix(in_oklch,var(--muted)_50%,var(--card))] text-[var(--foreground-subtle)]",
      )}
      aria-label={`Paso ${step}${status === "done" ? ", completado" : status === "active" ? ", en curso" : ", pendiente"}`}
    >
      {status === "done" ? <CheckCircle2 className="h-4 w-4" aria-hidden /> : step}
    </span>
  );
}

function LinkedProjectCard({
  linked,
  onUnlink,
}: {
  linked: { id: string; name: string; projectType: string; hasBaselineMdd: boolean };
  onUnlink: () => void;
}) {
  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0 space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <p className="truncate text-sm font-medium text-[var(--foreground)]">{linked.name}</p>
          <Badge variant="outline" className="text-[10px] uppercase tracking-wide">
            {linked.projectType}
          </Badge>
          {linked.hasBaselineMdd ? (
            <Badge variant="success" className="text-[10px]">
              MDD AS-IS
            </Badge>
          ) : (
            <Badge variant="warning" className="text-[10px]">
              Sin MDD etapa 1
            </Badge>
          )}
        </div>
        <p className="truncate font-mono text-xs text-[var(--foreground-subtle)]">{linked.id}</p>
      </div>
      <Button type="button" variant="outline" size="sm" className="inline-flex shrink-0 gap-2" onClick={onUnlink}>
        <Unlink className="h-3.5 w-3.5" aria-hidden />
        Desvincular
      </Button>
    </div>
  );
}

function UnlinkedProjectCard({
  targetLabel,
  onLink,
}: {
  targetLabel: string;
  onLink: () => void;
}) {
  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
      <p className="text-sm leading-relaxed text-[var(--foreground-muted)]">
        Aún no hay un {targetLabel} conectado a este Workshop.
      </p>
      <WorkshopPanelButton tone="primary" onClick={onLink} className="inline-flex shrink-0 items-center gap-2">
        <Link2 className="h-3.5 w-3.5" aria-hidden />
        Enlazar proyecto
      </WorkshopPanelButton>
    </div>
  );
}

function HandoffEditor({
  items,
  newTitle,
  newDescription,
  titleId,
  descriptionId,
  onTitleChange,
  onDescriptionChange,
  onAdd,
  onDelete,
  onUpdate,
  onReject,
  onSend,
  linked,
}: {
  items: IntegrationHandoffItem[];
  newTitle: string;
  newDescription: string;
  titleId: string;
  descriptionId: string;
  onTitleChange: (v: string) => void;
  onDescriptionChange: (v: string) => void;
  onAdd: () => void;
  onDelete: (id: string) => void;
  onUpdate: (
    id: string,
    payload: {
      title: string;
      description: string;
      actor?: string;
      acceptanceCriteria?: string[];
    },
  ) => Promise<boolean>;
  onReject: (id: string) => void;
  onSend: () => void;
  linked: boolean;
}) {
  const canAdd = newTitle.trim().length > 0 && newDescription.trim().length > 0;
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editSaving, setEditSaving] = useState(false);

  return (
    <div className="space-y-5">
      <div className="space-y-4 rounded-lg border border-[var(--border)] bg-[color-mix(in_oklch,var(--muted)_12%,var(--card))] p-4 sm:p-5">
        <div className="space-y-2">
          <label htmlFor={titleId} className="text-xs font-medium text-[var(--foreground)]">
            Título del cambio
          </label>
          <Input
            id={titleId}
            placeholder="Ej. Token OAuth para el cotizador"
            value={newTitle}
            onChange={(e) => onTitleChange(e.target.value)}
            disabled={!linked}
          />
        </div>
        <div className="space-y-2">
          <label htmlFor={descriptionId} className="text-xs font-medium text-[var(--foreground)]">
            Historia en lenguaje natural (qué debe hacer el legacy)
          </label>
          <textarea
            id={descriptionId}
            className="flex min-h-[100px] w-full rounded-md border border-[var(--input-border)] bg-[var(--input)] px-3 py-2.5 text-sm text-[var(--foreground)] shadow-sm placeholder:text-[var(--foreground-muted)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--ring)] disabled:cursor-not-allowed disabled:opacity-60"
            placeholder="Describe el cambio que el equipo legacy debe implementar para soportar este módulo…"
            value={newDescription}
            onChange={(e) => onDescriptionChange(e.target.value)}
            rows={4}
            disabled={!linked}
          />
        </div>
        <div className="flex flex-wrap items-center gap-2.5 pt-1">
          <Button type="button" size="sm" variant="outline" className="gap-2" disabled={!linked || !canAdd} onClick={onAdd}>
            <Plus className="h-3.5 w-3.5" aria-hidden />
            Añadir ítem
          </Button>
          <Button type="button" size="sm" className="gap-2" disabled={!linked || !items.length} onClick={onSend}>
            <Send className="h-3.5 w-3.5" aria-hidden />
            Enviar al legacy
          </Button>
        </div>
      </div>

      {items.length === 0 ? (
        <EmptyState
          className="min-h-[168px] rounded-lg border border-dashed border-[var(--border)] bg-transparent px-4 py-8"
          title="Sin solicitudes aún"
          description={
            linked
              ? "Añade ítems que describan qué debe cambiar el legacy para este módulo."
              : "Enlaza un proyecto legacy antes de crear solicitudes handoff."
          }
          icon={Send}
        />
      ) : (
        <ul className="space-y-2" role="list">
          {items.map((item) =>
            editingId === item.id ? (
              <HandoffItemEditForm
                key={item.id}
                item={item}
                saving={editSaving}
                onCancel={() => setEditingId(null)}
                onSave={async (payload) => {
                  setEditSaving(true);
                  try {
                    const ok = await onUpdate(item.id, payload);
                    if (ok) setEditingId(null);
                  } finally {
                    setEditSaving(false);
                  }
                }}
              />
            ) : (
              <li
                key={item.id}
                className="rounded-lg border border-[var(--border)] bg-[color-mix(in_oklch,var(--card)_92%,var(--background))] px-3 py-3"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-xs text-[var(--primary)]">{item.id}</span>
                      <HandoffStatusBadge status={item.status} />
                    </div>
                    <p className="mt-1.5 font-medium text-[var(--foreground)]">{item.title}</p>
                    <p className="mt-1 text-sm leading-relaxed text-[var(--foreground-muted)]">
                      {item.description}
                    </p>
                    {item.actor?.trim() ? (
                      <p className="mt-1 text-xs text-[var(--foreground-muted)]">
                        <span className="font-medium text-[var(--foreground)]">Actor:</span> {item.actor}
                      </p>
                    ) : null}
                    {item.acceptanceCriteria?.length ? (
                      <ul className="mt-2 list-inside list-disc text-xs text-[var(--foreground-muted)]">
                        {item.acceptanceCriteria.map((ac) => (
                          <li key={ac}>{ac}</li>
                        ))}
                      </ul>
                    ) : null}
                  </div>
                  <div className="flex shrink-0 items-center gap-0.5">
                    {(item.status === "sent" || item.status === "accepted") && linked ? (
                      <button
                        type="button"
                        className="rounded-md px-1.5 py-1 text-[10px] font-medium uppercase tracking-wide text-[color-mix(in_oklch,var(--destructive)_80%,var(--foreground))] transition-colors hover:bg-[color-mix(in_oklch,var(--destructive)_10%,transparent)]"
                        onClick={() => onReject(item.id)}
                        aria-label={`Rechazar ${item.id}`}
                      >
                        Rechazar
                      </button>
                    ) : null}
                    <button
                      type="button"
                      className="rounded-md p-1.5 text-[var(--foreground-subtle)] transition-colors hover:bg-[color-mix(in_oklch,var(--muted)_50%,transparent)] hover:text-[var(--foreground)]"
                      onClick={() => setEditingId(item.id)}
                      aria-label={`Editar ${item.id}`}
                      disabled={!linked}
                    >
                      <Pencil className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      className="rounded-md p-1.5 text-[var(--foreground-subtle)] transition-colors hover:bg-[color-mix(in_oklch,var(--destructive)_10%,transparent)] hover:text-[color-mix(in_oklch,var(--destructive)_88%,var(--foreground))]"
                      onClick={() => onDelete(item.id)}
                      aria-label={`Eliminar ${item.id}`}
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              </li>
            ),
          )}
        </ul>
      )}

      {items.length > 0 ? (
        <p className="text-xs text-[var(--foreground-muted)]">
          {items.length} solicitud{items.length === 1 ? "" : "es"} · edita en cualquier momento; el legacy ve
          los cambios al abrir la vista previa en la matriz de trazabilidad.
        </p>
      ) : null}
    </div>
  );
}

function HandoffItemEditForm({
  item,
  saving,
  onCancel,
  onSave,
}: {
  item: IntegrationHandoffItem;
  saving: boolean;
  onCancel: () => void;
  onSave: (payload: {
    title: string;
    description: string;
    actor?: string;
    acceptanceCriteria?: string[];
  }) => Promise<void>;
}) {
  const [title, setTitle] = useState(item.title);
  const [description, setDescription] = useState(item.description ?? "");
  const [actor, setActor] = useState(item.actor ?? "");
  const [criteriaText, setCriteriaText] = useState((item.acceptanceCriteria ?? []).join("\n"));
  const canSave = title.trim().length > 0 && description.trim().length > 0;

  const handleSave = () => {
    if (!canSave || saving) return;
      const acceptanceCriteria = criteriaText
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
    void onSave({
      title,
      description,
      actor: actor.trim(),
      acceptanceCriteria,
    });
  };

  return (
    <li className="rounded-lg border border-[color-mix(in_oklch,var(--primary)_28%,var(--border))] bg-[color-mix(in_oklch,var(--primary)_4%,var(--card))] px-3 py-3">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className="font-mono text-xs text-[var(--primary)]">{item.id}</span>
        <HandoffStatusBadge status={item.status} />
        <span className="text-[10px] uppercase tracking-wide text-[var(--foreground-muted)]">Editando</span>
      </div>
      <div className="space-y-3">
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-[var(--foreground)]">Título</label>
          <Input value={title} onChange={(e) => setTitle(e.target.value)} disabled={saving} />
        </div>
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-[var(--foreground)]">Historia en lenguaje natural</label>
          <textarea
            className="flex min-h-[88px] w-full rounded-md border border-[var(--input-border)] bg-[var(--input)] px-3 py-2 text-sm text-[var(--foreground)] shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--ring)] disabled:opacity-60"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={4}
            disabled={saving}
          />
        </div>
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-[var(--foreground)]">Actor (opcional)</label>
          <Input
            placeholder="Ej. vendedor, administrador de campañas"
            value={actor}
            onChange={(e) => setActor(e.target.value)}
            disabled={saving}
          />
        </div>
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-[var(--foreground)]">
            Criterios de aceptación (opcional, uno por línea)
          </label>
          <textarea
            className="flex min-h-[64px] w-full rounded-md border border-[var(--input-border)] bg-[var(--input)] px-3 py-2 text-sm text-[var(--foreground)] shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--ring)] disabled:opacity-60"
            value={criteriaText}
            onChange={(e) => setCriteriaText(e.target.value)}
            rows={3}
            disabled={saving}
            placeholder="- Dado… cuando… entonces…"
          />
        </div>
        <div className="flex flex-wrap gap-2 pt-1">
          <Button type="button" size="sm" disabled={!canSave || saving} onClick={handleSave}>
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : null}
            Guardar
          </Button>
          <Button type="button" size="sm" variant="outline" disabled={saving} onClick={onCancel}>
            Cancelar
          </Button>
        </div>
      </div>
    </li>
  );
}

function HandoffStatusBadge({ status }: { status: string }) {
  if (status === "sent" || status === "accepted") {
    return (
      <Badge variant="success" className="text-[10px] uppercase">
        {status}
      </Badge>
    );
  }
  if (status === "implemented") {
    return (
      <Badge variant="default" className="text-[10px] uppercase">
        {status}
      </Badge>
    );
  }
  if (status === "rejected") {
    return (
      <Badge variant="destructive" className="text-[10px] uppercase">
        rejected
      </Badge>
    );
  }
  return (
    <Badge variant="secondary" className="text-[10px] uppercase">
      {status}
    </Badge>
  );
}

function TraceMatrix({
  traces,
  onOpenPreview,
}: {
  traces: IntegrationTraceRow[];
  onOpenPreview: (trace: IntegrationTraceRow) => void;
}) {
  if (!traces.length) return null;
  return (
    <Card>
      <div className="px-5 pt-5 sm:px-6 sm:pt-6">
        <CardTitle className="text-sm font-semibold">Trazabilidad NEW-LEG ↔ LEG</CardTitle>
        <CardDescription className="mt-1.5">
          Seguimiento entre solicitudes del módulo nuevo e historias implementadas en legacy. Haz clic en un
          NEW-LEG para ver la historia de usuario sincronizada (solo vista de integración).
        </CardDescription>
      </div>
      <CardContent className="overflow-x-auto px-5 pb-5 pt-4 sm:px-6 sm:pb-6">
        <table className="w-full min-w-[28rem] border-collapse text-left text-xs">
          <thead>
            <tr className="border-b border-[var(--border)] text-[var(--foreground-muted)]">
              <th className="py-2 pr-3 font-medium">NEW-LEG</th>
              <th className="py-2 pr-3 font-medium">LEG</th>
              <th className="py-2 pr-3 font-medium">Estado</th>
              <th className="py-2 font-medium">Título</th>
            </tr>
          </thead>
          <tbody>
            {traces.map((t) => (
              <tr key={t.id} className="border-b border-[color-mix(in_oklch,var(--border)_70%,transparent)]">
                <td className="py-2.5 pr-3">
                  <button
                    type="button"
                    className="font-mono text-[var(--primary)] underline-offset-2 hover:underline"
                    onClick={() => onOpenPreview(t)}
                  >
                    {t.newLegId}
                  </button>
                </td>
                <td className="py-2.5 pr-3 font-mono text-[var(--foreground)]">{t.legacyStoryId ?? "—"}</td>
                <td className="py-2.5 pr-3">
                  <HandoffStatusBadge status={t.status} />
                </td>
                <td className="py-2.5 text-[var(--foreground-muted)]">
                  <button
                    type="button"
                    className="text-left hover:text-[var(--foreground)] hover:underline"
                    onClick={() => onOpenPreview(t)}
                  >
                    {t.title}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}
