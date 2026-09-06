import { DIAGRAM_SCHEMA_VERSION, type Diagram, DiagramSchema } from './schema/diagram';
import { DiagramTypeSchema, EdgeTypeSchema, NodeTypeSchema } from './schema/enums';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * Enum values added by newer clients degrade to the generic fallback instead of failing the parse
 * (spec 01 §9). Non-string values are left alone so Zod reports them.
 */
function downgrade<T extends string>(value: unknown, options: readonly T[], fallback: T): unknown {
  return typeof value === 'string' && !options.includes(value as T) ? fallback : value;
}

function downgradeElements(list: unknown, options: readonly string[], fallback: string): unknown {
  if (!Array.isArray(list)) return list;
  return list.map((element) =>
    isRecord(element) ? { ...element, type: downgrade(element.type, options, fallback) } : element,
  );
}

/** `DiagramSchema.parse` plus forward-compatibility handling for persisted / imported documents. */
export function parseDiagram(json: unknown): Diagram {
  if (!isRecord(json)) throw new Error('Diagram document must be an object');
  if (json.schema !== DIAGRAM_SCHEMA_VERSION) {
    throw new Error(
      `Unsupported diagram schema ${JSON.stringify(json.schema)}; expected "${DIAGRAM_SCHEMA_VERSION}"`,
    );
  }
  return DiagramSchema.parse({
    ...json,
    type: downgrade(json.type, DiagramTypeSchema.options, 'generic'),
    nodes: downgradeElements(json.nodes, NodeTypeSchema.options, 'box'),
    edges: downgradeElements(json.edges, EdgeTypeSchema.options, 'link'),
  });
}
