import type { ReactElement } from "react";
import { EvdDeckPreview } from "./EvdDeckPreview.js";
import { parseEvdDeck } from "./evd-deck.utils.js";

/** Props — alineadas con PluginWorkshopPreviewProps del core. */
export interface EvdWorkshopPreviewProps {
  data: unknown;
  pluginId: string;
  artifactId: string;
  projectId: string;
  onRegenerate?: () => void | Promise<void>;
  canRegenerate?: boolean;
  isRegenerating?: boolean;
  regenerateLabel?: string;
  regenerateBlockedReason?: string;
}

export function EvdWorkshopPreview({
  data,
  onRegenerate,
  canRegenerate,
  isRegenerating,
  regenerateLabel,
  regenerateBlockedReason,
}: EvdWorkshopPreviewProps): ReactElement {
  const deck = parseEvdDeck(data);
  if (!deck) {
    return (
      <div className="flex flex-1 items-center justify-center p-8 text-sm text-[var(--muted-foreground)]">
        No se pudo interpretar el deck EVD.
      </div>
    );
  }
  return (
    <EvdDeckPreview
      deck={deck}
      onRegenerate={onRegenerate}
      canRegenerate={canRegenerate}
      isRegenerating={isRegenerating}
      regenerateLabel={regenerateLabel}
      regenerateBlockedReason={regenerateBlockedReason}
    />
  );
}
