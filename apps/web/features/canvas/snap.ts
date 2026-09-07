/**
 * Grid snapping for the sketch canvas. Screen space is used throughout: the grid dots are drawn
 * by `.paper` centred on the viewport, so a node corner is "on the grid" when its distance from
 * the paper's centre is a whole number of (zoomed) cells.
 */

export interface Point {
  x: number;
  y: number;
}

/** Nearest grid line to `value`, with lines every `cell` px from `origin`. */
export function snapToGrid(value: number, origin: number, cell: number): number {
  if (cell <= 0) return value;
  return origin + Math.round((value - origin) / cell) * cell;
}

export interface DragInput {
  /** Node corner (screen px) and translation (diagram px) when the drag started. */
  start: { left: number; top: number; dx: number; dy: number };
  /** Pointer movement since the drag started (screen px). */
  pointer: Point;
  /** Centre of the grid pattern (screen px). */
  origin: Point;
  /** Grid cell in diagram px; the screen cell is `gridSize * scale`. */
  gridSize: number;
  /** Current zoom (1 = 100%); the stage is scaled, pointer movement is not. */
  scale: number;
  snap: boolean;
}

/** The part of a drag that describes the canvas rather than the gesture. */
export type SnapFrame = Pick<DragInput, 'origin' | 'gridSize' | 'scale' | 'snap'>;

/** Translation (diagram px) to apply to the node for the current pointer position. */
export function dragTranslation({ start, pointer, origin, gridSize, scale, snap }: DragInput): {
  dx: number;
  dy: number;
} {
  let left = start.left + pointer.x;
  let top = start.top + pointer.y;
  if (snap) {
    const cell = gridSize * scale;
    left = snapToGrid(left, origin.x, cell);
    top = snapToGrid(top, origin.y, cell);
  }
  return {
    dx: start.dx + (left - start.left) / scale,
    dy: start.dy + (top - start.top) / scale,
  };
}

/** Distance (diagram px) one arrow-key press moves a node. */
export function nudgeStep(snap: boolean, gridSize: number): number {
  return snap ? gridSize : 1;
}
