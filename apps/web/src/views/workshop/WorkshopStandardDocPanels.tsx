import {
  FileCode,
  GitBranch,
  Layers,
  LayoutTemplate,
  ListTodo,
  MessageSquare,
  Server,
  Target,
} from "lucide-react";
import { StandardDocPanel } from "@/components/StandardDocPanel";
import type { WorkshopStandardDocPanelsProps } from "./workshopStandardDocPanels.types";

export function WorkshopStandardDocPanels({
  centralPanel,
  effectiveMddTrimmed,
  loading,
  loadingReason,
  mddReviewing,
  canGenerateFromCodebase,
  deliverablesReadOnly,
  tasksPrerequisites,
  apiBlueprintDmBlocked,
  apiBlueprintBlockedHint,
  docTs,
  buildDocClarification,
  architecture,
  useCases,
  userStories,
  blueprint,
  tasks,
  apiContracts,
  logicFlows,
  infra,
  onLegacyGenerate,
}: WorkshopStandardDocPanelsProps) {
  const canGenerate = !!effectiveMddTrimmed;
  const legacyGenerateLoading = loading && loadingReason === "legacy-brd-suggest";
  const legacyFromCodebase = canGenerateFromCodebase
    ? {
        legacyGenerateLoading,
      }
    : {};

  if (centralPanel === "architecture") {
    return (
      <StandardDocPanel
        icon={Layers}
        title="Arquitectura"
        description="Módulos, datos, APIs y flujos del producto, alineados con el MDD y el codebase."
        content={architecture.content}
        onContentChange={architecture.onContentChange}
        onSave={architecture.onSave}
        isDirty={architecture.isDirty}
        viewMode={architecture.viewMode}
        onGenerate={architecture.onGenerate}
        canGenerate={canGenerate}
        isLoading={loading}
        placeholder="# Arquitectura del sistema\n\nMódulos, datos, APIs y flujos del producto (según MDD y codebase)..."
        onBlur={architecture.onBlur}
        readOnly={deliverablesReadOnly}
        documentTimestamps={docTs(architecture.timestampField)}
        clarification={buildDocClarification(architecture.clarifyField, (c) =>
          architecture.onContentChange(c),
        )}
      />
    );
  }

  if (centralPanel === "use-cases") {
    return (
      <StandardDocPanel
        icon={Target}
        title="Casos de uso"
        description="Escenarios de interacción y flujos transaccionales derivados del MDD."
        content={useCases.content}
        onContentChange={useCases.onContentChange}
        onSave={useCases.onSave}
        isDirty={useCases.isDirty}
        viewMode={useCases.viewMode}
        onGenerate={useCases.onGenerate}
        canGenerate={canGenerate}
        isLoading={loading}
        placeholder="# Casos de Uso\n\nDescribe los escenarios de interacción y flujos transaccionales..."
        onBlur={useCases.onBlur}
        readOnly={deliverablesReadOnly}
        documentTimestamps={docTs(useCases.timestampField)}
        clarification={buildDocClarification(useCases.clarifyField, (c) =>
          useCases.onContentChange(c),
        )}
      />
    );
  }

  if (centralPanel === "user-stories") {
    return (
      <StandardDocPanel
        icon={MessageSquare}
        title="Historias de usuario"
        description="Requisitos en formato ágil (Como / Quiero / Para) a partir del MDD."
        content={userStories.content}
        onContentChange={userStories.onContentChange}
        onSave={userStories.onSave}
        isDirty={userStories.isDirty}
        viewMode={userStories.viewMode}
        onGenerate={userStories.onGenerate}
        canGenerate={canGenerate}
        isLoading={loading}
        placeholder="# Historias de Usuario\n\nDefine los requisitos en formato Agile (Como... quiero... para...)..."
        onBlur={userStories.onBlur}
        readOnly={deliverablesReadOnly}
        documentTimestamps={docTs(userStories.timestampField)}
        clarification={buildDocClarification(userStories.clarifyField, (c) =>
          userStories.onContentChange(c),
        )}
      />
    );
  }

  if (centralPanel === "blueprint") {
    return (
      <StandardDocPanel
        icon={LayoutTemplate}
        title="Blueprint"
        description="Plan técnico derivado del MDD. Puedes regenerarlo con IA o editar el markdown en modo fuente."
        content={blueprint.content}
        onContentChange={blueprint.onContentChange}
        onSave={blueprint.onSave}
        isDirty={blueprint.isDirty}
        viewMode={blueprint.viewMode}
        onGenerate={blueprint.onGenerate}
        canGenerate={canGenerate}
        isLoading={loading || mddReviewing}
        placeholder="# Blueprint\n\nEl contenido del blueprint se genera desde el MDD o puedes escribirlo manualmente..."
        onBlur={blueprint.onBlur}
        legacyGenerateLabel={
          canGenerateFromCodebase ? "Generar Blueprint desde MDD Inicial" : undefined
        }
        onLegacyGenerate={
          canGenerateFromCodebase ? () => onLegacyGenerate("blueprint") : undefined
        }
        readOnly={deliverablesReadOnly}
        documentTimestamps={docTs(blueprint.timestampField)}
        clarification={buildDocClarification(blueprint.clarifyField, (c) =>
          blueprint.onContentChange(c),
        )}
        {...legacyFromCodebase}
      />
    );
  }

  if (centralPanel === "tasks") {
    return (
      <StandardDocPanel
        icon={ListTodo}
        title="Task Breakdown"
        description={tasksPrerequisites.hint}
        content={tasks.content}
        onContentChange={tasks.onContentChange}
        onSave={tasks.onSave}
        isDirty={tasks.isDirty}
        viewMode={tasks.viewMode}
        onGenerate={tasks.onGenerate}
        canGenerate={tasksPrerequisites.ready}
        isLoading={loading}
        generateLabel="Generar Tasks (MDD + Spec + Blueprint + API + pantallas)"
        placeholder="# Task Breakdown\n\nUser Story: US-001 …\n\n- [ ] Tarea…"
        onBlur={tasks.onBlur}
        readOnly={deliverablesReadOnly}
        legacyGenerateLabel={
          canGenerateFromCodebase ? "Generar Tasks desde MDD Inicial" : undefined
        }
        onLegacyGenerate={
          canGenerateFromCodebase ? () => onLegacyGenerate("tasks") : undefined
        }
        documentTimestamps={docTs(tasks.timestampField)}
        clarification={buildDocClarification(tasks.clarifyField, (c) =>
          tasks.onContentChange(c),
        )}
        {...legacyFromCodebase}
      />
    );
  }

  if (centralPanel === "api-contracts") {
    return (
      <StandardDocPanel
        icon={FileCode}
        title="Contratos de API"
        description="OpenAPI/Swagger desde el MDD (vista previa antes de guardar)."
        content={apiContracts.content}
        onContentChange={apiContracts.onContentChange}
        onSave={apiContracts.onSave}
        isDirty={apiContracts.isDirty}
        viewMode={apiContracts.viewMode}
        onGenerate={apiContracts.onGenerate}
        canGenerate={canGenerate}
        isLoading={loading || mddReviewing}
        placeholder="# Contratos de API (OpenAPI/Swagger)\n\n..."
        onBlur={apiContracts.onBlur}
        generateBlocked={apiBlueprintDmBlocked}
        generateBlockedReason={apiBlueprintBlockedHint}
        legacyGenerateLabel={
          canGenerateFromCodebase ? "Generar API Contracts desde MDD Inicial" : undefined
        }
        onLegacyGenerate={
          canGenerateFromCodebase ? () => onLegacyGenerate("api-contracts") : undefined
        }
        readOnly={deliverablesReadOnly}
        documentTimestamps={docTs(apiContracts.timestampField)}
        clarification={buildDocClarification(apiContracts.clarifyField, (c) =>
          apiContracts.onContentChange(c),
        )}
        {...legacyFromCodebase}
      />
    );
  }

  if (centralPanel === "logic-flows") {
    return (
      <StandardDocPanel
        icon={GitBranch}
        title="Casos de Uso y Flujos"
        description="Diagramas de secuencia, MFA y reglas de validación desde el MDD."
        content={logicFlows.content}
        onContentChange={logicFlows.onContentChange}
        onSave={logicFlows.onSave}
        isDirty={logicFlows.isDirty}
        viewMode={logicFlows.viewMode}
        onGenerate={logicFlows.onGenerate}
        canGenerate={canGenerate}
        isLoading={loading || mddReviewing}
        placeholder="# Casos de Uso y Flujos de Lógica\n\n..."
        onBlur={logicFlows.onBlur}
        readOnly={deliverablesReadOnly}
        documentTimestamps={docTs(logicFlows.timestampField)}
        clarification={buildDocClarification(logicFlows.clarifyField, (c) =>
          logicFlows.onContentChange(c),
        )}
      />
    );
  }

  if (centralPanel === "infra") {
    return (
      <StandardDocPanel
        icon={Server}
        title="Infraestructura y Despliegue"
        description="Dockerfile, docker-compose desde el MDD (vista previa antes de guardar)."
        content={infra.content}
        onContentChange={infra.onContentChange}
        onSave={infra.onSave}
        isDirty={infra.isDirty}
        viewMode={infra.viewMode}
        onGenerate={infra.onGenerate}
        canGenerate={canGenerate}
        isLoading={loading || mddReviewing}
        placeholder="# Infraestructura\n\n..."
        onBlur={infra.onBlur}
        legacyGenerateLabel={
          canGenerateFromCodebase ? "Generar Infra desde MDD Inicial" : undefined
        }
        onLegacyGenerate={
          canGenerateFromCodebase ? () => onLegacyGenerate("infra") : undefined
        }
        readOnly={deliverablesReadOnly}
        documentTimestamps={docTs(infra.timestampField)}
        clarification={buildDocClarification(infra.clarifyField, (c) =>
          infra.onContentChange(c),
        )}
        {...legacyFromCodebase}
      />
    );
  }

  return null;
}
