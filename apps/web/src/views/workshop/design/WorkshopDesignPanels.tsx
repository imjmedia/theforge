import { WorkshopDesignScreensPanel } from "./WorkshopDesignScreensPanel";
import { WorkshopDesignDataNeedsPanel } from "./WorkshopDesignDataNeedsPanel";
import { WorkshopDesignContractPanel } from "./WorkshopDesignContractPanel";

export function WorkshopDesignPanels({
  centralPanel,
  projectId,
}: {
  centralPanel: string;
  projectId: string;
}) {
  if (centralPanel === "design-screens") {
    return <WorkshopDesignScreensPanel projectId={projectId} />;
  }
  if (centralPanel === "design-data-needs") {
    return <WorkshopDesignDataNeedsPanel projectId={projectId} />;
  }
  if (centralPanel === "design-contract") {
    return <WorkshopDesignContractPanel projectId={projectId} />;
  }
  return null;
}
