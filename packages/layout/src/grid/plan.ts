import { type Cell, cellsIntersect, type Diagram, type DiagramIndex, type Id } from '@nivik/ir';
import type { LayoutWarning } from '../types';

export interface GridPlan {
  /** Grid range of every element that occupies cells (explicit or auto-filled). */
  ranges: Map<Id, Cell>;
  /** Cell-less children per group that flow inside the group's box instead of taking cells. */
  stacked: Map<Id, Id[]>;
  cols: number;
  rows: number;
}

export const cellAt = (col: number, row: number, colSpan = 1, rowSpan = 1): Cell => ({
  col,
  row,
  colSpan,
  rowSpan,
});

export function unionCells(cells: readonly Cell[]): Cell | null {
  const first = cells[0];
  if (!first) return null;
  let c0 = first.col;
  let r0 = first.row;
  let c1 = first.col + first.colSpan;
  let r1 = first.row + first.rowSpan;
  for (const cell of cells.slice(1)) {
    c0 = Math.min(c0, cell.col);
    r0 = Math.min(r0, cell.row);
    c1 = Math.max(c1, cell.col + cell.colSpan);
    r1 = Math.max(r1, cell.row + cell.rowSpan);
  }
  return cellAt(c0, r0, c1 - c0, r1 - r0);
}

export const cellContains = (outer: Cell, inner: Cell): boolean =>
  inner.col >= outer.col &&
  inner.row >= outer.row &&
  inner.col + inner.colSpan <= outer.col + outer.colSpan &&
  inner.row + inner.rowSpan <= outer.row + outer.rowSpan;

const extent = (ranges: ReadonlyMap<Id, Cell>) => {
  let cols = 0;
  let rows = 0;
  for (const cell of ranges.values()) {
    cols = Math.max(cols, cell.col + cell.colSpan);
    rows = Math.max(rows, cell.row + cell.rowSpan);
  }
  return { cols, rows };
};

/** Free cells of `range` not covered by `taken`, column-major for tall ranges, row-major otherwise. */
function freeCells(range: Cell, taken: readonly Cell[]): Cell[] {
  const out: Cell[] = [];
  const columnMajor = range.rowSpan > range.colSpan;
  const outer = columnMajor ? range.colSpan : range.rowSpan;
  const inner = columnMajor ? range.rowSpan : range.colSpan;
  for (let a = 0; a < outer; a += 1) {
    for (let b = 0; b < inner; b += 1) {
      const cell = columnMajor
        ? cellAt(range.col + a, range.row + b)
        : cellAt(range.col + b, range.row + a);
      if (!taken.some((t) => cellsIntersect(t, cell))) out.push(cell);
    }
  }
  return out;
}

/**
 * Spec 03 §7.2 steps 1–2. `skip` holds pinned nodes (they keep their pixels, step 7). Cell-less
 * children of a group without any celled descendant flow inside the group's box (`stacked`); in a
 * mixed group they take the free cells, widening the group's short side when those run out.
 */
export function planCells(
  d: Diagram,
  index: DiagramIndex,
  skip: ReadonlySet<Id>,
  warnings: LayoutWarning[],
): GridPlan {
  const ranges = new Map<Id, Cell>();
  const stacked = new Map<Id, Id[]>();
  const hasCelledDescendant = new Map<Id, boolean>();

  for (const n of d.nodes) if (n.cell && !skip.has(n.id)) ranges.set(n.id, n.cell);

  const resolveGroup = (groupId: Id): Cell | null => {
    const childRanges: Cell[] = [];
    for (const childId of index.byParent.get(groupId) ?? []) {
      const range = index.groups.has(childId)
        ? resolveGroup(childId)
        : (ranges.get(childId) ?? null);
      if (range) childRanges.push(range);
    }
    hasCelledDescendant.set(groupId, childRanges.length > 0);
    const explicit = index.groups.get(groupId)?.cell ?? null;
    const union = unionCells(childRanges);
    let range = explicit ?? union;
    if (explicit && union && !cellContains(explicit, union)) {
      range = unionCells([explicit, union]);
      warnings.push({
        code: 'W_UNPLACED',
        ids: [groupId],
        message: `Group ${groupId}: children lie outside its cell range; the range was widened to contain them`,
      });
    }
    if (range) ranges.set(groupId, range);
    return range;
  };
  for (const group of d.groups) if (group.parent === null) resolveGroup(group.id);

  const widen = (groupId: Id, range: Cell) => {
    ranges.set(groupId, range);
    let parent = index.groups.get(groupId)?.parent ?? null;
    while (parent !== null) {
      const current = ranges.get(parent);
      if (!current || cellContains(current, range)) break;
      const merged = unionCells([current, range]);
      if (merged) ranges.set(parent, merged);
      parent = index.groups.get(parent)?.parent ?? null;
    }
  };

  const unitsOf = (parent: Id | null): Id[] =>
    (index.byParent.get(parent) ?? []).filter((id) => !ranges.has(id) && !skip.has(id));

  // Top level: rows appended below the explicit grid, at least ceil(sqrt(n)) wide — which is also
  // the legacy square for diagrams without any cell.
  const topUnits = unitsOf(null);
  if (topUnits.length > 0) {
    const { cols: used, rows: startRow } = extent(ranges);
    const cols = Math.max(used, Math.ceil(Math.sqrt(topUnits.length)));
    for (const [i, id] of topUnits.entries()) {
      ranges.set(id, cellAt(i % cols, startRow + Math.floor(i / cols)));
    }
  }

  const descendantRanges = (groupId: Id): Cell[] => {
    const out: Cell[] = [];
    for (const childId of index.byParent.get(groupId) ?? []) {
      const range = ranges.get(childId);
      if (range) out.push(range);
      if (index.groups.has(childId)) out.push(...descendantRanges(childId));
    }
    return out;
  };

  for (const group of d.groups) {
    const units = unitsOf(group.id);
    if (units.length === 0) continue;
    const range = ranges.get(group.id);
    if (!range || !hasCelledDescendant.get(group.id)) {
      stacked.set(group.id, units);
      continue;
    }
    const taken = descendantRanges(group.id);
    let current = range;
    let widened = false;
    let next = 0;
    while (next < units.length) {
      const free = freeCells(current, taken);
      if (free.length === 0) {
        current =
          current.rowSpan > current.colSpan
            ? cellAt(current.col, current.row, current.colSpan + 1, current.rowSpan)
            : cellAt(current.col, current.row, current.colSpan, current.rowSpan + 1);
        widened = true;
        continue;
      }
      for (const cell of free) {
        const id = units[next];
        if (id === undefined) break;
        ranges.set(id, cell);
        taken.push(cell);
        next += 1;
      }
    }
    if (widened) {
      widen(group.id, current);
      warnings.push({
        code: 'W_UNPLACED',
        ids: [group.id],
        message: `Group ${group.id}: more cell-less children than free cells; the range was widened`,
      });
    }
  }

  return { ranges, stacked, ...extent(ranges) };
}
