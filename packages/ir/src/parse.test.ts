import { describe, expect, it } from 'vitest';
import { parseDiagram } from './parse';
import { DiagramSchema } from './schema';
import { diagram, edge, node } from './testing/builders';
import { orderPlatform } from './testing/order-platform';

describe('parseDiagram', () => {
  it('parses a valid document exactly like DiagramSchema', () => {
    const json = JSON.parse(JSON.stringify(orderPlatform()));
    expect(parseDiagram(json)).toEqual(DiagramSchema.parse(json));
  });

  it('keeps unknown diagram types (open label) but downgrades unknown node / edge types', () => {
    const json = JSON.parse(
      JSON.stringify(
        diagram({
          nodes: [node('a', 'A'), node('b', 'B')],
          edges: [edge('e1', 'a', 'b')],
        }),
      ),
    );
    json.type = 'swimlane';
    json.nodes[0].type = 'blob';
    json.edges[0].type = 'wire';

    const parsed = parseDiagram(json);
    expect(parsed.type).toBe('swimlane');
    expect(parsed.nodes[0]?.type).toBe('box');
    expect(parsed.edges[0]?.type).toBe('link');
  });

  it('keeps line nodes (a type this client knows) intact', () => {
    const json = JSON.parse(
      JSON.stringify(
        diagram({ nodes: [node('axis', '', { type: 'line', data: { arrow: 'end' } })] }),
      ),
    );
    expect(parseDiagram(json).nodes[0]).toMatchObject({ type: 'line', data: { arrow: 'end' } });
  });

  it('still rejects a diagram type that is not a slug', () => {
    const json = { ...JSON.parse(JSON.stringify(orderPlatform())), type: 'Order Platform' };
    expect(() => parseDiagram(json)).toThrow();
  });

  it('rejects documents with an unsupported schema version', () => {
    const json = { ...JSON.parse(JSON.stringify(orderPlatform())), schema: 'nivik.diagram/0' };
    expect(() => parseDiagram(json)).toThrow(/schema/i);
  });

  it('still rejects structurally broken documents', () => {
    const json = JSON.parse(
      JSON.stringify(diagram({ nodes: [node('a', 'A')], edges: [edge('e1', 'a', 'ghost')] })),
    );
    expect(() => parseDiagram(json)).toThrow();
  });
});
