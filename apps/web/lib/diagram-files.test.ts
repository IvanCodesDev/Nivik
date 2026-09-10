import { DiagramSchema } from '@nivik/ir';
import { orderPlatformLaidOut } from '@nivik/ir/testing';
import { serializeScene } from '@nivik/renderer-excalidraw';
import { excalidrawElement as el } from '@nivik/renderer-excalidraw/testing';
import { describe, expect, it, vi } from 'vitest';
import {
  DiagramFileError,
  detectFormat,
  exportDiagramFile,
  fileSlug,
  importDiagramFile,
  parseNivik,
  serializeNivik,
} from './diagram-files';

// `exportDocument` pulls the Excalidraw browser bundle in; the file module only forwards to it.
vi.mock('@nivik/renderer-excalidraw', async (importOriginal) => {
  const original = await importOriginal<typeof import('@nivik/renderer-excalidraw')>();
  return {
    ...original,
    exportDocument: vi.fn(async (d: Parameters<typeof original.toExcalidraw>[0]) => {
      const { elements, fidelity } = original.toExcalidraw(d);
      return {
        blob: new Blob([original.serializeScene(elements as never)], { type: 'application/json' }),
        filename: `${d.name}.excalidraw`,
        mime: 'application/json',
        fidelity,
      };
    }),
  };
});

const file = (name: string, text: string) => ({ name, text: async () => text });

describe('detectFormat', () => {
  it('trusts the extension and sniffs bare .json', () => {
    expect(detectFormat('Order.nivik.json')).toBe('nivik');
    expect(detectFormat('scene.EXCALIDRAW')).toBe('excalidraw');
    expect(detectFormat('a.json')).toBeNull();
    expect(detectFormat('a.json', '{"schema":"nivik.diagram/1"}')).toBe('nivik');
    expect(detectFormat('a.json', '{"type":"excalidraw","elements":[]}')).toBe('excalidraw');
    expect(detectFormat('a.json', '{"type":"excalidraw"}')).toBeNull();
    expect(detectFormat('a.json', 'not json')).toBeNull();
    expect(detectFormat('a.txt', '[]')).toBeNull();
  });
});

describe('fileSlug', () => {
  it('keeps any script, folds whitespace and drops path characters', () => {
    expect(fileSlug('  Order  platform / v2 ')).toBe('Order-platform-v2');
    expect(fileSlug('登录流程: 第一版')).toBe('登录流程-第一版');
    expect(fileSlug('???')).toBe('diagram');
    expect(fileSlug('a'.repeat(100))).toHaveLength(80);
  });
});

describe('.nivik.json round trip (spec 06 §4)', () => {
  it('exports the validated document and imports it as a new diagram', async () => {
    const source = { ...orderPlatformLaidOut(), version: 9 };
    const exported = await exportDiagramFile(source, 'nivik');
    expect(exported.filename).toBe(`${fileSlug(source.name)}.nivik.json`);
    expect(exported.fidelity).toBeNull();
    const text = await exported.blob.text();
    expect(JSON.parse(text)).toEqual(DiagramSchema.parse(source));

    const imported = await importDiagramFile(file('order.nivik.json', text), { now: 5 });
    expect(imported.format).toBe('nivik');
    expect(imported.fidelity).toBeNull();
    expect(imported.diagram.id).not.toBe(source.id);
    expect(imported.diagram.version).toBe(1);
    expect(imported.diagram.meta).toEqual({ createdAt: 5, updatedAt: 5 });
    expect(imported.diagram.nodes).toEqual(source.nodes);
    expect(imported.diagram.edges).toEqual(source.edges);
    expect(imported.diagram.renderer).toEqual(source.renderer);
  });

  it('rejects broken or foreign JSON with a clear code', () => {
    expect(() => parseNivik('{')).toThrow(DiagramFileError);
    expect(() => parseNivik('{"schema":"nivik.diagram/0"}')).toThrow(/Unsupported diagram schema/);
    try {
      parseNivik('{"schema":"nivik.diagram/1","nodes":"nope"}');
    } catch (error) {
      expect(error).toBeInstanceOf(DiagramFileError);
      expect((error as DiagramFileError).code).toBe('E_INVALID_NIVIK');
    }
    expect(serializeNivik(orderPlatformLaidOut())).toContain('"schema": "nivik.diagram/1"');
  });
});

describe('.excalidraw', () => {
  it('imports a hand-drawn scene as a diagram named after the file and reports fidelity', async () => {
    const scene = serializeScene([
      el('rectangle', { id: 'r1', x: 0, y: 0, boundElements: [{ id: 't1', type: 'text' }] }),
      el('text', { id: 't1', x: 0, y: 0, originalText: 'Web', containerId: 'r1' }),
      el('ellipse', { id: 'r2', x: 300, y: 0, boundElements: [{ id: 't2', type: 'text' }] }),
      el('text', { id: 't2', x: 0, y: 0, originalText: 'API', containerId: 'r2' }),
      el('arrow', {
        id: 'ar',
        x: 120,
        y: 28,
        startBinding: { elementId: 'r1', focus: 0, gap: 0 },
        endBinding: { elementId: 'r2', focus: 0, gap: 0 },
      }),
      el('freedraw', { id: 'doodle', x: 900, y: 900 }),
    ]);

    const imported = await importDiagramFile(file('Order platform.excalidraw', scene));
    expect(imported.format).toBe('excalidraw');
    expect(imported.diagram.name).toBe('Order platform');
    expect(imported.diagram.nodes.map((n) => n.label)).toEqual(['Web', 'API']);
    expect(imported.diagram.edges).toHaveLength(1);
    expect(imported.fidelity?.lossless).toBe(false);
    expect(DiagramSchema.safeParse(imported.diagram).success).toBe(true);
  });

  it('exports through the adapter with the slug filename', async () => {
    const exported = await exportDiagramFile(orderPlatformLaidOut(), 'excalidraw');
    expect(exported.filename).toMatch(/\.excalidraw$/);
    expect(JSON.parse(await exported.blob.text())).toMatchObject({ type: 'excalidraw' });
    expect(exported.fidelity?.lossless).toBeDefined();
  });

  it('names the failure modes', async () => {
    await expect(
      importDiagramFile(file('x.excalidraw', '{"type":"excalidraw"}')),
    ).rejects.toMatchObject({
      code: 'E_INVALID_EXCALIDRAW',
    });
    await expect(importDiagramFile(file('x.csv', 'a,b'))).rejects.toMatchObject({
      code: 'E_UNKNOWN_FORMAT',
    });
  });
});
