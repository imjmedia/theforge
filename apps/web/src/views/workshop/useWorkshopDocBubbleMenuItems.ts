import { useMemo } from "react";
import {
  BrushCleaning,
  Download,
  HelpCircle,
  ListChecks,
  ListOrdered,
  Printer,
  RefreshCw,
  Sparkles,
  Wand2,
} from "lucide-react";
import { isWorkshopAgentActivityPanel } from "@/utils/workshopDocNav";
import { resolveWorkshopActiveDocumentDownload } from "@/utils/workshopActiveDocumentDownload";
import { downloadMarkdownFile } from "@/utils/downloadMarkdownFile";
import { downloadRepoHandoffFromApi } from "@/utils/downloadRepoHandoff";
import {
  type WorkshopDocBubbleMenuItem,
} from "@/components/WorkshopDocBubbleMenu";
import type { UseWorkshopDocBubbleMenuItemsArgs } from "./useWorkshopDocBubbleMenuItems.types";

export function useWorkshopDocBubbleMenuItems(
  args: UseWorkshopDocBubbleMenuItemsArgs,
): WorkshopDocBubbleMenuItem[] {
  const {
    centralPanel,
    benchmarkPhaseTab,
    dbgaContent,
    phase0SummaryContent,
    specContent,
    mddContent,
    mddInicialLocalContent,
    activeLegacyState,
    brdWorkshopDraft,
    uxUiGuideContent,
    blueprintContent,
    apiContractsContent,
    logicFlowsContent,
    tasksContent,
    infraContent,
    architectureContent,
    useCasesContent,
    userStoriesContent,
    aemContent,
    effectiveMddTrimmed,
    loading,
    projectId,
    mddReviewing,
    mddReapplyingFormat,
    patternsWizardAnalyzing,
    requestGenerateMdd,
    openSuggestMddPatterns,
    openEditMddPatterns,
    reapplyMddFormat,
    handleRegenerateLegacyCodebaseDoc,
    setClarifySpecDialogOpen,
    isGenerationGateBlocked,
    generateSpec,
    generateArchitecture,
    generateUseCases,
    generateUserStories,
    generateBlueprint,
    generateApiContracts,
    generateLogicFlows,
    generateInfra,
    generateTasks,
    tasksPrerequisites,
    hasAgentGovernance,
    generateAgentGovernance,
    canGenerateAem,
    setAemGenerateDialogOpen,
    uxGenProgress,
    uxGenerating,
    generateUxGuideSequential,
    agentGovernanceScaffold,
    activeStageId,
    handleClearMddCompletely,
    clearWorkshopDocumentContent,
    effectiveComplexityForTabs,
    setFlowOrderModalOpen,
    projectName,
    project,
    handlePrintDocument,
    apiBlueprintDmBlocked,
    apiBlueprintBlockedHint,
    deliverablesReadOnly,
  } = args;

  return useMemo((): WorkshopDocBubbleMenuItem[] => {
    if (centralPanel === "legacy" || centralPanel === "adrs" || centralPanel === "integration") return [];
    if (isWorkshopAgentActivityPanel(centralPanel)) return [];

    const ordered: WorkshopDocBubbleMenuItem[] = [];

    const downloadPayload = resolveWorkshopActiveDocumentDownload({
      panel: centralPanel,
      benchmarkPhaseTab,
      dbgaContent,
      phase0SummaryContent,
      specContent,
      mddContent,
      mddInicialContent: mddInicialLocalContent || activeLegacyState?.codebaseDoc || "",
      brdContent: brdWorkshopDraft,
      uxUiGuideContent,
      blueprintContent,
      apiContractsContent,
      logicFlowsContent,
      tasksContent,
      infraContent,
      architectureContent,
      useCasesContent,
      userStoriesContent,
      aemContent,
    });

    let regenItem: WorkshopDocBubbleMenuItem | null = null;
    if (centralPanel === "mdd") {
      regenItem = {
        id: "regen",
        label: mddContent?.trim() ? "Regenerar MDD" : "Generar MDD",
        icon: RefreshCw,
        disabled: loading || !projectId,
        onClick: () => {
          requestGenerateMdd();
        },
      };
      if (effectiveMddTrimmed.length > 0) {
        ordered.push({
          id: "suggest-patterns",
          label: "Analizar y sugerir patrones",
          icon: Sparkles,
          disabled:
            loading ||
            mddReviewing ||
            mddReapplyingFormat ||
            patternsWizardAnalyzing ||
            !projectId,
          onClick: () => void openSuggestMddPatterns(),
        });
        ordered.push({
          id: "edit-patterns",
          label: "Editar patrones (SSOT)",
          icon: ListChecks,
          disabled: loading || mddReviewing || mddReapplyingFormat || !projectId,
          onClick: openEditMddPatterns,
        });
        ordered.push({
          id: "reapply-mdd-format",
          label: "Re-aplicar formato MDD",
          icon: Wand2,
          disabled: loading || mddReviewing || mddReapplyingFormat || !projectId,
          onClick: () => void reapplyMddFormat(),
        });
      }
    } else if (centralPanel === "mdd-inicial" && !!(activeLegacyState?.codebaseDoc ?? mddInicialLocalContent ?? "").trim()) {
      regenItem = {
        id: "regen",
        label: "Regenerar documentación de partida",
        icon: RefreshCw,
        disabled: loading || !projectId,
        onClick: () => void handleRegenerateLegacyCodebaseDoc(),
      };
    } else if (centralPanel === "spec") {
      if (!deliverablesReadOnly) {
        ordered.push({
          id: "clarify",
          label: "Resolver clarificaciones",
          icon: HelpCircle,
          disabled: loading || !projectId,
          onClick: () => setClarifySpecDialogOpen(true),
        });
      }
      if (!!specContent?.trim()) {
        regenItem = {
          id: "regen",
          label: "Regenerar Spec",
          icon: RefreshCw,
          disabled: loading || !projectId || isGenerationGateBlocked("spec"),
          onClick: () => void generateSpec(projectId),
        };
      }
    } else if (centralPanel === "architecture" && !!architectureContent?.trim()) {
      regenItem = {
        id: "regen",
        label: "Regenerar arquitectura",
        icon: RefreshCw,
        disabled: loading || !effectiveMddTrimmed || !projectId || isGenerationGateBlocked("architecture"),
        onClick: () => void generateArchitecture(projectId),
      };
    } else if (centralPanel === "use-cases" && !!useCasesContent?.trim()) {
      regenItem = {
        id: "regen",
        label: "Regenerar casos de uso",
        icon: RefreshCw,
        disabled: loading || !effectiveMddTrimmed || !projectId || isGenerationGateBlocked("use-cases"),
        onClick: () => void generateUseCases(projectId),
      };
    } else if (centralPanel === "user-stories" && !!userStoriesContent?.trim()) {
      regenItem = {
        id: "regen",
        label: "Regenerar historias de usuario",
        icon: RefreshCw,
        disabled: loading || !effectiveMddTrimmed || !projectId || isGenerationGateBlocked("user-stories"),
        onClick: () => void generateUserStories(projectId),
      };
    } else if (centralPanel === "blueprint" && !!blueprintContent?.trim()) {
      regenItem = {
        id: "regen",
        label: "Regenerar blueprint",
        icon: RefreshCw,
        disabled: loading || mddReviewing || !effectiveMddTrimmed || !projectId || isGenerationGateBlocked("blueprint"),
        onClick: () => void generateBlueprint(projectId),
      };
    } else if (centralPanel === "api-contracts" && !!apiContractsContent?.trim()) {
      regenItem = {
        id: "regen",
        label: apiBlueprintDmBlocked ? apiBlueprintBlockedHint : "Regenerar contratos API",
        icon: RefreshCw,
        disabled: loading || mddReviewing || !effectiveMddTrimmed || apiBlueprintDmBlocked || !projectId || isGenerationGateBlocked("api-contracts"),
        onClick: () => void generateApiContracts(projectId),
      };
    } else if (centralPanel === "logic-flows" && !!logicFlowsContent?.trim()) {
      regenItem = {
        id: "regen",
        label: "Regenerar flujos de lógica",
        icon: RefreshCw,
        disabled: loading || mddReviewing || !effectiveMddTrimmed || !projectId || isGenerationGateBlocked("logic-flows"),
        onClick: () => void generateLogicFlows(projectId),
      };
    } else if (centralPanel === "infra" && !!infraContent?.trim()) {
      regenItem = {
        id: "regen",
        label: "Regenerar infraestructura",
        icon: RefreshCw,
        disabled: loading || mddReviewing || !effectiveMddTrimmed || !projectId || isGenerationGateBlocked("infra"),
        onClick: () => void generateInfra(projectId),
      };
    } else if (centralPanel === "tasks" && !!tasksContent?.trim()) {
      regenItem = {
        id: "regen",
        label: "Regenerar tasks",
        icon: RefreshCw,
        disabled: loading || !tasksPrerequisites.ready || !projectId || isGenerationGateBlocked("tasks"),
        onClick: () => void generateTasks(projectId),
      };
    } else if (centralPanel === "agent-governance" && hasAgentGovernance) {
      regenItem = {
        id: "regen",
        label: "Regenerar gobernanza de agentes",
        icon: RefreshCw,
        disabled: loading || !effectiveMddTrimmed || !projectId || isGenerationGateBlocked("agent-governance"),
        onClick: () => void generateAgentGovernance(projectId),
      };
    } else if (centralPanel === "aem" && !!aemContent?.trim()) {
      regenItem = {
        id: "regen",
        label: "Regenerar AEM",
        icon: RefreshCw,
        disabled: loading || !canGenerateAem || !projectId,
        onClick: () => setAemGenerateDialogOpen(true),
      };
    } else if (centralPanel === "ux-ui-guide" && !!uxUiGuideContent?.trim()) {
      regenItem = {
        id: "regen",
        label: uxGenProgress ?? "Regenerar design system",
        icon: RefreshCw,
        disabled: uxGenerating || loading || !effectiveMddTrimmed || !blueprintContent?.trim() || !projectId,
        onClick: () => void generateUxGuideSequential(),
      };
    }

    const panelClearLabels: Record<string, string> = {
      benchmark:
        benchmarkPhaseTab === "fase0"
          ? "Domain Benchmark & Gap Analysis"
          : "Benchmark & Deep Research",
      spec: "Project Specification",
      mdd: "Master Design Document",
      "mdd-inicial": "Initial Master Design Document",
      brd: "Business Requirements Document",
      "ux-ui-guide": "Design System",
      blueprint: "Technical Blueprint",
      "api-contracts": "API Contracts",
      "logic-flows": "Logic Flows",
      tasks: "Task Breakdown",
      infra: "Infrastructure",
      architecture: "Software Architecture",
      "use-cases": "Use Cases",
      "user-stories": "User Stories",
      aem: "Análisis y Estudio de Mercado",
      "agent-governance": "Gobernanza de agentes IA",
    };

    if ((downloadPayload || (centralPanel === "agent-governance" && agentGovernanceScaffold)) && projectId && panelClearLabels[centralPanel]) {
      const docLabel = panelClearLabels[centralPanel];
      ordered.push({
        id: "clear",
        label: "Limpiar archivo",
        icon: BrushCleaning,
        variant: "danger",
        requiresConfirmation: {
          title: `¿Limpiar ${docLabel}?`,
          description:
            "Se borrará todo el contenido de este documento en el proyecto. Podrás volver a generarlo después. Esta acción no se puede deshacer.",
          confirmLabel: "Sí, limpiar",
        },
        onClick: () => {
          if (centralPanel === "mdd") {
            void handleClearMddCompletely();
            return;
          }
          void clearWorkshopDocumentContent(projectId, centralPanel, {
            benchmarkPhaseTab,
            stageId: activeStageId ?? undefined,
          });
        },
      });
    }

    if (effectiveComplexityForTabs === "HIGH") {
      ordered.push({
        id: "flow",
        label: "Ver flujo completo",
        icon: ListOrdered,
        onClick: () => setFlowOrderModalOpen(true),
      });
    }

    if (regenItem) ordered.push(regenItem);

    ordered.push({
      id: "download",
      label: centralPanel === "agent-governance" ? "Descargar ZIP" : "Descargar documento",
      icon: Download,
      disabled: centralPanel === "agent-governance" ? !agentGovernanceScaffold : !downloadPayload,
      onClick: () => {
        if (centralPanel === "agent-governance" && agentGovernanceScaffold && projectId) {
          void downloadRepoHandoffFromApi(
            projectId,
            projectName ?? project?.name ?? "Workshop",
          );
          return;
        }
        if (downloadPayload) downloadMarkdownFile(downloadPayload.filename, downloadPayload.content);
      },
    });

    ordered.push({
      id: "print",
      label: "Imprimir",
      icon: Printer,
      onClick: handlePrintDocument,
    });

    return ordered;
  }, [
    centralPanel,
    benchmarkPhaseTab,
    blueprintContent,
    apiContractsContent,
    architectureContent,
    useCasesContent,
    userStoriesContent,
    logicFlowsContent,
    infraContent,
    activeLegacyState?.codebaseDoc,
    mddInicialLocalContent,
    activeStageId,
    handlePrintDocument,
    dbgaContent,
    phase0SummaryContent,
    specContent,
    mddContent,
    brdWorkshopDraft,
    uxUiGuideContent,
    tasksContent,
    hasAgentGovernance,
    agentGovernanceScaffold,
    aemContent,
    canGenerateAem,
    projectId,
    projectName,
    project?.name,
    loading,
    effectiveMddTrimmed,
    mddReviewing,
    mddReapplyingFormat,
    reapplyMddFormat,
    apiBlueprintDmBlocked,
    apiBlueprintBlockedHint,
    deliverablesReadOnly,
    uxGenProgress,
    uxGenerating,
    effectiveComplexityForTabs,
    requestGenerateMdd,
    openEditMddPatterns,
    openSuggestMddPatterns,
    patternsWizardAnalyzing,
    handleRegenerateLegacyCodebaseDoc,
    setClarifySpecDialogOpen,
    generateSpec,
    generateArchitecture,
    generateUseCases,
    generateUserStories,
    generateBlueprint,
    generateApiContracts,
    generateLogicFlows,
    generateInfra,
    generateTasks,
    tasksPrerequisites,
    generateAgentGovernance,
    generateUxGuideSequential,
    setAemGenerateDialogOpen,
    clearWorkshopDocumentContent,
    handleClearMddCompletely,
    isGenerationGateBlocked,
    setFlowOrderModalOpen,
  ]);
}
