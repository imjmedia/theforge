import type { ComponentType } from "react";
import type { PluginWorkshopPreviewProps } from "@theforge/shared-types";
import { EvdWorkshopPreview } from "./EvdWorkshopPreview.js";
import {
  EVD_WORKSHOP_PREVIEW,
  evdDeckFromEditorText,
  evdDeckToEditorText,
  mergeEvdDeckSourceEdit,
  parseEvdDeck,
} from "./evd-deck.utils.js";

/** Registro exportado para `registerPluginWorkshopPreview` en The Forge. */
export interface EvdWorkshopPreviewRegistration {
  id: string;
  defaultViewMode?: "preview" | "source";
  sourceReadOnly?: boolean;
  previewLabel?: string;
  sourceLabel?: string;
  sourceApplyLabel?: string;
  Preview: ComponentType<PluginWorkshopPreviewProps>;
  parsePayload?: (data: unknown) => unknown | null;
  toEditorText?: (data: unknown) => string;
  /** Parsea JSON editado — null si es inválido. */
  fromEditorText?: (text: string) => unknown | null;
  /** Fusiona edición con datos originales (p. ej. restaurar imágenes base64). */
  mergeSourceEdit?: (original: unknown, edited: unknown) => unknown | null;
}

export const evdWorkshopPreviewRegistration: EvdWorkshopPreviewRegistration = {
  id: EVD_WORKSHOP_PREVIEW,
  defaultViewMode: "preview",
  sourceReadOnly: false,
  previewLabel: "Diapositivas",
  sourceLabel: "JSON",
  sourceApplyLabel: "Aplicar y actualizar diapositivas",
  Preview: EvdWorkshopPreview,
  parsePayload: parseEvdDeck,
  toEditorText: evdDeckToEditorText,
  fromEditorText: evdDeckFromEditorText,
  mergeSourceEdit: mergeEvdDeckSourceEdit,
};
