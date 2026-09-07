import {
  createMeasurer,
  estimateTextWidth,
  type NodeMeasurer,
  type TextWidth,
} from '@nivik/layout';

/** Spec 03 §4.1: the renderer's measurer; without canvas metrics it falls back to the estimate. */
export const createExcalidrawMeasurer = (textWidth: TextWidth = estimateTextWidth): NodeMeasurer =>
  createMeasurer(textWidth);

/** Browser only: measure with the font Excalidraw renders. Null when no 2D context is available. */
export function canvasTextWidth(doc: Document, fontCss: string): TextWidth | null {
  const ctx = doc.createElement('canvas').getContext('2d');
  if (!ctx) return null;
  return (text, fontPx) => {
    ctx.font = `${fontPx}px ${fontCss}`;
    return ctx.measureText(text).width;
  };
}
