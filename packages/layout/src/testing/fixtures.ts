/**
 * Layout fixtures: the spec 03 §7.2 grid recipes and the §10 test cases. Exported as
 * `@nivik/layout/testing` so renderer and harness tests can reuse them.
 */
import type { Cell, Diagram, LayoutSpec } from '@nivik/ir';
import { diagram, edge, group, node } from '@nivik/ir/testing';

export const gridLayout = (spacing: LayoutSpec['spacing'] = 'normal'): LayoutSpec => ({
  algorithm: 'grid',
  direction: 'RIGHT',
  spacing,
  edgeRouting: 'orthogonal',
  autoLayout: true,
});

export const cellAt = (col: number, row: number, colSpan = 1, rowSpan = 1): Cell => ({
  col,
  row,
  colSpan,
  rowSpan,
});

const text = (id: string, label: string, parent: string) =>
  node(id, label, { type: 'text', parent });

/** Spec 01 §7.4 / 03 §7.2 recipe: 2×2 frames with cells, entries without cells stack inside. */
export const swot = (): Diagram =>
  diagram({
    id: 'd_swot',
    name: 'Q3 SWOT',
    type: 'swot',
    version: 3,
    layout: gridLayout(),
    groups: [
      group('s', 'Strengths', { role: 'frame', cell: cellAt(0, 0) }),
      group('w', 'Weaknesses', { role: 'frame', cell: cellAt(1, 0) }),
      group('o', 'Opportunities', { role: 'frame', cell: cellAt(0, 1) }),
      group('t', 'Threats', { role: 'frame', cell: cellAt(1, 1) }),
    ],
    nodes: [
      text('s1', 'Strong brand', 's'),
      text('s2', 'Low churn', 's'),
      text('w1', 'Single supplier', 'w'),
      text('w2', 'Thin margins', 'w'),
      text('o1', 'New markets', 'o'),
      text('o2', 'Partnerships', 'o'),
      text('t1', 'Price war', 't'),
      text('t2', 'Regulation', 't'),
    ],
  });

/** Lanes span three rows; cards have no cells and stack top-down inside their lane. */
export const kanban = (): Diagram =>
  diagram({
    id: 'd_kanban',
    name: 'Sprint board',
    type: 'kanban',
    layout: gridLayout(),
    groups: [
      group('todo', 'To do', { role: 'lane', cell: cellAt(0, 0, 1, 3) }),
      group('doing', 'Doing', { role: 'lane', cell: cellAt(1, 0, 1, 3) }),
      group('done', 'Done', { role: 'lane', cell: cellAt(2, 0, 1, 3) }),
    ],
    nodes: [
      node('k1', 'Write spec', { parent: 'todo' }),
      node('k2', 'Design tokens', { parent: 'todo' }),
      node('k3', 'Layout engine', { parent: 'doing' }),
      node('k4', 'Grid cells', { parent: 'doing' }),
      node('k5', 'Storage repo', { parent: 'doing' }),
      node('k6', 'IR schema', { parent: 'done' }),
    ],
  });

/** A line spanning the middle row, events alternating above and below, years on the axis row. */
export const timeline = (): Diagram =>
  diagram({
    id: 'd_timeline',
    name: 'Company timeline',
    type: 'timeline',
    layout: gridLayout(),
    nodes: [
      node('axis', '', { type: 'line', cell: cellAt(0, 1, 5, 1), data: { arrow: 'end' } }),
      node('e0', 'Founded', { cell: cellAt(0, 0) }),
      node('e1', 'Seed round', { cell: cellAt(1, 2) }),
      node('e2', 'First customer', { cell: cellAt(2, 0) }),
      node('e3', 'Series A', { cell: cellAt(3, 2) }),
      node('e4', '100 employees', { cell: cellAt(4, 0) }),
      ...['2019', '2020', '2021', '2022', '2023'].map((year, i) =>
        node(`y${i}`, year, { type: 'text', cell: cellAt(i, 1) }),
      ),
    ],
  });

/** Four layers on a 12-column grid, spans 4/6/8/10 centred on column 6. */
export const pyramid = (): Diagram =>
  diagram({
    id: 'd_pyramid',
    name: 'Strategy pyramid',
    type: 'pyramid',
    layout: gridLayout(),
    nodes: [
      node('p0', 'Vision', { cell: cellAt(4, 0, 4, 1), style: { fill: 'solid' } }),
      node('p1', 'Strategy', { cell: cellAt(3, 1, 6, 1), style: { fill: 'solid' } }),
      node('p2', 'Initiatives', { cell: cellAt(2, 2, 8, 1), style: { fill: 'solid' } }),
      node('p3', 'Daily work', { cell: cellAt(1, 3, 10, 1), style: { fill: 'solid' } }),
    ],
  });

/** Two translucent ellipses on intersecting 3×3 ranges with a label in the overlap. */
export const venn = (): Diagram =>
  diagram({
    id: 'd_venn',
    name: 'Skills overlap',
    type: 'venn',
    layout: gridLayout(),
    nodes: [
      node('a', 'Design', {
        type: 'ellipse',
        cell: cellAt(0, 0, 3, 3),
        style: { fill: 'translucent' },
      }),
      node('b', 'Engineering', {
        type: 'ellipse',
        cell: cellAt(2, 0, 3, 3),
        style: { fill: 'translucent' },
      }),
      node('both', 'Both', { type: 'text', cell: cellAt(2, 1) }),
    ],
  });

const participant = (
  id: string,
  label: string,
  kind: 'actor' | 'system' | 'database' | 'external',
  order: number,
) => node(id, label, { type: 'participant', data: { kind, order } });

const message = (
  id: string,
  source: string,
  target: string,
  order: number,
  label: string,
  kind: 'sync' | 'async' | 'return' = 'sync',
) => edge(id, source, target, { type: 'message', label, data: { order, kind } });

/** Spec 03 §10 sequence fixture: four participants, six messages, one of them a self message. */
export const checkout = (): Diagram =>
  diagram({
    id: 'd_checkout',
    name: 'Checkout',
    type: 'sequence',
    layout: {
      algorithm: 'sequence',
      direction: 'RIGHT',
      spacing: 'normal',
      edgeRouting: 'orthogonal',
      autoLayout: true,
    },
    nodes: [
      participant('user', 'User', 'actor', 0),
      participant('api', 'API', 'system', 1),
      participant('db', 'DB', 'database', 2),
      participant('mail', 'Mailer', 'external', 3),
    ],
    edges: [
      message('m1', 'user', 'api', 0, 'POST /checkout'),
      message('m2', 'api', 'db', 1, 'insert order'),
      message('m3', 'db', 'api', 2, 'ok', 'return'),
      message('m4', 'api', 'api', 3, 'validate'),
      message('m5', 'api', 'mail', 4, 'send receipt', 'async'),
      message('m6', 'api', 'user', 5, '201 Created', 'return'),
    ],
  });
