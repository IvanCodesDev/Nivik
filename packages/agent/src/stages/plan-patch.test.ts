import { createDiagram } from '@nivik/ir';
import type { Plan } from '@nivik/protocol';
import { describe, expect, it } from 'vitest';
import { diagramPatchFromPlan } from './plan-patch';

const plan = (overrides: Partial<Plan> = {}): Plan => ({
  intent: 'generate',
  diagramType: 'flow',
  scope: { kind: 'all' },
  summary: 'Sketch',
  steps: [],
  layout: { algorithm: 'layered', direction: 'RIGHT' },
  estimatedNodes: 3,
  ...overrides,
});

describe('diagramPatchFromPlan', () => {
  it('types a fresh generic document with the plan classification', () => {
    const diagram = createDiagram({ name: 'Untitled', type: 'generic', id: 'd_fresh001' });
    expect(diagramPatchFromPlan(plan(), diagram)).toEqual({ type: 'flow' });
  });

  it('returns null when the plan keeps the current type and layout', () => {
    const diagram = createDiagram({ name: 'Flow', type: 'flow', id: 'd_flow0001' });
    expect(diagramPatchFromPlan(plan(), diagram)).toBeNull();
  });

  it('writes only the layout fields that changed', () => {
    const diagram = createDiagram({ name: 'Flow', type: 'flow', id: 'd_flow0002' });
    const next = plan({ layout: { algorithm: 'layered', direction: 'DOWN' } });
    expect(diagramPatchFromPlan(next, diagram)).toEqual({ layout: { direction: 'DOWN' } });
  });

  it('combines a convert with its layout change into one patch', () => {
    const diagram = createDiagram({ name: 'Arch', type: 'architecture', id: 'd_arch0001' });
    const next = plan({
      intent: 'convert',
      diagramType: 'sequence',
      layout: { algorithm: 'sequence', direction: 'RIGHT' },
    });
    expect(diagramPatchFromPlan(next, diagram)).toEqual({
      type: 'sequence',
      layout: { algorithm: 'sequence' },
    });
  });

  it('ignores layout fields the plan left undefined', () => {
    const diagram = createDiagram({ name: 'Flow', type: 'flow', id: 'd_flow0003' });
    expect(diagramPatchFromPlan(plan({ layout: {} }), diagram)).toBeNull();
  });

  it('writes an open type and the grid strategy back verbatim on a fresh document', () => {
    const diagram = createDiagram({ name: 'Journey', id: 'd_journey01' });
    const next = plan({ diagramType: 'customer-journey', layout: { algorithm: 'grid' } });
    expect(diagramPatchFromPlan(next, diagram)).toEqual({
      type: 'customer-journey',
      layout: { algorithm: 'grid' },
    });
  });
});
