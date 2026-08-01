import { useCallback, useEffect, useMemo, useState, type ReactElement } from "react";
import { FileText } from "lucide-react";
import type { ArtifactTypeDefinition, PluginArtifactProgress } from "@theforge/shared-types";
import { getPluginDocPanelHeader, parsePluginPanelId } from "../utils/workshopDocNav";
import {
  generateAndPollPluginArtifact,
  fetchDeliverablesJobStatus,
  getPluginData,
  pluginArtifactRequirementsMessage,
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
  const parsed = parsePluginPanelId(panel);
  const artifact = artifactTypes.find(
    (a) => a.pluginId === parsed?.pluginId && a.id === parsed?.artifactId,
  );
  const header = getPluginDocPanelHeader(panel, artifactTypes);
  const contentType = artifact?.contentType ?? "json";

  const project = useWorkshopStore((s) => s.project);
  const storePluginData = useWorkshopStore((s) => s.pluginData);
  const patchPluginData = useWorkshopStore((s) => s.patchPluginData);
  const mddContent = useWorkshopStore((s) => s.mddContent);
  const generationStatus = useWorkshopStore((s) => s.generationStatus);
  const fetchGenerationStatus = useWorkshopStore((s) => s.fetchGenerationStatus);
  const setError = useWorkshopStore((s) => s.setError);

  const storedPayload = parsed ? storePluginData[parsed.pluginId] : undefined;

  const [content, setContent] = useState<string>("");
  const viewMode = pluginArtifactDefaultViewMode(contentType);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [generationProgress, setGenerationProgress] = useState<PluginArtifactProgress | null>(null);

  const deliverables = useMemo(
    () => projectDeliverablesForArtifact(project as Record<string, unknown> | null, mddContent),
    [project, mddContent],
  );

  const requirementsBlock = useMemo(
    () => pluginArtifactRequirementsMessage(artifact?.requires, deliverables),
    [artifact?.requires, deliverables],
  );

  const generationBusy = generationStatus?.busy === true;
  const activePluginJobId =
    generationStatus?.activeJob?.type === "plugin-artifact"
      ? generationStatus.activeJob.jobId
      : generationStatus?.queuedJobs.find((j) => j.type === "plugin-artifact")?.jobId ?? null;
  const activePluginJob = Boolean(activePluginJobId);
  const isPluginGenerating = generating || activePluginJob;

  const displayProgress = useMemo(() => {
    if (generationProgress) {
      return { percent: generationProgress.percent, detail: generationProgress.detail };
    }
    if (isPluginGenerating) {
      return { percent: 0, detail: "Iniciando generación…" };
    }
    return undefined;
  }, [generationProgress, isPluginGenerating]);

  const generateBlockedReason = useMemo(() => {
    if (requirementsBlock) return requirementsBlock;
    if (generationBusy && !activePluginJob) {
      return "Hay otra generación en curso. Espera a que termine.";
    }
    return null;
  }, [requirementsBlock, generationBusy, activePluginJob]);

  const syncEditorFromPayload = useCallback(
    (data: unknown) => {
      setContent(pluginArtifactToEditorText(data, contentType));
    },
    [contentType],
  );

  const reload = useCallback(async () => {
    if (!parsed) return;
    setLoading(true);
    try {
      const fromStore = storePluginData[parsed.pluginId];
      if (fromStore !== undefined) {
        syncEditorFromPayload(fromStore);
        return;
      }
      const data = await getPluginData(projectId, parsed.pluginId);
      if (data != null) patchPluginData(parsed.pluginId, data);
      syncEditorFromPayload(data);
    } finally {
      setLoading(false);
    }
  }, [parsed, patchPluginData, projectId, storePluginData, syncEditorFromPayload]);

  useEffect(() => {
    if (generating || !activePluginJobId || !parsed) return;

    let cancelled = false;
    const pollActiveJob = async () => {
      while (!cancelled) {
        try {
          const status = await fetchDeliverablesJobStatus(activePluginJobId);
          if (
            typeof status.progress === "object" &&
            status.progress !== null &&
            "percent" in status.progress
          ) {
            setGenerationProgress(status.progress as PluginArtifactProgress);
          }
          if (status.status === "completed") {
            const data = (status.result as { data?: unknown } | undefined)?.data ?? status.result;
            if (data != null) {
              patchPluginData(parsed.pluginId, data);
              syncEditorFromPayload(data);
            } else {
              await reload();
            }
            void fetchGenerationStatus(projectId);
            break;
          }
          if (status.status === "failed") {
            setError(status.error ?? "Error al generar artifact del plugin");
            void fetchGenerationStatus(projectId);
            break;
          }
        } catch {
          break;
        }
        await new Promise((r) => setTimeout(r, 2000));
      }
    };

    void pollActiveJob();
    return () => {
      cancelled = true;
    };
  }, [
    activePluginJobId,
    fetchGenerationStatus,
    generating,
    parsed,
    patchPluginData,
    projectId,
    reload,
    setError,
    syncEditorFromPayload,
  ]);

  useEffect(() => {
    if (storedPayload !== undefined) {
      syncEditorFromPayload(storedPayload);
      setLoading(false);
      return;
    }
    void reload();
  }, [reload, storedPayload, syncEditorFromPayload]);

  const handleSave = useCallback(async () => {
    if (!parsed) return;
    const parsedData = pluginArtifactFromEditorText(content, contentType);
    await setPluginData(projectId, parsed.pluginId, parsedData as Record<string, unknown>);
    patchPluginData(parsed.pluginId, parsedData);
  }, [content, contentType, patchPluginData, projectId, parsed]);

  const handleGenerate = useCallback(async () => {
    if (!parsed || !artifact || generateBlockedReason) return;
    setGenerating(true);
    setGenerationProgress({ percent: 0, step: "start", detail: "Iniciando generación…" });
    void fetchGenerationStatus(projectId);
    try {
      const data = await generateAndPollPluginArtifact(
        projectId,
        parsed.pluginId,
        parsed.artifactId,
        {
          stageId,
          onProgress: (p) => setGenerationProgress(p),
        },
      );
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
      canGenerate={artifact.generatable === true && !generateBlockedReason}
      isLoading={loading || isPluginGenerating}
      generationProgress={displayProgress}
      generateLabel={isPluginGenerating ? "Generando…" : "Generar"}
      generateBlocked={Boolean(generateBlockedReason)}
      generateBlockedReason={generateBlockedReason ?? undefined}
      placeholder={`# ${artifact.label}\n\nContenido generado por el plugin...`}
    />
  );
}
