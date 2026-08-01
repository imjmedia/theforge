/**
 * Exportación PPTX editable desde el navegador (Workshop).
 */
import type { EvdBranding, EvdDeckJson } from "./evd-deck.types.js";
import {
  extractSlideBodyLines,
  isUsableB64,
  stripB64Prefix,
} from "./evd-slide-text.js";

function hexColor(color: string | undefined, fallback: string): string {
  if (!color) return fallback.replace("#", "");
  return color.replace("#", "");
}

function sanitizeFilename(title: string): string {
  return title
    .replace(/[^\w\s-áéíóúñÁÉÍÓÚÑ]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .slice(0, 80) || "executive-deck";
}

export async function exportEvdDeckToPptx(deck: EvdDeckJson): Promise<void> {
  const mod = await import("pptxgenjs");
  type PptxCtor = new () => {
    layout: string;
    author: string;
    title: string;
    subject: string;
    ShapeType: { rect: string };
    addSlide(): {
      background: unknown;
      addShape: (type: string, opts: Record<string, unknown>) => void;
      addText: (text: unknown, opts: Record<string, unknown>) => void;
      addImage: (opts: Record<string, unknown>) => void;
      addNotes: (text: string) => void;
    };
    writeFile: (opts: { fileName: string }) => Promise<void>;
  };
  const PptxGenJS = (mod.default ?? mod) as unknown as PptxCtor;
  const pptx = new PptxGenJS();

  const branding: Partial<EvdBranding> = deck.branding ?? {};
  const primary = hexColor(branding.primaryColor, "2563EB");
  const textColor = hexColor(branding.textColor, "1F2937");
  const fontFace = (branding.fontFamily ?? "Arial").split(",")[0]?.trim() || "Arial";

  pptx.layout = "LAYOUT_WIDE";
  pptx.author = "Executive Visual Deck";
  pptx.title = deck.meta.title;
  pptx.subject = deck.meta.subtitle ?? "";

  const slides = [...deck.slides].sort((a, b) => a.order - b.order);

  for (const slide of slides) {
    const pptSlide = pptx.addSlide();
    const bodyLines = extractSlideBodyLines(slide);

    if (isUsableB64(slide.backgroundB64)) {
      pptSlide.background = {
        data: `image/png;base64,${stripB64Prefix(slide.backgroundB64)}`,
      };
      pptSlide.addShape(pptx.ShapeType.rect, {
        x: 0,
        y: 0,
        w: "100%",
        h: "100%",
        fill: { color: "000000", transparency: 45 },
      });
    } else {
      pptSlide.background = { color: primary };
    }

    pptSlide.addText(slide.title, {
      x: 0.6,
      y: 0.5,
      w: 12,
      h: 1.2,
      fontSize: 32,
      bold: true,
      color: isUsableB64(slide.backgroundB64) ? "FFFFFF" : "FFFFFF",
      fontFace,
    });

    if (bodyLines.length > 0) {
      pptSlide.addText(
        bodyLines.map((line) => ({ text: line, options: { bullet: true, breakLine: true } })),
        {
          x: 0.6,
          y: 1.8,
          w: 11.5,
          h: 4.8,
          fontSize: 16,
          color: isUsableB64(slide.backgroundB64) ? "FFFFFF" : "FFFFFF",
          fontFace,
          valign: "top",
        },
      );
    }

    if (isUsableB64(slide.illustrationB64)) {
      pptSlide.addImage({
        data: `image/png;base64,${stripB64Prefix(slide.illustrationB64)}`,
        x: 8.5,
        y: 2.5,
        w: 4,
        h: 4,
      });
    }

    if (slide.speakerNotes) {
      pptSlide.addNotes(String(slide.speakerNotes));
    }

    pptSlide.addText(String(slide.type).replace(/_/g, " ").toUpperCase(), {
      x: 0.6,
      y: 6.9,
      w: 5,
      h: 0.3,
      fontSize: 9,
      color: isUsableB64(slide.backgroundB64) ? "CCCCCC" : textColor,
      fontFace,
    });
  }

  const filename = `${sanitizeFilename(deck.meta.title)}.pptx`;
  await pptx.writeFile({ fileName: filename });
}
