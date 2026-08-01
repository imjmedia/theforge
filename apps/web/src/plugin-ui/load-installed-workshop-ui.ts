import { fetchInstalledPlugins } from "@/utils/pluginApi";
import { API_BASE } from "@/utils/apiClient";
import { getPluginUiHost } from "./host-bridge";

const loadedVersions = new Map<string, string>();

interface PluginWorkshopUiModule {
  register?: (host: ReturnType<typeof getPluginUiHost>) => void;
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
        const mod = (await import(/* @vite-ignore */ url)) as PluginWorkshopUiModule;
        if (typeof mod.register !== "function") {
          console.warn(
            `[plugin-ui] ${plugin.id}: workshopUi bundle no exporta register()`,
          );
          return;
        }
        mod.register(getPluginUiHost());
        loadedVersions.set(plugin.id, plugin.version);
      } catch (err) {
        console.warn(
          `[plugin-ui] No se pudo cargar workshop UI de ${plugin.id}:`,
          err,
        );
      }
    }),
  );
}

export async function reloadPluginWorkshopUi(): Promise<void> {
  loadedVersions.clear();
  await loadInstalledPluginWorkshopUi({ force: true });
}
