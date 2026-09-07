import { type Diagram, type Id, indexDiagram, type Rect } from '@nivik/ir';
import { MIN_NODE_H, MIN_NODE_W } from './constants';
import { emptyGeometry, fitGroups, type Geometry, rectIn } from './geometry';
import { straightRoute } from './routing';
import type { SizeMap } from './types';

/**
 * Spec 03 §7.1 constants. Lifelines are not stored on the IR (`ParticipantData` is strict and
 * `applyLayout` carries no data); renderers draw them from `topY + headerH` down to the last
 * message's y plus `lifelineTail`.
 */
export const SEQUENCE_METRICS = {
  headerW: 140,
  headerH: 48,
  gapX: 80,
  topY: 40,
  msgGap: 56,
  firstMsgOffset: 40,
  selfLoopW: 40,
  selfLoopH: 20,
  leftX: 40,
  lifelineTail: 40,
} as const;

const orderOf = (data: Record<string, unknown> | undefined): number | null => {
  const order = data?.order;
  return typeof order === 'number' ? order : null;
};

export function layoutSequence(d: Diagram, sizes: SizeMap): Geometry {
  const M = SEQUENCE_METRICS;
  const g = emptyGeometry();
  const index = indexDiagram(d);
  const frozen = (n: { pinned: boolean; position?: unknown }) =>
    n.pinned && n.position !== undefined;

  const messages = d.edges
    .map((e, i) => ({ e, order: orderOf(e.data) ?? i }))
    .filter(({ e }) => e.type === 'message')
    .sort((a, b) => a.order - b.order);
  const firstSeen = new Map<Id, number>();
  for (const { e } of messages) {
    for (const id of [e.source, e.target]) {
      if (!firstSeen.has(id)) firstSeen.set(id, firstSeen.size);
    }
  }

  const participants = d.nodes
    .map((n, i) => ({ n, key: orderOf(n.data) ?? 1_000 + (firstSeen.get(n.id) ?? 1_000 + i) }))
    .filter(({ n }) => n.type === 'participant' && !frozen(n))
    .sort((a, b) => a.key - b.key);
  for (const [i, { n }] of participants.entries()) {
    g.positions.set(n.id, { x: M.leftX + i * (M.headerW + M.gapX), y: M.topY });
    g.sizes.set(n.id, sizes.get(n.id) ?? { w: M.headerW, h: M.headerH });
  }

  const messageY = (k: number) => M.topY + M.headerH + M.firstMsgOffset + k * M.msgGap;
  const lastY = messageY(Math.max(0, messages.length - 1));

  // Notes, lines and anything else line up under the last message.
  let x = M.leftX;
  for (const n of d.nodes) {
    if (n.type === 'participant' || frozen(n)) continue;
    const s = sizes.get(n.id) ?? { w: MIN_NODE_W, h: MIN_NODE_H };
    g.positions.set(n.id, { x, y: lastY + 2 * M.lifelineTail });
    g.sizes.set(n.id, s);
    x += s.w + M.leftX;
  }

  const rectOfNode = (id: Id): Rect | null => {
    const n = index.nodes.get(id);
    return n ? rectIn(g, n) : null;
  };
  const centreX = (r: Rect) => r.x + r.w / 2;
  for (const [k, { e }] of messages.entries()) {
    const a = rectOfNode(e.source);
    const b = rectOfNode(e.target);
    if (!a || !b) continue;
    const y = messageY(k);
    if (e.source === e.target) {
      const x0 = centreX(a);
      g.routes.set(e.id, [
        { x: x0, y },
        { x: x0 + M.selfLoopW, y },
        { x: x0 + M.selfLoopW, y: y + M.selfLoopH },
        { x: x0, y: y + M.selfLoopH },
      ]);
    } else {
      g.routes.set(e.id, [
        { x: centreX(a), y },
        { x: centreX(b), y },
      ]);
    }
  }
  for (const e of d.edges) {
    if (e.type === 'message' || e.source === e.target) continue;
    const a = rectOfNode(e.source);
    const b = rectOfNode(e.target);
    if (a && b) g.routes.set(e.id, straightRoute(a, b));
  }
  fitGroups(d, g);
  return g;
}
