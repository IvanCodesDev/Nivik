import { describe, expect, it } from 'vitest';
import { boxesOverlap, hitTest, layoutMindMap, rangeBox, splitBalanced } from './layout';
import {
  findParent,
  findTopic,
  flatten,
  insertChild,
  type MindMap,
  mockGenerate,
  moveTopic,
  normalize,
  removeTopic,
  sampleMindMap,
  topic,
} from './model';

function must<T>(value: T | undefined | null, what: string): T {
  if (value === undefined || value === null) throw new Error(`missing: ${what}`);
  return value;
}

function allPairsDisjoint(map: MindMap) {
  const layout = layoutMindMap(map);
  const boxes = layout.order.map((p) => ({ id: p.id, box: p.box }));
  for (const [i, a] of boxes.entries()) {
    for (const b of boxes.slice(i + 1)) {
      expect(boxesOverlap(a.box, b.box), `${a.id} vs ${b.id}`).toBe(false);
    }
  }
  return layout;
}

describe('mind map model', () => {
  it('moves a topic under a new parent and refuses cycles', () => {
    const map = sampleMindMap();
    const a = must(map.root.children[0], 'branch a');
    const b = must(map.root.children[1], 'branch b');
    const grandchild = must(b.children[0], 'b child');
    const moved = moveTopic(map.root, grandchild.id, a.id);
    expect(findParent(moved, grandchild.id)?.parent.id).toBe(a.id);
    // A topic cannot become its own descendant.
    expect(moveTopic(map.root, a.id, must(a.children[0], 'a child').id)).toBe(map.root);
    // The root never moves.
    expect(moveTopic(map.root, map.root.id, a.id)).toBe(map.root);
  });

  it('keeps the index right when reordering among siblings', () => {
    const root = topic('r', [topic('a'), topic('b'), topic('c')], { id: 'r' });
    const a = must(root.children[0], 'a');
    const c = must(root.children[2], 'c');
    const moved = moveTopic(root, a.id, 'r', 3);
    expect(moved.children.map((t) => t.title)).toEqual(['b', 'c', 'a']);
    const back = moveTopic(moved, c.id, 'r', 0);
    expect(back.children.map((t) => t.title)).toEqual(['c', 'b', 'a']);
  });

  it('prunes relationships and clamps ranges after a removal', () => {
    const map = sampleMindMap();
    const rel = must(map.relationships[0], 'relationship');
    const without = normalize({ ...map, root: removeTopic(map.root, rel.from) });
    expect(without.relationships).toEqual([]);
    expect(findTopic(without.root, rel.from)).toBeUndefined();

    const summary = must(map.summaries[0], 'summary');
    const parent = must(findTopic(map.root, summary.parent), 'summary parent');
    let root = map.root;
    for (const child of parent.children.slice(1)) root = removeTopic(root, child.id);
    const clamped = normalize({ ...map, root });
    expect(clamped.summaries[0]).toMatchObject({ from: 0, to: 0 });
  });

  it('replays a mock generation into a tree', () => {
    const { root, steps } = mockGenerate('季度规划');
    let tree = root;
    for (const step of steps) tree = insertChild(tree, step.parentId, step.topic);
    expect(tree.title).toBe('季度规划');
    expect(tree.children).toHaveLength(5);
    expect(flatten(tree)).toHaveLength(1 + steps.length);
  });
});

describe('mind map layout', () => {
  it('is deterministic', () => {
    const map = sampleMindMap();
    expect(layoutMindMap(map)).toEqual(layoutMindMap(map));
  });

  it('never overlaps visible topics in any structure', () => {
    const map = sampleMindMap();
    allPairsDisjoint({ ...map, structure: 'map' });
    allPairsDisjoint({ ...map, structure: 'logic' });
    allPairsDisjoint({ ...map, structure: 'org' });
  });

  it('splits the two-sided map by height, first children on the right', () => {
    expect(splitBalanced([])).toBe(0);
    expect(splitBalanced([10])).toBe(1);
    expect(splitBalanced([10, 10])).toBe(1);
    expect(splitBalanced([10, 10, 10])).toBe(2);
    expect(splitBalanced([50, 10, 10, 10])).toBe(1);

    const layout = layoutMindMap({ ...sampleMindMap(), structure: 'map' });
    const root = must(layout.placed.get('root'), 'root');
    const level1 = layout.order.filter((p) => p.depth === 1);
    const right = level1.filter((p) => p.dir === 'right');
    const left = level1.filter((p) => p.dir === 'left');
    expect(right.length).toBeGreaterThan(0);
    expect(left.length).toBeGreaterThan(0);
    // Order is preserved: the right side holds the first children, the left side the rest.
    expect(right.map((p) => p.branch)).toEqual(right.map((_, i) => i));
    expect(left.map((p) => p.branch)).toEqual(left.map((_, i) => right.length + i));
    for (const p of right) expect(p.box.x).toBeGreaterThan(root.box.x + root.box.w);
    for (const p of left) expect(p.box.x + p.box.w).toBeLessThan(root.box.x);
  });

  it('hides collapsed subtrees and reports how many topics are behind them', () => {
    const map = sampleMindMap();
    const collapsed = must(
      map.root.children.find((c) => c.collapsed),
      'collapsed branch',
    );
    const layout = layoutMindMap(map);
    expect(layout.placed.get(collapsed.id)?.hiddenCount).toBe(collapsed.children.length);
    for (const child of collapsed.children) expect(layout.placed.has(child.id)).toBe(false);
    expect(layout.connectors.some((c) => c.from === collapsed.id)).toBe(false);
  });

  it('stacks the org chart downwards', () => {
    const layout = layoutMindMap({ ...sampleMindMap(), structure: 'org' });
    const root = must(layout.placed.get('root'), 'root');
    for (const p of layout.order.filter((p) => p.depth === 1)) {
      expect(p.dir).toBe('down');
      expect(p.box.y).toBeGreaterThan(root.box.y + root.box.h);
    }
  });

  it('computes a range box for boundaries and finds topics by point', () => {
    const map = sampleMindMap();
    const layout = layoutMindMap(map);
    const boundary = must(map.boundaries[0], 'boundary');
    const parent = must(findTopic(map.root, boundary.parent), 'boundary parent');
    const box = must(rangeBox(layout, parent, boundary.from, boundary.to), 'range box');
    const firstChild = must(parent.children[boundary.from], 'first child in range');
    const first = must(layout.placed.get(firstChild.id), 'first child placed').box;
    expect(box.x).toBeLessThanOrEqual(first.x);
    expect(box.y).toBeLessThanOrEqual(first.y);
    expect(hitTest(layout, first.x + 1, first.y + 1)?.id).toBe(firstChild.id);
    expect(hitTest(layout, 1e6, 1e6)).toBeUndefined();
  });
});
