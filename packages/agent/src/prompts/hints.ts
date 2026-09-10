/**
 * Spec 05 §4.3 item 4 (D16): optional hint packs, injected only when the plan's diagram type hits
 * a well-known value. Anything outside gets nothing — the model draws from its own knowledge; the
 * packs make common diagrams steadier, they do not decide what can be drawn. Each pack ≤ ~600 tokens.
 */
export const HINT_PACKS: Readonly<Record<string, string>> = {
  sequence: [
    '## Hints: sequence diagram',
    '- Every participant is a node of type participant with data.kind (actor / system / database / external); order them left to right in the order they are added.',
    '- Every interaction is an edge of type message with data.kind (sync / async / return) and data.order increasing along the timeline; label = the message.',
    '- No groups for lifelines — the renderer draws them. Use a group with role "boundary" only for fragments (loop / alt) around a run of messages.',
    '- Layout algorithm is sequence; do not set cells.',
  ].join('\n'),
  swot: [
    '## Hints: SWOT',
    '- A 2×2 grid: four groups with role "frame" at cells (0,0) Strengths, (1,0) Weaknesses, (0,1) Opportunities, (1,1) Threats.',
    '- Each point is a text or box node inside its quadrant group; give each node a cell inside the group (col 0, rows increasing).',
    '- No edges. Layout algorithm is grid.',
  ].join('\n'),
  kanban: [
    '## Hints: kanban board',
    '- One group per column with role "lane", cells (0,0), (1,0), (2,0)… across; labels are the stages (e.g. Backlog, In progress, Review, Done).',
    '- Each card is a rounded node inside its column group with a cell (col 0, row increasing from 0).',
    '- Edges are rare (blocked-by); leave them out unless asked. Layout algorithm is grid.',
  ].join('\n'),
};

/** Spec 05 §4.3 / 03 §7.2: the cell syntax, injected whenever the plan chose the grid strategy. */
export const GRID_SNIPPET = [
  '## Grid placement',
  'This diagram uses the grid strategy: position carries meaning, so you place elements yourself with cell.',
  '- cell = { col, row, colSpan?, rowSpan? }; col / row start at 0; spans default to 1.',
  '- A group with a cell defines a region; its members use cells relative to that group.',
  '- Elements sharing a parent must not overlap; a line spanning a row (timeline axis) takes colSpan across all columns.',
  '- Pixel positions are still computed by the system from the cells; never guess coordinates.',
].join('\n');

export function hintsFor(diagramType: string | null, layoutAlgorithm: string | null): string[] {
  const parts: string[] = [];
  if (diagramType && HINT_PACKS[diagramType]) parts.push(HINT_PACKS[diagramType] as string);
  if (layoutAlgorithm === 'grid') parts.push(GRID_SNIPPET);
  return parts;
}
