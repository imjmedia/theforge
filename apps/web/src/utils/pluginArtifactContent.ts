import type { ArtifactTypeDefinition } from "@theforge/shared-types";
import { evdDeckToEditorText, isEvdArtifact } from "./evdDeck";

export interface PluginArtifactEditorOptions {
  pluginId?: string;
  artifactId?: string;
}

/** Texto editable en el panel según contentType del artifact. */
export function pluginArtifactToEditorText(
  data: unknown,
  contentType: ArtifactTypeDefinition["contentType"] = "json",
  options?: PluginArtifactEditorOptions,
): string {
  if (data == null) return "";
  if (
    options?.pluginId &&
    options?.artifactId &&
    isEvdArtifact(options.pluginId, options.artifactId)
  ) {
    return evdDeckToEditorText(data);
  }
  if (contentType === "markdown") {
    if (typeof data === "string") return data;
    if (typeof data === "object" && data !== null && "markdown" in data) {
      const md = (data as { markdown?: unknown }).markdown;
      if (typeof md === "string") return md;
    }
  }
  if (contentType === "html" && typeof data === "string") return data;
  return JSON.stringify(data, null, 2);
}

/** Parsea texto del editor de vuelta al payload persistido. */
export function pluginArtifactFromEditorText(
  text: string,
  contentType: ArtifactTypeDefinition["contentType"] = "json",
): unknown {
  const trimmed = text.trim();
  if (!trimmed) return contentType === "json" ? {} : "";
  if (contentType === "markdown" || contentType === "html") return trimmed;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return { raw: text };
  }
}

export function pluginArtifactDefaultViewMode(
  contentType: ArtifactTypeDefinition["contentType"] = "json",
  options?: PluginArtifactEditorOptions,
): "preview" | "source" {
  if (
    options?.pluginId &&
    options?.artifactId &&
    isEvdArtifact(options.pluginId, options.artifactId)
  ) {
    return "preview";
  }
  return contentType === "markdown" ? "preview" : "source";
}
