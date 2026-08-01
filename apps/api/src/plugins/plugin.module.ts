import { Module } from "@nestjs/common";
import { PluginLoaderService, PLUGIN_LOADER_SERVICE } from "./plugin-loader.service.js";
import { PluginUserSettingsService } from "./plugin-user-settings.service.js";
import { PluginDocumentPipelineService } from "./plugin-document-pipeline.service.js";
import { PluginArtifactService } from "./plugin-artifact.service.js";
import { PluginInstallService } from "./plugin-install.service.js";
import { PluginInstanceSettingsService } from "./plugin-instance-settings.service.js";
import { PrismaModule } from "../prisma/prisma.module.js";
import { UserProvidersModule } from "../modules/user-providers/user-providers.module.js";

/**
 * Módulo de plugins dinámicos de The Forge.
 *
 * Registra el PluginLoaderService como provider global.
 * El loader escanea directorios configurados al arrancar,
 * carga plugins vía dynamic import(), y registra sus hooks.
 *
 * Cero dependencias de lógica comercial. 100% agnóstico.
 */
@Module({
  imports: [PrismaModule, UserProvidersModule],
  providers: [
    PluginLoaderService,
    PluginDocumentPipelineService,
    PluginArtifactService,
    PluginUserSettingsService,
    PluginInstallService,
    PluginInstanceSettingsService,
    {
      provide: PLUGIN_LOADER_SERVICE,
      useExisting: PluginLoaderService,
    },
  ],
  exports: [
    PluginLoaderService,
    PLUGIN_LOADER_SERVICE,
    PluginDocumentPipelineService,
    PluginArtifactService,
    PluginUserSettingsService,
    PluginInstallService,
    PluginInstanceSettingsService,
  ],
})
export class PluginModule {}
