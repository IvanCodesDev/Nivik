import { describe, expect, it } from 'vitest';
import {
  ID_PATTERN,
  IdSchema,
  isId,
  newChangeSetId,
  newDiagramId,
  newEdgeId,
  newGroupId,
  newNodeId,
  newRunId,
  newVersionId,
} from './ids';

describe('ID_PATTERN / IdSchema', () => {
  it('accepts lowercase slugs, digits, underscore and dash up to 64 chars', () => {
    for (const id of ['a', 'n_ab12cd34', 'api-gateway', 'order_db', '7up', 'a'.repeat(64)]) {
      expect(ID_PATTERN.test(id)).toBe(true);
      expect(IdSchema.safeParse(id).success).toBe(true);
      expect(isId(id)).toBe(true);
    }
  });

  it('rejects uppercase, spaces, leading punctuation, empty and overlong ids', () => {
    for (const id of ['', 'A', 'Api', 'with space', '-lead', '_lead', 'a'.repeat(65), 'ünïcode']) {
      expect(ID_PATTERN.test(id)).toBe(false);
      expect(IdSchema.safeParse(id).success).toBe(false);
      expect(isId(id)).toBe(false);
    }
  });
});

describe('id generators', () => {
  it.each([
    ['newNodeId', newNodeId, 'n_'],
    ['newEdgeId', newEdgeId, 'e_'],
    ['newGroupId', newGroupId, 'g_'],
    ['newDiagramId', newDiagramId, 'd_'],
  ] as const)('%s yields a valid element id with the %s prefix', (_name, make, prefix) => {
    const id = make();
    expect(id.startsWith(prefix)).toBe(true);
    expect(id).toHaveLength(prefix.length + 8);
    expect(ID_PATTERN.test(id)).toBe(true);
  });

  it.each([
    ['newChangeSetId', newChangeSetId, 'cs_'],
    ['newRunId', newRunId, 'run_'],
    ['newVersionId', newVersionId, 'v_'],
  ] as const)('%s yields a lowercase alphanumeric id with the %s prefix', (_name, make, prefix) => {
    const id = make();
    expect(id.startsWith(prefix)).toBe(true);
    expect(id.slice(prefix.length)).toMatch(/^[0-9a-z]{8}$/);
  });

  it('does not repeat across many draws', () => {
    const ids = new Set(Array.from({ length: 2000 }, () => newNodeId()));
    expect(ids.size).toBe(2000);
  });
});
