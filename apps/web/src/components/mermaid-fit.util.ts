/** Ajuste de zoom/desplazamiento para la vista fullscreen de diagramas Mermaid (puro, sin React). */

/** Rango de zoom alineado con ExcalidrawDiagramBlock (máximo nativo 30×). */
export const PAN_ZOOM_MIN = 0.1;
export const PAN_ZOOM_MAX = 30;
export const PAN_ZOOM_FIT_PADDING = 40;

export type PanZoomState = { scale: number; x: number; y: number };

export function clampPanZoomScale(scale: number): number {
  return Math.min(PAN_ZOOM_MAX, Math.max(PAN_ZOOM_MIN, scale));
}

export function computeMermaidFitTransform(
  viewportW: number,
  viewportH: number,
  contentW: number,
  contentH: number,
  padding = PAN_ZOOM_FIT_PADDING,
): PanZoomState {
  if (viewportW <= 0 || viewportH <= 0 || contentW <= 0 || contentH <= 0) {
    return { scale: 1, x: 0, y: 0 };
  }
  const availW = Math.max(1, viewportW - padding * 2);
  const availH = Math.max(1, viewportH - padding * 2);
  const scale = clampPanZoomScale(Math.min(availW / contentW, availH / contentH));
  return {
    scale,
    x: (viewportW - contentW * scale) / 2,
    y: (viewportH - contentH * scale) / 2,
  };
}
