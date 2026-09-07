import { type Diagram, familyOf, type LayoutSpec } from '@nivik/ir';

/**
 * Spec 03 §3: the plan stage picks the algorithm; this is the code fallback by layout family.
 * The only place in the package that looks at a diagram type.
 */
export function defaultAlgorithmFor(
  type: string,
  diagram: Pick<Diagram, 'edges'>,
): LayoutSpec['algorithm'] {
  if (type === 'mindmap' || type === 'cycle') return 'radial';
  if (type === 'timeline' || type === 'gantt' || type === 'roadmap') return 'grid';
  switch (familyOf(type)) {
    case 'graph':
    case 'tree':
      return 'layered';
    case 'time':
      return 'sequence';
    case 'grid':
    case 'arrangement':
      return 'grid';
    case null:
      return diagram.edges.length > 0 ? 'layered' : 'grid';
  }
}
