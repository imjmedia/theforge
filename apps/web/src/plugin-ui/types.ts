import type { ComponentType } from "react";
import type {
  PluginWorkshopPreviewProps,
  PluginWorkshopPreviewRegistration,
} from "@theforge/shared-types";

/** Entrada completa en el registry — el paquete npm del plugin aporta Preview + helpers. */
export interface PluginWorkshopPreviewEntry extends PluginWorkshopPreviewRegistration {
  Preview: ComponentType<PluginWorkshopPreviewProps>;
  parsePayload?: (data: unknown) => unknown | null;
  toEditorText?: (data: unknown) => string;
}

export interface PluginWorkshopPreviewRenderOptions {
  workshopPreview?: string;
  data: unknown;
  pluginId: string;
  artifactId: string;
  projectId: string;
}
