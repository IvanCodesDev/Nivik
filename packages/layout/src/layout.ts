import type { Diagram, LayoutSpec } from '@nivik/ir';
import { emptyGeometry, type Geometry } from './geometry';
import { layoutGrid } from './grid';
import { layoutLayered } from './layered';
import { resolveSizes } from './measure';
import { applyGeometry } from './result';
import { layoutSequence } from './sequence';
import type { LayoutOptions, LayoutResult, LayoutWarning, SizeMap } from './types';

/** Spec 03 §2 `measure-only` and §3 `manual`: sizes may change, positions never do. */
function measuredOnly(d: Diagram, sizes: SizeMap, warnings: LayoutWarning[]): Geometry {
  const g = emptyGeometry();
  for (const [id, size] of sizes) g.sizes.set(id, size);
  const unplaced = d.nodes.filter((n) => !n.position).map((n) => n.id);
  if (unplaced.length > 0) {
    warnings.push({
      code: 'W_UNPLACED',
      ids: unplaced,
      message: `${unplaced.length} node(s) have no position; manual layout leaves placement to the user`,
    });
  }
  return g;
}

async function place(
  d: Diagram,
  sizes: SizeMap,
  spec: LayoutSpec,
  opts: LayoutOptions,
  warnings: LayoutWarning[],
): Promise<Geometry> {
  switch (spec.algorithm) {
    case 'grid':
      return layoutGrid(d, sizes, spec, warnings);
    case 'sequence':
      return layoutSequence(d, sizes);
    case 'radial':
      warnings.push({
        code: 'W_LAYOUT_FALLBACK',
        ids: [],
        message: 'radial layout is not implemented yet (P2); laid out as layered',
      });
      return layoutLayered(d, sizes, spec, opts, warnings);
    case 'layered':
      return layoutLayered(d, sizes, spec, opts, warnings);
    case 'manual':
      return measuredOnly(d, sizes, warnings);
  }
}

/**
 * Spec 03 §2: pure IR → IR. Dispatches on `layout.algorithm` (never on the diagram type); the
 * `incremental` mode runs a full pass until task 1.2 lands true incremental layout.
 */
export async function layoutDiagram(d: Diagram, opts: LayoutOptions): Promise<LayoutResult> {
  const started = performance.now();
  const spec: LayoutSpec = { ...d.layout, ...opts.spec };
  const warnings: LayoutWarning[] = [];
  const remeasure = opts.mode.kind === 'measure-only' ? new Set(opts.mode.ids) : 'all';
  const sizes = resolveSizes(d, opts.measurer, remeasure);
  const geometry =
    remeasure !== 'all' || spec.algorithm === 'manual'
      ? measuredOnly(d, sizes, warnings)
      : await place(d, sizes, spec, opts, warnings);
  const { diagram, moved, routed } = applyGeometry(d, geometry);
  return {
    diagram,
    moved,
    routed,
    durationMs: Math.round(performance.now() - started),
    warnings,
  };
}
