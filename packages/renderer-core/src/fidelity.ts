import type { Diagram, Id, NodeType } from '@nivik/ir';
import type { FidelityReport, RendererCapabilities } from './contract';

export const emptyFidelity = (): FidelityReport => ({ lossless: true, lost: [], approximated: [] });

export function mergeFidelity(...reports: FidelityReport[]): FidelityReport {
  const lost = reports.flatMap((r) => r.lost);
  const approximated = reports.flatMap((r) => r.approximated);
  return { lossless: lost.length === 0 && approximated.length === 0, lost, approximated };
}

/** Spec 04 §5.6 step 3: what a renderer with these capabilities cannot show faithfully. */
export function fidelityFor(
  d: Diagram,
  caps: Pick<RendererCapabilities, 'shapes' | 'groups' | 'nestedGroups'>,
): FidelityReport {
  const report = emptyFidelity();
  const unsupported = new Map<NodeType, Id[]>();
  for (const n of d.nodes) {
    if (caps.shapes.has(n.type)) continue;
    const ids = unsupported.get(n.type);
    if (ids) ids.push(n.id);
    else unsupported.set(n.type, [n.id]);
  }
  for (const [type, ids] of unsupported) report.approximated.push({ ids, from: type, to: 'box' });
  if (caps.groups === 'none' && d.groups.length > 0) {
    report.lost.push({
      kind: 'group',
      ids: d.groups.map((g) => g.id),
      reason: 'renderer has no group primitive',
    });
  } else if (!caps.nestedGroups) {
    const nested = d.groups.filter((g) => g.parent !== null).map((g) => g.id);
    if (nested.length > 0) {
      report.approximated.push({ ids: nested, from: 'nested group', to: 'flat group' });
    }
  }
  report.lossless = report.lost.length === 0 && report.approximated.length === 0;
  return report;
}
