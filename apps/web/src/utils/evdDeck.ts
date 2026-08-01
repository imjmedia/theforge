import type { EvdDeckJson } from "@/components/evd/evd-deck.types";

export const EVD_PLUGIN_ID = "com.kreodevs.evd";
export const EVD_ARTIFACT_ID = "evd";

export function isEvdArtifact(pluginId: string, artifactId: string): boolean {
  return pluginId === EVD_PLUGIN_ID && artifactId === EVD_ARTIFACT_ID;
}

export function parseEvdDeck(data: unknown): EvdDeckJson | null {
  if (!data || typeof data !== "object") return null;
  const deck = data as Record<string, unknown>;
  if (!Array.isArray(deck.slides)) return null;
  if (!deck.meta || typeof deck.meta !== "object") return null;
  const meta = deck.meta as Record<string, unknown>;
  if (typeof meta.title !== "string") return null;
  return data as EvdDeckJson;
}

function b64Placeholder(value: string): string {
  const kb = Math.max(1, Math.round((value.length * 3) / 4 / 1024));
  return `[image/png; base64, ~${kb}KB]`;
}

/** JSON legible para modo fuente — omite blobs base64 enormes. */
export function sanitizeEvdDeckForDisplay(data: unknown): unknown {
  if (!data || typeof data !== "object") return data;
  const deck = structuredClone(data) as Record<string, unknown>;
  if (!Array.isArray(deck.slides)) return deck;

  deck.slides = (deck.slides as Record<string, unknown>[]).map((slide) => {
    const copy = { ...slide };
    if (typeof copy.backgroundB64 === "string" && copy.backgroundB64.length > 80) {
      copy.backgroundB64 = b64Placeholder(copy.backgroundB64);
    }
    if (typeof copy.illustrationB64 === "string" && copy.illustrationB64.length > 80) {
      copy.illustrationB64 = b64Placeholder(copy.illustrationB64);
    }
    return copy;
  });

  return deck;
}

export function evdDeckToEditorText(data: unknown): string {
  if (data == null) return "";
  return JSON.stringify(sanitizeEvdDeckForDisplay(data), null, 2);
}

export function b64ToDataUrl(b64: string): string {
  if (b64.startsWith("data:")) return b64;
  return `data:image/png;base64,${b64}`;
}
