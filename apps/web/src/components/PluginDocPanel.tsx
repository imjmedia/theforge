import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import { FileText } from "lucide-react";
import type { ArtifactTypeDefinition, PluginArtifactProgress } from "@theforge/shared-types";
import { getPluginDocPanelHeader, parsePluginPanelId } from "../utils/workshopDocNav";
import {
  generatePluginArtifact,
  getPluginData,
  pluginArtifactRequirementsMessage,
  pollDeliverablesJob,
  setPluginData,
} from "../utils/pluginApi";
import {
  pluginArtifactDefaultViewMode,
  pluginArtifactFromEditorText,
  pluginArtifactToEditorText,
} from "../utils/pluginArtifactContent";
import { useWorkshopStore } from "../store/workshopStore";
import { StandardDocPanel } from "./StandardDocPanel";

interface PluginDocPanelProps {
  panel: string;
  projectId: string;
  artifactTypes: ArtifactTypeDefinition[];
  stageId?: string | null;
}

function projectDeliverablesForArtifact(
  project: Record<string, unknown> | null,
  mddContent: string,
): Record<string, string | null | undefined> {
  if (!project) return { mddContent };
  return {
    mddContent,
    dbgaContent: typeof project.dbgaContent === "string" ? project.dbgaContent : null,
    specContent: typeof project.specContent === "string" ? project.specContent : null,
    phase0SummaryContent:
      typeof project.phase0SummaryContent === "string" ? project.phase0SummaryContent : null,
    architectureContent:
      typeof project.architectureContent === "string" ? project.architectureContent : null,
    useCasesContent: typeof project.useCasesContent === "string" ? project.useCasesContent : null,
    userStoriesContent:
      typeof project.userStoriesContent === "string" ? project.userStoriesContent : null,
    blueprintContent: typeof project.blueprintContent === "string" ? project.blueprintContent : null,
    uxUiGuideContent: typeof project.uxUiGuideContent === "string" ? project.uxUiGuideContent : null,
    apiContractsContent:
      typeof project.apiContractsContent === "string" ? project.apiContractsContent : null,
    logicFlowsContent:
      typeof project.logicFlowsContent === "string" ? project.logicFlowsContent : null,
    tasksContent: typeof project.tasksContent === "string" ? project.tasksContent : null,
    infraContent: typeof project.infraContent === "string" ? project.infraContent : null,
    agentGovernanceContent:
      typeof project.agentGovernanceContent === "string" ? project.agentGovernanceContent : null,
    aemContent: typeof project.aemContent === "string" ? project.aemContent : null,
    uiScreensContent:
      typeof project.uiScreensContent === "string" ? project.uiScreensContent : null,
    brdContent: typeof project.brdContent === "string" ? project.brdContent : null,
  };
}

export function PluginDocPanel({
  panel,
  projectId,
  artifactTypes,
  stageId,
}: PluginDocPanelProps): ReactElement | null {
  const parsed = useMemo(() => parsePluginPanelId(panel), [panel]);
  const pluginId = parsed?.pluginId;
  const artifact = useMemo(
    () =>
      parsed
        ? artifactTypes.find((a) => a.pluginId === parsed.pluginId && a.id === parsed.artifactId)
        : undefined,
    [artifactTypes, parsed],
  );
  const header = getPluginDocPanelHeader(panel, artifactTypes);
  const contentType = artifact?.contentType ?? "json";

  const project = useWorkshopStore((s) => s.project);
  const storedPayload = useWorkshopStore((s) =>
    pluginId ? s.pluginData[pluginId] : undefined,
  );
  const patchPluginData = useWorkshopStore((s) => s.patchPluginData);
  const mddContent = useWorkshopStore((s) => s.mddContent);
  const generationStatus = useWorkshopStore((s) => s.generationStatus);
  const fetchGenerationStatus = useWorkshopStore((s) => s.fetchGenerationStatus);
  const setError = useWorkshopStore((s) => s.setError);

  const [content, setContent] = useState<string>("");
  const viewMode = pluginArtifactDefaultViewMode(contentType);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [generationProgress, setGenerationProgress] = useState<PluginArtifactProgress | null>(null);
  const fetchGenerationRef = useRef(0);

  const deliverables = useMemo(
    () => projectDeliverablesForArtifact(project as Record<string, unknown> | null, mddContent),
    [project, mddContent],
  );

  const requirementsBlock = useMemo(
    () => pluginArtifactRequirementsMessage(artifact?.requires, deliverables),
    [artifact?.requires, deliverables],
  );

  const generationBusy = generationStatus?.busy === true;
  const activePluginJob =
    generationStatus?.activeJob?.type === "plugin-artifact" ||
    generationStatus?.queuedJobs.some((j) => j.type === "plugin-artifact");

  const displayProgress = useMemo(() => {
    if (!generating || !generationProgress) return undefined;
    return { percent: generationProgress.percent, detail: generationProgress.detail };
  }, [generationProgress, generating]);

  const generateBlockedReason = useMemo(() => {
    if (requirementsBlock) return requirementsBlock;
    if (loading) return null;
    if (generating) return null;
    if (activePluginJob) {
      return "Hay una generación del plugin en curso. Espera a que termine o recarga el proyecto.";
    }
    if (generationBusy && !activePluginJob) {
      return "Hay otra generación en curso. Espera a que termine.";
    }
    return null;
  }, [requirementsBlock, loading, generating, activePluginJob, generationBusy]);

  const syncEditorFromPayload = useCallback(
    (data: unknown) => {
      setContent(pluginArtifactToEditorText(data, contentType));
    },
    [contentType],
  );

  const reload = useCallback(async () => {
    if (!pluginId) return;
    setLoading(true);
    try {
      const data = await getPluginData(projectId, pluginId);
      patchPluginData(pluginId, data ?? null);
      syncEditorFromPayload(data);
    } finally {
      setLoading(false);
    }
  }, [patchPluginData, pluginId, projectId, syncEditorFromPayload]);

  useEffect(() => {
    if (!pluginId) return;
    if (storedPayload !== undefined) {
      syncEditorFromPayload(storedPayload);
      setLoading(false);
      return;
    }

    const fetchId = ++fetchGenerationRef.current;
    let cancelled = false;
    setLoading(true);

    void (async () => {
      try {
        const data = await getPluginData(projectId, pluginId);
        if (cancelled || fetchId !== fetchGenerationRef.current) return;
        patchPluginData(pluginId, data ?? null);
        syncEditorFromPayload(data);
      } catch {
        if (cancelled || fetchId !== fetchGenerationRef.current) return;
        patchPluginData(pluginId, null);
        syncEditorFromPayload(null);
      } finally {
        if (!cancelled && fetchId === fetchGenerationRef.current) {
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [patchPluginData, pluginId, projectId, storedPayload, syncEditorFromPayload]);

  const handleSave = useCallback(async () => {
    if (!parsed || !pluginId) return;
    const parsedData = pluginArtifactFromEditorText(content, contentType);
    await setPluginData(projectId, pluginId, parsedData as Record<string, unknown>);
    patchPluginData(pluginId, parsedData);
  }, [content, contentType, patchPluginData, pluginId, projectId, parsed]);

  const handleGenerate = useCallback(async () => {
    if (!parsed || !pluginId || !artifact || generateBlockedReason) return;
    setError(null);
    setGenerating(true);
    setGenerationProgress({ percent: 0, step: "start", detail: "Iniciando generación…" });
    void fetchGenerationStatus(projectId);
    try {
      const queued = await generatePluginArtifact(
        projectId,
        parsed.pluginId,
        parsed.artifactId,
        { queue: true, stageId },
      );
      if (!queued.queued) {
        if (queued.data != null) {
          patchPluginData(parsed.pluginId, queued.data);
          syncEditorFromPayload(queued.data);
        }
        return;
      }
      if (!queued.jobId) throw new Error("Cola no devolvió jobId");

      const result = await pollDeliverablesJob<{ data?: unknown }>(queued.jobId, {
        onProgress: (p) => setGenerationProgress(p),
      });
      const data = result?.data ?? result;
      if (data != null) {
        patchPluginData(parsed.pluginId, data);
        syncEditorFromPayload(data);
      } else {
        await reload();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al generar artifact del plugin");
    } finally {
      setGenerating(false);
      setGenerationProgress(null);
      void fetchGenerationStatus(projectId);
    }
  }, [
    artifact,
    fetchGenerationStatus,
    generateBlockedReason,
    parsed,
    patchPluginData,
    pluginId,
    projectId,
    reload,
    setError,
    stageId,
    syncEditorFromPayload,
  ]);

  if (!parsed || !artifact) return null;

  return (
    <StandardDocPanel
      icon={FileText}
      title={header.title}
      description={
        generateBlockedReason
          ? generateBlockedReason
          : `Plugin: ${artifact.label}${contentType !== "json" ? ` (${contentType})` : ""}`
      }
      content={content}
      onContentChange={(v) => setContent(v ?? "")}
      onSave={handleSave}
      isDirty={false}
      viewMode={viewMode}
      onGenerate={() => void handleGenerate()}
      canGenerate={artifact.generatable === true && !generateBlockedReason && !loading}
      isLoading={generating}
      generationProgress={
        generating
          ? (displayProgress ?? { percent: 0, detail: "Iniciando generación…" })
          : undefined
      }
      generateLabel={generating ? "Generando…" : "Generar"}
      generateBlocked={Boolean(generateBlockedReason)}
      generateBlockedReason={generateBlockedReason ?? undefined}
      placeholder={`# ${artifact.label}\n\nContenido generado por el plugin...`}
    />
  );
}
