import { TEMPLATES as CATALOG } from '@nivik/templates';
import { describe, expect, it } from 'vitest';
import {
  COMING_SOON_CATEGORIES,
  findTemplate,
  TEMPLATE_CATEGORIES,
  TEMPLATES,
  templateNodeNames,
  templatePrompt,
} from './templates';

const get = (id: string) => {
  const t = findTemplate(id);
  if (!t) throw new Error(`template ${id} missing`);
  return t;
};

describe('built-in templates', () => {
  it('mirror the @nivik/templates catalog in order', () => {
    expect(TEMPLATES.map((t) => t.id)).toEqual(CATALOG.map((t) => t.id));
    for (const t of TEMPLATES) {
      const entry = CATALOG.find((c) => c.id === t.id);
      expect(t.title).toBe(entry?.title);
      expect(t.description).toBe(entry?.description);
      expect(t.category).toBe(entry?.category);
      expect(t.wash).toBe(entry?.wash);
      expect(t.width).toBe(entry?.preview.width);
      expect(t.height).toBe(entry?.preview.height);
      expect(t.diagram).toBe(entry?.diagram);
    }
  });

  it('have unique ids', () => {
    const ids = TEMPLATES.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('only reference nodes that exist', () => {
    for (const template of TEMPLATES) {
      expect(template.edges).toHaveLength(template.diagram.edges.length);
      for (const edge of template.edges) {
        expect(edge.from, `${template.id} edge.from`).toBeGreaterThanOrEqual(0);
        expect(edge.from, `${template.id} edge.from`).toBeLessThan(template.nodes.length);
        expect(edge.to, `${template.id} edge.to`).toBeGreaterThanOrEqual(0);
        expect(edge.to, `${template.id} edge.to`).toBeLessThan(template.nodes.length);
      }
    }
  });

  it('keep every node inside the preview viewport', () => {
    for (const template of TEMPLATES) {
      const width = template.width ?? 500;
      for (const node of template.nodes) {
        expect(node.x + node.w, `${template.id} ${node.label}`).toBeLessThanOrEqual(width);
        expect(node.y + node.h, `${template.id} ${node.label}`).toBeLessThanOrEqual(
          template.height,
        );
      }
    }
  });

  it('use known categories and mark only empty ones as coming soon', () => {
    const used = new Set(TEMPLATES.map((t) => t.category));
    for (const category of used) expect(TEMPLATE_CATEGORIES).toContain(category);
    for (const category of COMING_SOON_CATEGORIES) expect(used.has(category)).toBe(false);
  });

  it('feature exactly one template', () => {
    expect(TEMPLATES.filter((t) => t.featured).map((t) => t.id)).toEqual(['microservices']);
  });
});

describe('gallery projection', () => {
  it('maps IR geometry back to card pixels', () => {
    const auth = get('authentication');
    expect(auth.nodes[0]).toEqual({ label: 'Start', x: 160, y: 10, w: 95, h: 30, tone: 'mint' });
    expect(auth.nodes[1]).toEqual({ label: 'Enter credentials', x: 135, y: 68, w: 145, h: 35 });
    expect(auth.nodes[2]).toMatchObject({
      label: 'Valid user?',
      shape: 'diamond',
      tone: 'decision',
      x: 137,
      y: 139,
      w: 142,
      h: 58,
    });
    expect(auth.edges).toEqual([
      { from: 0, to: 1 },
      { from: 1, to: 2 },
      { from: 2, to: 3, label: 'No' },
      { from: 2, to: 4, label: 'Yes' },
      { from: 4, to: 5 },
      { from: 5, to: 6 },
      { from: 3, to: 1 },
    ]);
  });

  it('renders ERD entities as the legacy multi-line label', () => {
    const erd = get('database');
    expect(erd.nodes.map((n) => n.label)).toEqual([
      'users\nid (PK)\nname\nemail\ncreated_at',
      'orders\nid (PK)\nuser_id (FK)\nstatus\ncreated_at',
      'order_items\nid (PK)\norder_id (FK)\nproduct_id (FK)\nquantity',
      'products\nid (PK)\nname\nprice\nstock',
    ]);
    expect(erd.edges).toEqual([
      { from: 0, to: 1 },
      { from: 1, to: 2 },
      { from: 2, to: 3 },
    ]);
  });

  it('keeps multi-line labels and the wide pipeline card', () => {
    const pipeline = get('pipeline');
    expect(pipeline.width).toBe(600);
    expect(pipeline.nodes[3]?.label).toBe('Deploy to\nStaging');
    expect(pipeline.nodes[4]).toMatchObject({ shape: 'diamond', tone: 'decision' });
  });
});

describe('templatePrompt', () => {
  it('chains the first five steps for a manual start', () => {
    expect(templatePrompt(get('pipeline'), false)).toBe(
      'Code Commit → Build → Test → Deploy to → Tests Pass?',
    );
    expect(templatePrompt(get('authentication'), false)).toBe(
      'Start → Enter credentials → Valid user? → Show error → Create session',
    );
  });

  it('describes the full structure for AI generation', () => {
    expect(templatePrompt(get('pipeline'), true)).toBe(
      'Build CI/CD Pipeline using this structure: Code Commit, Build, Test, Deploy to, Tests Pass?, Production',
    );
    expect(templateNodeNames(get('network'))).toEqual([
      'Internet',
      'Firewall',
      'Public Subnet',
      'Private Subnet',
      'DB Subnet',
    ]);
  });

  it('returns undefined for unknown ids', () => {
    expect(findTemplate('nope')).toBeUndefined();
    expect(findTemplate(null)).toBeUndefined();
    expect(findTemplate(undefined)).toBeUndefined();
  });
});
