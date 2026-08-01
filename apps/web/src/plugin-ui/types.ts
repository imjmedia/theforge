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
  /** Parsea texto editado — null si es inválido. */
  fromEditorText?: (text: string) => unknown | null;
  /** Fusiona edición con payload original (p. ej. restaurar blobs omitidos en el editor). */
  mergeSourceEdit?: (original: unknown, edited: unknown) => unknown | null;
}

export interface PluginWorkshopPreviewRenderOptions {
  workshopPreview?: string;
  data: unknown;
  pluginId: string;
  artifactId: string;
  projectId: string;
}
