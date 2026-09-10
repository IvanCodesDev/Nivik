import 'fake-indexeddb/auto';
import { DiagramSchema } from '@nivik/ir';
import { DiagramRepository, NivikDB } from '@nivik/storage';
import { TEMPLATES } from '@nivik/templates';
import { describe, expect, it } from 'vitest';
import { createFromTemplate } from './template-actions';

let counter = 0;

describe('createFromTemplate (spec 06 §5)', () => {
  it('stores a copy of the template document as a new diagram with an import snapshot', async () => {
    const repo = new DiagramRepository(new NivikDB(`template-actions-${++counter}`));
    const entry = TEMPLATES[0];
    if (!entry) throw new Error('no templates');

    const record = await createFromTemplate(repo, entry.id, {
      renderer: 'drawio',
      now: () => 4242,
    });

    expect(record.id).not.toBe(entry.diagram.id);
    expect(record.id.startsWith('d_')).toBe(true);
    expect(record.name).toBe(entry.diagram.name);
    expect(record.type).toBe(entry.diagram.type);
    expect(record.version).toBe(1);
    expect(DiagramSchema.safeParse(record.ir).success).toBe(true);
    expect(record.ir.nodes.map((n) => n.id)).toEqual(entry.diagram.nodes.map((n) => n.id));
    expect(
      record.ir.nodes.every((n) => n.meta.createdBy === 'import' && n.meta.createdAt === 4242),
    ).toBe(true);
    expect(record.ir.renderer).toEqual({ preferred: 'drawio', state: {} });
    expect(record.ir.meta).toEqual({ createdAt: 4242, updatedAt: 4242 });

    const versions = await repo.listVersions(record.id);
    expect(versions.map((v) => [v.version, v.reason])).toEqual([[1, 'import']]);
    // The catalogue itself is untouched.
    expect(entry.diagram.version).not.toBe(0);
    expect(entry.diagram.nodes[0]?.meta.createdAt).not.toBe(4242);
  });

  it('keeps the template renderer when none is chosen and rejects unknown templates', async () => {
    const repo = new DiagramRepository(new NivikDB(`template-actions-${++counter}`));
    const entry = TEMPLATES[1];
    if (!entry) throw new Error('no templates');
    const record = await createFromTemplate(repo, entry.id);
    expect(record.ir.renderer.preferred).toBe(entry.diagram.renderer.preferred);
    await expect(createFromTemplate(repo, 'nope')).rejects.toThrow(/Unknown template/);
  });
});
