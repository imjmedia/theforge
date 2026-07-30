import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/AlertDialog";
import { AemGenerateDialog } from "@/components/AemGenerateDialog";
import MddRegenerateDialog from "@/components/MddRegenerateDialog";
import { MddPatternsWizardDialog } from "@/components/MddPatternsWizardDialog";
import { MddGovernancePatternCompatDialog } from "@/components/MddGovernancePatternCompatDialog";
import { ModelsUnavailableDialog } from "@/components/ModelsUnavailableDialog";
import WorkshopHelpModal from "@/components/WorkshopHelpModal";
import { WorkshopDbgaRestoreDialog } from "@/components/WorkshopDbgaRestoreDialog";
import { WorkshopFlowOrderModal } from "@/components/WorkshopFlowOrderModal";
import { WorkshopNewStageModal } from "@/components/WorkshopNewStageModal";
import { WorkshopAuditModal } from "./WorkshopAuditModal";
import type { WorkshopModalsProps } from "./workshopModals.types";

/** All Workshop overlays/dialogs (portaled; safe to mount once at view root). */
export function WorkshopModals({
  projectId,
  isLegacyProject,
  onOpenSettings,
  workshopStagesList,
  activeStageId,
  createWorkshopStage,
  fetchProject,
  showStageModal,
  setShowStageModal,
  showHelpModal,
  setShowHelpModal,
  flowOrderModalOpen,
  setFlowOrderModalOpen,
  dbgaRestoreOpen,
  setDbgaRestoreOpen,
  modelsUnavailableModalOpen,
  setModelsUnavailableModalOpen,
  audit,
  clearMddConfirmOpen,
  setClearMddConfirmOpen,
  onClearMddConfirm,
  clearMddDeliverablesConfirmOpen,
  setClearMddDeliverablesConfirmOpen,
  onClearMddDeliverablesConfirm,
  mddPatternsWizardOpen,
  setMddPatternsWizardOpen,
  mddPatternsWizardMode,
  effectiveMddTrimmed,
  patternsWizardPreselected,
  patternsWizardAnalyzing,
  patternsAnalyzeRationale,
  patternsWizardLoading,
  onMddPatternsWizardConfirm,
  mddRegenerateDialogOpen,
  setMddRegenerateDialogOpen,
  mddUpstreamSync,
  mddRegenerateInitialMode,
  mddRegenerateLoading,
  onMddRegenerateFull,
  onMddRegenerateSync,
  mddPatternCompatOpen,
  setMddPatternCompatOpen,
  mddPatternCompatCorrections,
  mddPatternCompatConfirmLabel,
  mddPatternCompatLoading,
  onMddPatternCompatConfirm,
  aemGenerateDialogOpen,
  setAemGenerateDialogOpen,
  aemGenerateLoading,
  aemGenerateError,
  onGenerateAem,
}: WorkshopModalsProps) {
  return (
    <>
      <WorkshopNewStageModal
        open={showStageModal}
        onOpenChange={setShowStageModal}
        stages={workshopStagesList}
        activeStageId={activeStageId}
        onCreate={createWorkshopStage}
      />
      <WorkshopHelpModal open={showHelpModal} onClose={() => setShowHelpModal(false)} />
      <WorkshopFlowOrderModal
        open={flowOrderModalOpen}
        onOpenChange={setFlowOrderModalOpen}
        isLegacyProject={isLegacyProject}
      />
      <WorkshopDbgaRestoreDialog
        open={dbgaRestoreOpen}
        onOpenChange={setDbgaRestoreOpen}
        projectId={projectId}
        onRestored={async () => {
          if (projectId) await fetchProject(projectId);
        }}
      />
      <ModelsUnavailableDialog
        open={modelsUnavailableModalOpen}
        onOpenChange={setModelsUnavailableModalOpen}
        onOpenSettings={onOpenSettings}
      />
      <WorkshopAuditModal {...audit} />
      <AlertDialog open={clearMddConfirmOpen} onOpenChange={setClearMddConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Vaciar todo el MDD?</AlertDialogTitle>
            <AlertDialogDescription>
              Se borra el documento completo y la sección de patrones. No se valida contra ER ni otros
              artefactos del proyecto.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-[var(--destructive)] hover:bg-[var(--destructive-hover)]"
              onClick={() => {
                void onClearMddConfirm();
              }}
            >
              Limpiar MDD
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog
        open={clearMddDeliverablesConfirmOpen}
        onOpenChange={setClearMddDeliverablesConfirmOpen}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Limpiar todos los archivos del MDD?</AlertDialogTitle>
            <AlertDialogDescription>
              Se borran spec, blueprint, arquitectura, contratos API, casos de uso, historias de
              usuario, flujos lógicos, infra, tasks, guía UX/UI, pantallas y agent governance.
              El MDD, DBGA, Fase 0, AEM y BRD no se modifican.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-[var(--destructive)] hover:bg-[var(--destructive-hover)]"
              onClick={() => {
                void onClearMddDeliverablesConfirm();
              }}
            >
              Limpiar todos los archivos
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <MddPatternsWizardDialog
        open={mddPatternsWizardOpen}
        onOpenChange={setMddPatternsWizardOpen}
        mode={mddPatternsWizardMode}
        initialMddContent={effectiveMddTrimmed || null}
        preselectedIds={patternsWizardPreselected}
        analyzing={patternsWizardAnalyzing}
        analyzeMessage={patternsAnalyzeRationale}
        loading={patternsWizardLoading}
        onConfirm={onMddPatternsWizardConfirm}
      />
      <MddRegenerateDialog
        open={mddRegenerateDialogOpen}
        onOpenChange={setMddRegenerateDialogOpen}
        syncStatus={mddUpstreamSync}
        initialMode={mddRegenerateInitialMode}
        loading={mddRegenerateLoading}
        onConfirmFull={onMddRegenerateFull}
        onConfirmSync={onMddRegenerateSync}
      />
      <MddGovernancePatternCompatDialog
        open={mddPatternCompatOpen}
        onOpenChange={setMddPatternCompatOpen}
        corrections={mddPatternCompatCorrections}
        confirmLabel={mddPatternCompatConfirmLabel}
        loading={mddPatternCompatLoading}
        onConfirm={onMddPatternCompatConfirm}
      />
      <AemGenerateDialog
        open={aemGenerateDialogOpen}
        onOpenChange={setAemGenerateDialogOpen}
        loading={aemGenerateLoading}
        error={aemGenerateError}
        onGenerate={onGenerateAem}
      />
    </>
  );
}
