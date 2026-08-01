import type { ReactElement } from "react";
import type { PluginWorkshopPreviewEntry, PluginWorkshopPreviewRenderOptions } from "./types";

const registry = new Map<string, PluginWorkshopPreviewEntry>();

export function registerPluginWorkshopPreview(entry: PluginWorkshopPreviewEntry): void {
  if (!entry.id?.trim()) {
    throw new Error("registerPluginWorkshopPreview: entry.id is required");
  }
  registry.set(entry.id, entry);
}

export function getPluginWorkshopPreview(id: string | undefined): PluginWorkshopPreviewEntry | undefined {
  if (!id?.trim()) return undefined;
  return registry.get(id);
}

export function renderPluginWorkshopPreview(
  options: PluginWorkshopPreviewRenderOptions,
): ReactElement | null {
  const entry = getPluginWorkshopPreview(options.workshopPreview);
  if (!entry) return null;
  const Preview = entry.Preview;
  return (
    <Preview
      data={options.data}
      pluginId={options.pluginId}
      artifactId={options.artifactId}
      projectId={options.projectId}
    />
  );
}

export function listRegisteredPluginWorkshopPreviews(): string[] {
  return [...registry.keys()];
}
