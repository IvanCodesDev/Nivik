import {
  DIAGRAM_FAMILIES,
  EdgeTypeSchema,
  GroupRoleSchema,
  NodeTypeSchema,
  PaletteSchema,
  ROLE_VOCABULARY,
} from '@nivik/ir';
import { type Plan, PlanSchema, RunCapabilitiesSchema } from '@nivik/protocol';
import { describe, expect, it } from 'vitest';
import { TOOL_NAMES } from '../tools/registry';
import { GRID_SNIPPET, HINT_PACKS, hintsFor } from './hints';
import { buildSystemPrompt } from './system';
import { vocabularySection } from './vocabulary';

const plan = (over: Partial<Plan> = {}): Plan =>
  PlanSchema.parse({
    intent: 'generate',
    diagramType: 'architecture',
    scope: { kind: 'all' },
    summary: 's',
    steps: ['a'],
    layout: {},
    estimatedNodes: 5,
    ...over,
  });

const caps = (over: Partial<{ runtimeTools: boolean; ask: boolean }> = {}) =>
  RunCapabilitiesSchema.parse(over);

describe('vocabularySection (spec 05 §4.3 item 2, generated from the schemas)', () => {
  const text = vocabularySection();

  it('names every node type, edge type, group role, palette and suggested role', () => {
    for (const v of NodeTypeSchema.options) expect(text).toContain(v);
    for (const v of EdgeTypeSchema.options) expect(text).toContain(v);
    for (const v of GroupRoleSchema.options) expect(text).toContain(v);
    for (const v of PaletteSchema.options) expect(text).toContain(v);
    for (const v of ROLE_VOCABULARY) expect(text).toContain(v);
  });

  it('lists the well-known diagram types by family and keeps the type open', () => {
    for (const [family, types] of Object.entries(DIAGRAM_FAMILIES)) {
      expect(text).toContain(`- ${family}: `);
      for (const t of types) expect(text).toContain(t);
    }
    expect(text).toMatch(/any other name that fits/);
  });

  it('spells out the data requirements that applyActions enforces', () => {
    expect(text).toContain('participant needs data.kind');
    expect(text).toContain('message needs data { kind');
    expect(text).toContain('Never raw colours');
  });
});

describe('hintsFor (D16 packs + grid snippet)', () => {
  it('returns nothing for an unknown type with a non-grid layout', () => {
    expect(hintsFor('my-own-thing', 'layered')).toEqual([]);
    expect(hintsFor(null, null)).toEqual([]);
  });

  it('returns the pack for a well-known type and the grid snippet for the grid strategy', () => {
    expect(hintsFor('sequence', 'sequence')).toEqual([HINT_PACKS.sequence]);
    expect(hintsFor('swot', 'grid')).toEqual([HINT_PACKS.swot, GRID_SNIPPET]);
    expect(hintsFor('matrix', 'grid')).toEqual([GRID_SNIPPET]);
  });

  it('keeps every pack short (≤ ~600 tokens)', () => {
    for (const pack of Object.values(HINT_PACKS)) expect(pack.length).toBeLessThan(2_400);
  });
});

describe('buildSystemPrompt (spec 05 §4.3)', () => {
  it('has the six sections and lists the registered tools', () => {
    const text = buildSystemPrompt({ tools: TOOL_NAMES, capabilities: caps(), plan: null });
    for (const heading of [
      '## How you work',
      '## Vocabulary',
      '## Rules',
      '## Tools',
      '## Example exchange',
    ]) {
      expect(text).toContain(heading);
    }
    expect(text).toContain(`## Tools\n${TOOL_NAMES.join(', ')}`);
    expect(text).toContain('call finish immediately');
    expect(text).not.toContain('## Hints');
  });

  it('grows hint packs once the plan names a well-known type or the grid strategy', () => {
    const before = buildSystemPrompt({ tools: TOOL_NAMES, capabilities: caps(), plan: null });
    const after = buildSystemPrompt({
      tools: TOOL_NAMES,
      capabilities: caps(),
      plan: plan({ diagramType: 'swot', layout: { algorithm: 'grid' } }),
    });
    expect(before).not.toContain('## Grid placement');
    expect(after).toContain('## Hints: SWOT');
    expect(after).toContain('## Grid placement');
    expect(after.indexOf('## Rules')).toBeLessThan(after.indexOf('## Hints: SWOT'));
    expect(after.indexOf('## Hints: SWOT')).toBeLessThan(after.indexOf('## Example exchange'));
  });

  it('tells the model what this run cannot do', () => {
    const noAsk = buildSystemPrompt({
      tools: TOOL_NAMES.filter((t) => t !== 'ask'),
      capabilities: caps({ ask: false }),
      plan: null,
    });
    expect(noAsk).toContain('You cannot ask the person questions in this run');
    expect(noAsk).toContain('no access to repositories or the web');
    const full = buildSystemPrompt({
      tools: TOOL_NAMES,
      capabilities: caps({ runtimeTools: true }),
      plan: null,
    });
    expect(full).not.toContain('## This run');
  });
});
