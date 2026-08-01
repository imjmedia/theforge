import type { PluginWorkshopPreviewEntry } from "@/plugin-ui/types";
import { EvdWorkshopPreview } from "./EvdWorkshopPreview";
import {
  EVD_WORKSHOP_PREVIEW,
  evdDeckToEditorText,
  parseEvdDeck,
} from "./evd-deck.utils";

export const evdWorkshopPreviewRegistration: PluginWorkshopPreviewEntry = {
  id: EVD_WORKSHOP_PREVIEW,
  defaultViewMode: "preview",
  sourceReadOnly: true,
  previewLabel: "Diapositivas",
  sourceLabel: "JSON",
  Preview: EvdWorkshopPreview,
  parsePayload: parseEvdDeck,
  toEditorText: evdDeckToEditorText,
};
