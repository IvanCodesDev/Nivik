import { describe, expect, it } from 'vitest';
import { parseScene, serializeScene } from './file';
import { excalidrawElement as el } from './testing';

describe('.excalidraw file envelope', () => {
  it('round-trips elements and app state', () => {
    const text = serializeScene([el('rectangle', { id: 'a', x: 1, y: 2 })], {
      viewBackgroundColor: '#fafafa',
    });
    const parsed = JSON.parse(text);
    expect(parsed).toMatchObject({
      type: 'excalidraw',
      version: 2,
      source: 'https://nivik.app',
      appState: { viewBackgroundColor: '#fafafa' },
      files: {},
    });
    expect(parseScene(text).elements[0]).toMatchObject({ id: 'a', type: 'rectangle' });
  });
  it('rejects anything that is not an excalidraw scene', () => {
    expect(() => parseScene('{"type":"drawio"}')).toThrow(/excalidraw/);
    expect(() => parseScene('not json')).toThrow();
  });
});
