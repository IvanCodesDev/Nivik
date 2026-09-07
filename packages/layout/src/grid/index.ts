import { type Diagram, indexDiagram, type LayoutSpec } from '@nivik/ir';
import { GRID_GUTTER } from '../constants';
import type { Geometry } from '../geometry';
import type { LayoutWarning, SizeMap } from '../types';
import { collectRequirements, measureTracks } from './metrics';
import { placeGrid } from './place';
import { planCells } from './plan';

/** Spec 03 §7.2 格位布局: cells are intent, pixels are the result. */
export function layoutGrid(
  d: Diagram,
  sizes: SizeMap,
  spec: LayoutSpec,
  warnings: LayoutWarning[],
): Geometry {
  const index = indexDiagram(d);
  const skip = new Set(d.nodes.filter((n) => n.pinned && n.position).map((n) => n.id));
  const plan = planCells(d, index, skip, warnings);
  const gutter = GRID_GUTTER[spec.spacing];
  const tracks = measureTracks(plan, collectRequirements(d, index, plan, sizes, gutter), gutter);
  return placeGrid(d, index, plan, tracks, sizes, spec);
}
