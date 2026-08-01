import { useSyncExternalStore } from "react";
import type { ReactElement } from "react";
import type { PluginWorkshopPreviewEntry, PluginWorkshopPreviewRenderOptions } from "./types";

const registry = new Map<string, PluginWorkshopPreviewEntry>();
let registryVersion = 0;
const listeners = new Set<() => void>();

function notifyRegistryChange(): void {
  registryVersion += 1;
  for (const listener of listeners) {
    listener();
  }
}

function subscribePluginWorkshopRegistry(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function registerPluginWorkshopPreview(entry: PluginWorkshopPreviewEntry): void {
  if (!entry.id?.trim()) {
    throw new Error("registerPluginWorkshopPreview: entry.id is required");
  }
  registry.set(entry.id, entry);
  notifyRegistryChange();
}

export function getPluginWorkshopPreview(id: string | undefined): PluginWorkshopPreviewEntry | undefined {
  if (!id?.trim()) return undefined;
  return registry.get(id);
}

/** Hook reactivo — re-renderiza cuando un bundle `.tfplugin` registra su preview. */
export function usePluginWorkshopPreview(
  id: string | undefined,
): PluginWorkshopPreviewEntry | undefined {
  return useSyncExternalStore(
    subscribePluginWorkshopRegistry,
    () => getPluginWorkshopPreview(id),
    () => undefined,
  );
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
      onRegenerate={options.onRegenerate}
      canRegenerate={options.canRegenerate}
      isRegenerating={options.isRegenerating}
      regenerateLabel={options.regenerateLabel}
      regenerateBlockedReason={options.regenerateBlockedReason}
    />
  );
}

export function listRegisteredPluginWorkshopPreviews(): string[] {
  return [...registry.keys()];
}

export function getPluginWorkshopRegistryVersion(): number {
  return registryVersion;
}
