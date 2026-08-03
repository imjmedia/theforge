import React from "react";
import type { TheForgePluginUiHost } from "@theforge/shared-types";
import { registerPluginWorkshopPreview } from "./registry";

declare global {
  interface Window {
    __THEFORGE_PLUGIN_UI__?: TheForgePluginUiHost;
  }
}

/** Instala el host React/registry antes de cargar bundles `.tfplugin`. */
export function installPluginUiHost(): TheForgePluginUiHost {
  const host: TheForgePluginUiHost = {
    React,
    registerWorkshopPreview: registerPluginWorkshopPreview,
  };
  window.__THEFORGE_PLUGIN_UI__ = host;
  return host;
}

export function getPluginUiHost(): TheForgePluginUiHost {
  const host = window.__THEFORGE_PLUGIN_UI__;
  if (!host) {
    throw new Error("Plugin UI host no inicializado");
  }
  return host;
}

/** Re-export para bundles embebidos que necesiten el mismo React del core. */
export type { React };
