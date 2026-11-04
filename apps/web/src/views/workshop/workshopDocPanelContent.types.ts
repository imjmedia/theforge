import type { WorkshopAdrsPluginPanelsProps } from "./workshopAdrsPluginPanels.types";
import type { WorkshopAgentPanelsProps } from "./workshopAgentPanels.types";
import type { WorkshopBenchmarkPanelProps } from "./workshopBenchmarkPanel.types";
import type { WorkshopLegacyPanelsProps } from "./workshopLegacyPanels.types";
import type { WorkshopMddPanelProps } from "./workshopMddPanel.types";
import type { WorkshopSpecBrdAemPanelsProps } from "./workshopSpecBrdAemPanels.types";
import type { WorkshopStandardDocPanelsProps } from "./workshopStandardDocPanels.types";
import type { WorkshopUxGuidePanelProps } from "./workshopUxGuidePanel.types";

export interface WorkshopDocPanelContentProps {
  centralPanel: string;
  projectId: string;
  legacy: WorkshopLegacyPanelsProps;
  benchmark: WorkshopBenchmarkPanelProps;
  mdd: WorkshopMddPanelProps;
  standard: WorkshopStandardDocPanelsProps;
  ux: WorkshopUxGuidePanelProps;
  specBrdAem: WorkshopSpecBrdAemPanelsProps;
  agent: WorkshopAgentPanelsProps;
  adrsPlugin: WorkshopAdrsPluginPanelsProps;
}
