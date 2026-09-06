import { z } from 'zod';
import { IdSchema } from '../ids';
import type { EdgeType, NodeType } from './enums';

/** Per-type `data` contracts (spec 01 §4.4). Node/edge types without an entry accept free-form data. */

export const EntityColumnSchema = z
  .object({
    name: z.string().min(1).max(64),
    type: z.string().max(64).optional(),
    pk: z.boolean().optional(),
    fk: IdSchema.optional(),
    nullable: z.boolean().optional(),
  })
  .strict();
export const EntityDataSchema = z.object({ columns: z.array(EntityColumnSchema) }).strict();
export type EntityData = z.infer<typeof EntityDataSchema>;

export const ParticipantDataSchema = z
  .object({
    kind: z.enum(['actor', 'system', 'database', 'external']),
    order: z.number().int().optional(),
  })
  .strict();
export type ParticipantData = z.infer<typeof ParticipantDataSchema>;

export const StateDataSchema = z
  .object({ kind: z.enum(['initial', 'final', 'normal', 'choice']) })
  .strict();
export type StateData = z.infer<typeof StateDataSchema>;

export const ClassDataSchema = z
  .object({
    attributes: z.array(z.string().max(200)),
    methods: z.array(z.string().max(200)),
    stereotype: z.string().max(64).optional(),
  })
  .strict();
export type ClassData = z.infer<typeof ClassDataSchema>;

export const ImageDataSchema = z
  .object({ src: z.string().min(1), alt: z.string().max(200).optional() })
  .strict();
export type ImageData = z.infer<typeof ImageDataSchema>;

export const MessageDataSchema = z
  .object({
    order: z.number().int().nonnegative(),
    kind: z.enum(['sync', 'async', 'return']),
    activation: z.boolean().optional(),
  })
  .strict();
export type MessageData = z.infer<typeof MessageDataSchema>;

export const RelationDataSchema = z
  .object({
    cardinality: z.enum(['1-1', '1-n', 'n-1', 'n-n']),
    identifying: z.boolean().optional(),
  })
  .strict();
export type RelationData = z.infer<typeof RelationDataSchema>;

export const TransitionDataSchema = z
  .object({
    trigger: z.string().max(200).optional(),
    guard: z.string().max(200).optional(),
    effect: z.string().max(200).optional(),
  })
  .strict();
export type TransitionData = z.infer<typeof TransitionDataSchema>;

export const NODE_DATA_SCHEMAS: Partial<Record<NodeType, z.ZodType>> = {
  entity: EntityDataSchema,
  participant: ParticipantDataSchema,
  state: StateDataSchema,
  class: ClassDataSchema,
  image: ImageDataSchema,
};

export const EDGE_DATA_SCHEMAS: Partial<Record<EdgeType, z.ZodType>> = {
  message: MessageDataSchema,
  relation: RelationDataSchema,
  transition: TransitionDataSchema,
};

/** Validates `data` against the contract for `type` (if any), reporting issues under the `data` path. */
export function refineTypedData(
  schemas: Partial<Record<string, z.ZodType>>,
  element: { type: string; data?: Record<string, unknown> | undefined },
  ctx: z.RefinementCtx,
): void {
  const schema = schemas[element.type];
  if (!schema) return;
  const result = schema.safeParse(element.data ?? {});
  if (result.success) return;
  for (const issue of result.error.issues) {
    ctx.addIssue({
      code: 'custom',
      message: issue.message,
      path: ['data', ...issue.path],
      params: { code: issue.code },
    });
  }
}
