import type { ReactElement } from "react";
import type { PluginWorkshopPreviewProps } from "@theforge/shared-types";
import { EvdDeckPreview } from "./EvdDeckPreview";
import { parseEvdDeck } from "./evd-deck.utils";

export function EvdWorkshopPreview({ data }: PluginWorkshopPreviewProps): ReactElement {
  const deck = parseEvdDeck(data);
  if (!deck) {
    return (
      <div className="flex flex-1 items-center justify-center p-8 text-sm text-[var(--muted-foreground)]">
        No se pudo interpretar el deck EVD.
      </div>
    );
  }
  return <EvdDeckPreview deck={deck} />;
}
