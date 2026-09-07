/**
 * SPIKE — throwaway data model for the mind map demo page (/mindmap-demo).
 *
 * Deliberately not the Diagram IR: the demo exists to judge whether a dedicated, always-auto-laid-out
 * tree editor is the right product shape for mind maps before any of this is specified. Nothing here
 * is persisted or shared with the rest of the app.
 */

export type Structure = 'map' | 'logic' | 'org';

export const STRUCTURES: readonly Structure[] = ['map', 'logic', 'org'];

export type Marker = 'p1' | 'p2' | 'p3' | 'flag' | 'star' | 'done' | 'question';

export const MARKERS: readonly Marker[] = ['p1', 'p2', 'p3', 'flag', 'star', 'done', 'question'];

export interface Topic {
  id: string;
  title: string;
  children: Topic[];
  collapsed?: boolean;
  note?: string;
  markers?: Marker[];
  link?: string;
}

export interface Relationship {
  id: string;
  from: string;
  to: string;
  label?: string;
}

/** A contiguous range of siblings (`from..to`, inclusive indexes) under `parent`. */
export interface SiblingRange {
  id: string;
  parent: string;
  from: number;
  to: number;
}

export interface Boundary extends SiblingRange {
  label?: string;
}

export interface Summary extends SiblingRange {
  text: string;
}

export interface MindMap {
  title: string;
  structure: Structure;
  root: Topic;
  relationships: Relationship[];
  boundaries: Boundary[];
  summaries: Summary[];
}

let counter = 0;
export function nextId(prefix = 't'): string {
  counter += 1;
  return `${prefix}-${Date.now().toString(36)}-${counter}`;
}

export function topic(title: string, children: Topic[] = [], extra: Partial<Topic> = {}): Topic {
  return { id: extra.id ?? nextId(), title, children, ...extra };
}

/* ---------------------------------------------------------------------------------------- */
/* Read-only queries                                                                          */
/* ---------------------------------------------------------------------------------------- */

export function findTopic(root: Topic, id: string): Topic | undefined {
  if (root.id === id) return root;
  for (const child of root.children) {
    const hit = findTopic(child, id);
    if (hit) return hit;
  }
  return undefined;
}

export interface ParentHit {
  parent: Topic;
  index: number;
}

export function findParent(root: Topic, id: string): ParentHit | undefined {
  const index = root.children.findIndex((c) => c.id === id);
  if (index >= 0) return { parent: root, index };
  for (const child of root.children) {
    const hit = findParent(child, id);
    if (hit) return hit;
  }
  return undefined;
}

export function isDescendant(ancestor: Topic, id: string): boolean {
  return ancestor.children.some((c) => c.id === id || isDescendant(c, id));
}

export function countDescendants(t: Topic): number {
  return t.children.reduce((sum, c) => sum + 1 + countDescendants(c), 0);
}

export interface FlatTopic {
  topic: Topic;
  depth: number;
  parent: Topic | null;
}

/** Pre-order walk; `visibleOnly` skips the subtrees of collapsed topics. */
export function flatten(root: Topic, visibleOnly = false): FlatTopic[] {
  const out: FlatTopic[] = [];
  const walk = (t: Topic, depth: number, parent: Topic | null) => {
    out.push({ topic: t, depth, parent });
    if (visibleOnly && t.collapsed) return;
    for (const c of t.children) walk(c, depth + 1, t);
  };
  walk(root, 0, null);
  return out;
}

/* ---------------------------------------------------------------------------------------- */
/* Immutable updates                                                                          */
/* ---------------------------------------------------------------------------------------- */

export function updateTopic(root: Topic, id: string, fn: (t: Topic) => Topic): Topic {
  if (root.id === id) return fn(root);
  let changed = false;
  const children = root.children.map((c) => {
    const next = updateTopic(c, id, fn);
    if (next !== c) changed = true;
    return next;
  });
  return changed ? { ...root, children } : root;
}

export function insertChild(root: Topic, parentId: string, child: Topic, index?: number): Topic {
  return updateTopic(root, parentId, (p) => {
    const children = p.children.slice();
    children.splice(index ?? children.length, 0, child);
    return { ...p, children, collapsed: false };
  });
}

export function removeTopic(root: Topic, id: string): Topic {
  if (root.id === id) return root;
  return updateTopic(root, findParent(root, id)?.parent.id ?? root.id, (p) => ({
    ...p,
    children: p.children.filter((c) => c.id !== id),
  }));
}

/** Re-parents `id` under `newParentId` at `index` (end when omitted). No-op for illegal moves. */
export function moveTopic(root: Topic, id: string, newParentId: string, index?: number): Topic {
  if (id === root.id || id === newParentId) return root;
  const moving = findTopic(root, id);
  if (!moving || isDescendant(moving, newParentId)) return root;
  const from = findParent(root, id);
  if (!from) return root;
  // Removing first shifts the target index when both live under the same parent.
  let at = index;
  if (at !== undefined && from.parent.id === newParentId && from.index < at) at -= 1;
  return insertChild(removeTopic(root, id), newParentId, moving, at);
}

/** Keeps sibling ranges valid after children under `parent` changed. */
export function clampRanges<T extends SiblingRange>(ranges: T[], root: Topic): T[] {
  return ranges.flatMap((r) => {
    const parent = findTopic(root, r.parent);
    if (!parent || parent.children.length === 0) return [];
    const last = parent.children.length - 1;
    const from = Math.min(r.from, last);
    const to = Math.min(Math.max(r.to, from), last);
    return [{ ...r, from, to }];
  });
}

/** Drops relationships whose ends no longer exist. */
export function pruneRelationships(rels: Relationship[], root: Topic): Relationship[] {
  return rels.filter((r) => findTopic(root, r.from) && findTopic(root, r.to));
}

export function normalize(map: MindMap): MindMap {
  return {
    ...map,
    relationships: pruneRelationships(map.relationships, map.root),
    boundaries: clampRanges(map.boundaries, map.root),
    summaries: clampRanges(map.summaries, map.root),
  };
}

/* ---------------------------------------------------------------------------------------- */
/* Sample document                                                                           */
/* ---------------------------------------------------------------------------------------- */

export function sampleMindMap(): MindMap {
  const root = topic(
    'Nivik 思维导图',
    [
      topic(
        '为什么单独做',
        [
          topic('画图工具的自由排版不适合树', [], {
            note: 'Excalidraw / draw.io 的核心是自由放置和手动连线；思维导图要的是"输入结构、排版自动"，两者的交互模型相反。',
          }),
          topic('布局永远自动，没有 pinned'),
          topic('Tab / Enter 就是全部输入方式'),
        ],
        { markers: ['p1'] },
      ),
      topic(
        '编辑器能力',
        [
          topic('折叠 / 展开分支', [topic('折叠后显示隐藏数量'), topic('空格键切换')]),
          topic('备注', [], { note: '备注是长文本，悬浮或侧栏查看，不参与布局。' }),
          topic('标记', [], { markers: ['star', 'flag'] }),
          topic('超链接', [], { link: 'https://xmind.app' }),
          topic('联系线 · 外框 · 概要'),
        ],
        { markers: ['p2'] },
      ),
      topic(
        'AI 能力',
        [
          topic('从主题生成整图'),
          topic('从文档 / URL 提炼'),
          topic('选中分支局部修改', [topic('展开'), topic('精简'), topic('重组')]),
          topic('变更审查：高亮 · 接受 · 撤销', [], { markers: ['p1'] }),
        ],
        { markers: ['p1'] },
      ),
      topic(
        '结构',
        [topic('左右平衡（经典导图）'), topic('右侧逻辑图'), topic('自上而下组织结构')],
        { collapsed: true },
      ),
      topic('导入导出', [topic('PNG / SVG'), topic('Markdown 大纲'), topic('.xmind（后续）')]),
    ],
    { id: 'root' },
  );

  const byTitle = (title: string): Topic => {
    const hit = flatten(root).find((f) => f.topic.title === title)?.topic;
    if (!hit) throw new Error(`sample topic missing: ${title}`);
    return hit;
  };

  return {
    title: 'Nivik 思维导图 Demo',
    structure: 'map',
    root,
    relationships: [
      {
        id: 'r1',
        from: byTitle('布局永远自动，没有 pinned').id,
        to: byTitle('选中分支局部修改').id,
        label: 'AI 改结构，代码排像素',
      },
    ],
    boundaries: [{ id: 'b1', parent: byTitle('AI 能力').id, from: 0, to: 1, label: '生成' }],
    summaries: [{ id: 's1', parent: byTitle('编辑器能力').id, from: 0, to: 3, text: 'v1 范围' }],
  };
}

/* ---------------------------------------------------------------------------------------- */
/* Mock "agent" output                                                                       */
/* ---------------------------------------------------------------------------------------- */

const CANNED_BRANCHES: readonly (readonly [string, readonly string[]])[] = [
  ['背景与现状', ['当前痛点', '已有做法', '机会窗口']],
  ['目标', ['核心指标', '非目标']],
  ['关键方案', ['方案 A', '方案 B', '取舍与理由']],
  ['里程碑', ['第 1 周', '第 2–4 周', '第 5 周起']],
  ['风险与对策', ['技术风险', '资源风险', '应对措施']],
];

const CANNED_EXPANSION: readonly string[] = ['为什么重要', '怎么做', '如何衡量'];

export interface PlannedTopic {
  parentId: string;
  topic: Topic;
}

/** A fixed outline for `prompt`, as the ordered list of insertions a streaming build would emit. */
export function mockGenerate(prompt: string): { root: Topic; steps: PlannedTopic[] } {
  const root = topic(prompt.trim(), [], { id: nextId('root') });
  const steps: PlannedTopic[] = [];
  for (const [title, children] of CANNED_BRANCHES) {
    const branch = topic(title, []);
    steps.push({ parentId: root.id, topic: branch });
    for (const child of children) steps.push({ parentId: branch.id, topic: topic(child, []) });
  }
  return { root, steps };
}

export function mockExpand(parentId: string): PlannedTopic[] {
  return CANNED_EXPANSION.map((title) => ({ parentId, topic: topic(title, []) }));
}
