import {
  DIAGRAM_FAMILIES,
  EdgeTypeSchema,
  EmphasisSchema,
  FillStyleSchema,
  GroupRoleSchema,
  LayoutSpecSchema,
  MessageDataSchema,
  NodeTypeSchema,
  PaletteSchema,
  ParticipantDataSchema,
  ROLE_VOCABULARY,
  StateDataSchema,
  StrokeStyleSchema,
} from '@nivik/ir';

const list = (values: readonly string[]) => values.join(', ');

/**
 * Spec 05 §4.3 item 2: the IR vocabulary the model may use, generated from the schemas so the
 * prompt can never drift from what `applyActions` accepts (D15: constraints live at the highest
 * layer that can hold them; here the prompt merely repeats the type layer).
 */
export function vocabularySection(): string {
  const layout = LayoutSpecSchema.shape;
  const participantKinds = ParticipantDataSchema.shape.kind.options;
  const messageKinds = MessageDataSchema.shape.kind.options;
  const stateKinds = StateDataSchema.shape.kind.options;
  const families = (Object.keys(DIAGRAM_FAMILIES) as (keyof typeof DIAGRAM_FAMILIES)[])
    .map((family) => `  - ${family}: ${list(DIAGRAM_FAMILIES[family])}`)
    .join('\n');

  return [
    '## Vocabulary',
    `Node types: ${list(NodeTypeSchema.options)}.`,
    '  Prefer box / rounded / ellipse / diamond / text / line; use the richer ones (cylinder, hexagon, entity, participant, state, class, note, image) only when the meaning is unmistakable.',
    `  participant needs data.kind ∈ {${list(participantKinds)}}; state needs data.kind ∈ {${list(stateKinds)}}; entity needs data.columns [{ name, type?, pk?, fk? }].`,
    `Edge types: ${list(EdgeTypeSchema.options)}.`,
    `  message needs data { kind ∈ {${list(messageKinds)}}, order (integer, increasing along the timeline) }.`,
    `Group roles: ${list(GroupRoleSchema.options)}.`,
    `Suggested node roles (free text, ≤ 32 chars; these are common): ${list(ROLE_VOCABULARY)}.`,
    `Style tokens only — palette ∈ {${list(PaletteSchema.options)}}, emphasis ∈ {${list(EmphasisSchema.options)}}, stroke ∈ {${list(StrokeStyleSchema.options)}}, fill ∈ {${list(FillStyleSchema.options)}}. Never raw colours.`,
    `Layout: algorithm ∈ {${list(layout.algorithm.unwrap().options)}}, direction ∈ {${list(layout.direction.unwrap().options)}}.`,
    'Diagram type is an open lowercase-hyphen label; well-known values by arrangement family (you may pick any other name that fits):',
    families,
    'Ids: lowercase slugs (a–z, 0–9, -, _), unique per diagram; refer to existing elements by the ids in the Readout.',
  ].join('\n');
}
