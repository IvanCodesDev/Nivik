import type { Diagram, LayoutSpec } from '@nivik/ir';
import { ELK_TIMEOUT_MS } from './constants';
import { createBundledEngine, LayoutAbortedError, runElk } from './elk/engine';
import { fallbackLayered } from './elk/fallback';
import { fromElk } from './elk/from-elk';
import { toElk } from './elk/to-elk';
import type { Geometry } from './geometry';
import type { LayoutOptions, LayoutWarning, SizeMap } from './types';

/** Spec 03 §5: ELK layered through the injected engine; any failure but abort degrades to the BFS fallback. */
export async function layoutLayered(
  d: Diagram,
  sizes: SizeMap,
  spec: LayoutSpec,
  opts: Pick<LayoutOptions, 'engine' | 'timeoutMs' | 'signal'>,
  warnings: LayoutWarning[],
): Promise<Geometry> {
  const engine = opts.engine ?? (await createBundledEngine());
  try {
    const out = await runElk(
      engine,
      toElk(d, sizes, spec),
      opts.timeoutMs ?? ELK_TIMEOUT_MS,
      opts.signal,
    );
    return fromElk(out, d, spec.edgeRouting === 'straight');
  } catch (error) {
    if (error instanceof LayoutAbortedError) throw error;
    const reason = error instanceof Error ? error.message : String(error);
    warnings.push({
      code: 'W_LAYOUT_FALLBACK',
      ids: [],
      message: `ELK layered layout failed (${reason}); placed by BFS depth instead`,
    });
    return fallbackLayered(d, sizes, spec);
  }
}
