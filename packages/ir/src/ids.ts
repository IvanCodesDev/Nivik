import { customAlphabet } from 'nanoid';
import { z } from 'zod';

/** Element ids: lowercase slug, 1–64 chars, first char alphanumeric. Shared by nodes, edges and groups. */
export const ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/;

export const IdSchema = z.string().regex(ID_PATTERN, 'Invalid id');
export type Id = z.infer<typeof IdSchema>;

export const isId = (value: unknown): value is Id =>
  typeof value === 'string' && ID_PATTERN.test(value);

const alphabet = customAlphabet('0123456789abcdefghijklmnopqrstuvwxyz', 8);

export const newNodeId = (): Id => `n_${alphabet()}`;
export const newEdgeId = (): Id => `e_${alphabet()}`;
export const newGroupId = (): Id => `g_${alphabet()}`;
export const newDiagramId = (): Id => `d_${alphabet()}`;

// Non-element identifiers (not constrained by ID_PATTERN, but the same lowercase alphabet).
export const newChangeSetId = (): string => `cs_${alphabet()}`;
export const newRunId = (): string => `run_${alphabet()}`;
export const newVersionId = (): string => `v_${alphabet()}`;
