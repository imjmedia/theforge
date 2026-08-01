/**
 * Inicializa el host de UI de plugins y carga bundles embebidos en `.tfplugin` instalados.
 * Sin imports estáticos por plugin — el marco es genérico.
 */
import { installPluginUiHost } from "./host-bridge";
import { loadInstalledPluginWorkshopUi } from "./load-installed-workshop-ui";

installPluginUiHost();
void loadInstalledPluginWorkshopUi();

export { reloadPluginWorkshopUi } from "./load-installed-workshop-ui";
