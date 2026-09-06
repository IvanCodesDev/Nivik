/**
 * Test-only builders producing fully-defaulted IR objects, so fixtures survive
 * `parse(JSON.parse(JSON.stringify(d)))` deep-equality checks. Not exported from the package.
 */
import type { Id } from '../ids';
import type {
  Diagram,
  DiagramEdge,
  DiagramGroup,
  DiagramNode,
  DiagramType,
  ElementMeta,
} from '../schema';

export const T0 = 1_756_000_000_000;

export const meta = (overrides: Partial<ElementMeta> = {}): ElementMeta => ({
  createdBy: 'ai',
  createdAt: T0,
  updatedAt: T0,
  rev: 0,
  ...overrides,
});

export const node = (
  id: Id,
  label: string,
  overrides: Partial<Omit<DiagramNode, 'id' | 'label'>> = {},
): DiagramNode => ({
  id,
  label,
  type: 'rounded',
  parent: null,
  pinned: false,
  meta: meta(),
  ...overrides,
});

export const edge = (
  id: Id,
  source: Id,
  target: Id,
  overrides: Partial<Omit<DiagramEdge, 'id' | 'source' | 'target'>> = {},
): DiagramEdge => ({
  id,
  source,
  target,
  type: 'flow',
  direction: 'forward',
  sourceSide: 'auto',
  targetSide: 'auto',
  meta: meta(),
  ...overrides,
});

export const group = (
  id: Id,
  label: string | undefined,
  overrides: Partial<Omit<DiagramGroup, 'id' | 'label'>> = {},
): DiagramGroup => ({
  id,
  ...(label !== undefined ? { label } : {}),
  role: 'cluster',
  parent: null,
  collapsed: false,
  meta: meta(),
  ...overrides,
});

export const diagram = (overrides: Partial<Diagram> & { type?: DiagramType } = {}): Diagram => ({
  schema: 'nivik.diagram/1',
  id: 'd_fixture1',
  name: 'Fixture',
  type: 'architecture',
  version: 1,
  nodes: [],
  edges: [],
  groups: [],
  layout: {
    algorithm: 'layered',
    direction: 'RIGHT',
    spacing: 'normal',
    edgeRouting: 'orthogonal',
    autoLayout: true,
  },
  theme: { preset: 'nivik-soft', strokeStyle: 'clean', fontScale: 'm' },
  renderer: { preferred: 'excalidraw', state: {} },
  sources: [],
  meta: { createdAt: T0, updatedAt: T0 },
  ...overrides,
});
