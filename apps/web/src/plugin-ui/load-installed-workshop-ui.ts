import { fetchInstalledPlugins } from "@/utils/pluginApi";
import { apiFetch, API_BASE } from "@/utils/apiClient";
import { getPluginUiHost } from "./host-bridge";

const loadedVersions = new Map<string, string>();
const loadErrors = new Map<string, string>();

export const PLUGIN_WORKSHOP_UI_LOADED_EVENT = "theforge:plugin-workshop-ui-loaded";

function notifyWorkshopUiLoadFinished(): void {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(PLUGIN_WORKSHOP_UI_LOADED_EVENT));
  }
}

interface PluginWorkshopUiModule {
  register?: (host: ReturnType<typeof getPluginUiHost>) => void;
}

/** Último error al cargar el bundle UI de un plugin (para mensajes en Workshop). */
export function getPluginWorkshopUiLoadError(pluginId: string): string | undefined {
  return loadErrors.get(pluginId);
}

async function importAuthenticatedWorkshopUiModule(
  url: string,
): Promise<PluginWorkshopUiModule> {
  const res = await apiFetch(url);
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} al descargar workshop UI`);
  }
  const source = await res.text();
  const blob = new Blob([source], { type: "application/javascript" });
  const blobUrl = URL.createObjectURL(blob);
  try {
    return (await import(/* @vite-ignore */ blobUrl)) as PluginWorkshopUiModule;
  } finally {
    URL.revokeObjectURL(blobUrl);
  }
}

/** Carga bundles `workshopUi` declarados en el manifest de cada plugin instalado. */
export async function loadInstalledPluginWorkshopUi(options?: {
  force?: boolean;
}): Promise<void> {
  const { installed } = await fetchInstalledPlugins();

  await Promise.all(
    installed.map(async (plugin) => {
      const entry = plugin.manifest?.workshopUi?.entry?.trim();
      if (!entry) return;

      if (!options?.force && loadedVersions.get(plugin.id) === plugin.version) {
        return;
      }

      const filename = entry.split("/").pop();
      if (!filename) return;

      const url =
        `${API_BASE}/plugins/workshop-ui/${encodeURIComponent(plugin.id)}/${encodeURIComponent(filename)}` +
        `?v=${encodeURIComponent(plugin.version)}`;

      try {
        const mod = await importAuthenticatedWorkshopUiModule(url);
        if (typeof mod.register !== "function") {
          const message = "El bundle no exporta register()";
          loadErrors.set(plugin.id, message);
          console.warn(`[plugin-ui] ${plugin.id}: ${message}`);
          return;
        }
        mod.register(getPluginUiHost());
        loadedVersions.set(plugin.id, plugin.version);
        loadErrors.delete(plugin.id);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        loadErrors.set(plugin.id, message);
        console.warn(
          `[plugin-ui] No se pudo cargar workshop UI de ${plugin.id}:`,
          err,
        );
      }
    }),
  );
  notifyWorkshopUiLoadFinished();
}

export async function reloadPluginWorkshopUi(): Promise<void> {
  loadedVersions.clear();
  loadErrors.clear();
  await loadInstalledPluginWorkshopUi({ force: true });
}
