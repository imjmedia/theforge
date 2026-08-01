import type { EvdDeckJson } from "./evd-deck.types.js";

/** Id registrado en getArtifactTypes().workshopPreview — debe coincidir con el backend. */
export const EVD_WORKSHOP_PREVIEW = "com.kreodevs.evd/deck";

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

const B64_PLACEHOLDER_RE = /^\[image\/png; base64, ~\d+KB\]$/;

/** Indica si el valor es un placeholder de imagen (no base64 real). */
export function isB64Placeholder(value: unknown): boolean {
  return typeof value === "string" && B64_PLACEHOLDER_RE.test(value);
}

/** Parsea JSON editado en el modo fuente — devuelve null si es inválido. */
export function evdDeckFromEditorText(text: string): EvdDeckJson | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    return parseEvdDeck(parsed);
  } catch {
    return null;
  }
}

/**
 * Fusiona edición de texto con el deck original — preserva imágenes base64
 * cuando el editor muestra placeholders en lugar del blob completo.
 */
export function mergeEvdDeckSourceEdit(
  original: unknown,
  edited: unknown,
): EvdDeckJson | null {
  const base = parseEvdDeck(original);
  const next = parseEvdDeck(edited);
  if (!base || !next) return next;

  const originalSlides = new Map(base.slides.map((s) => [s.id, s]));

  const slides = next.slides.map((slide) => {
    const prev = originalSlides.get(slide.id);
    if (!prev) return slide;

    const merged = { ...slide };
    for (const key of ["backgroundB64", "illustrationB64"] as const) {
      const editedVal = merged[key];
      const prevVal = prev[key];
      if (
        isB64Placeholder(editedVal) ||
        editedVal === undefined ||
        editedVal === null ||
        editedVal === ""
      ) {
        if (prevVal && !isB64Placeholder(prevVal)) {
          merged[key] = prevVal;
        } else if (isB64Placeholder(editedVal)) {
          delete merged[key];
        }
      }
    }
    return merged;
  });

  return {
    ...next,
    meta: { ...base.meta, ...next.meta, totalSlides: slides.length },
    branding: next.branding ?? base.branding,
    slides,
  };
}

export function b64ToDataUrl(b64: string): string {
  if (b64.startsWith("data:")) return b64;
  return `data:image/png;base64,${b64}`;
}
