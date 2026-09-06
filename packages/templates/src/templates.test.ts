import { type Diagram, parseDiagram, validateDiagram } from '@nivik/ir';
import { describe, expect, it } from 'vitest';
import authentication from '../data/authentication.nivik.json';
import database from '../data/database.nivik.json';
import ecommerce from '../data/ecommerce.nivik.json';
import journey from '../data/journey.nivik.json';
import microservices from '../data/microservices.nivik.json';
import network from '../data/network.nivik.json';
import pipeline from '../data/pipeline.nivik.json';
import validation from '../data/validation.nivik.json';
import {
  COMING_SOON_CATEGORIES,
  findTemplate,
  instantiateTemplate,
  TEMPLATE_CATEGORIES,
  TEMPLATE_PREVIEW_SCALE,
  TEMPLATES,
} from './index';

/** The raw files as shipped, keyed by template id (mirrors `data/*.nivik.json`). */
const RAW: Record<string, unknown> = {
  microservices,
  authentication,
  validation,
  journey,
  ecommerce,
  database,
  pipeline,
  network,
};
const rawOf = (id: string) => {
  const raw = RAW[id];
  if (raw === undefined) throw new Error(`no data file imported for template "${id}"`);
  return raw;
};

/** Meta-free view of the graph so template and instance can be compared. */
const graphOf = (d: Diagram) => ({
  nodes: d.nodes.map(({ meta: _m, ...n }) => n),
  edges: d.edges.map(({ meta: _m, ...e }) => e),
  groups: d.groups.map(({ meta: _m, ...g }) => g),
});

describe('built-in template files', () => {
  it('ships the eight legacy templates, one file per catalog entry', () => {
    expect(TEMPLATES.map((t) => t.id).sort()).toEqual(Object.keys(RAW).sort());
    expect(TEMPLATES).toHaveLength(8);
    expect(new Set(TEMPLATES.map((t) => t.id)).size).toBe(8);
  });

  describe.each(TEMPLATES.map((t) => [t.id, t] as const))('%s', (id, entry) => {
    it('is a complete, fully-defaulted Diagram (parse is the identity)', () => {
      const raw = rawOf(id);
      const parsed = parseDiagram(raw);
      expect(parsed).toEqual(raw);
      expect(parsed).toEqual(entry.diagram);
      expect(parsed.id).toBe(`tpl_${id}`);
      expect(parsed.version).toBe(1);
      expect(parsed.name).toBe(entry.title);
      expect(parsed.description).toBe(entry.description);
    });

    it('validates with no errors and no quality warnings', () => {
      const result = validateDiagram(entry.diagram);
      expect(result.errors).toEqual([]);
      expect(result.warnings).toEqual([]);
    });

    it('places every node and group so it can be shown before a layout engine exists', () => {
      for (const n of entry.diagram.nodes) {
        expect(n.position, n.id).toBeDefined();
        expect(n.size, n.id).toBeDefined();
        expect(n.pinned).toBe(false);
      }
      for (const g of entry.diagram.groups) {
        expect(g.position, g.id).toBeDefined();
        expect(g.size, g.id).toBeDefined();
      }
      expect(entry.preview.width).toBeGreaterThan(0);
      expect(entry.preview.height).toBeGreaterThan(0);
      expect(TEMPLATE_PREVIEW_SCALE).toBe(2);
    });

    it('is attributed to the import origin at a fixed authoring time', () => {
      const { createdAt, updatedAt } = entry.diagram.meta;
      expect(updatedAt).toBe(createdAt);
      for (const el of [...entry.diagram.nodes, ...entry.diagram.edges, ...entry.diagram.groups]) {
        expect(el.meta).toEqual({ createdBy: 'import', createdAt, updatedAt: createdAt, rev: 0 });
      }
    });
  });
});

describe('catalog', () => {
  it('keeps the gallery vocabulary of the web app', () => {
    expect(TEMPLATE_CATEGORIES).toEqual([
      'Architecture',
      'Flowchart',
      'Business Flow',
      'Data Flow',
      'ERD',
      'Sequence',
      'System',
      'Mind Map',
    ]);
    expect(COMING_SOON_CATEGORIES).toEqual(['Mind Map']);
    for (const t of TEMPLATES) expect(TEMPLATE_CATEGORIES).toContain(t.category);
    expect(TEMPLATES.filter((t) => t.featured).map((t) => t.id)).toEqual(['microservices']);
  });

  it('finds templates by id and tolerates missing ids', () => {
    expect(findTemplate('authentication')?.title).toBe('User Authentication Flow');
    expect(findTemplate('nope')).toBeUndefined();
    expect(findTemplate(null)).toBeUndefined();
    expect(findTemplate(undefined)).toBeUndefined();
  });

  it('maps categories to matching diagram types', () => {
    const expected: Record<string, string> = {
      microservices: 'architecture',
      authentication: 'flow',
      validation: 'flow',
      journey: 'flow',
      ecommerce: 'architecture',
      database: 'erd',
      pipeline: 'flow',
      network: 'architecture',
    };
    for (const t of TEMPLATES) expect(t.diagram.type, t.id).toBe(expected[t.id]);
  });
});

describe('instantiateTemplate', () => {
  const entry = findTemplate('microservices');
  if (!entry) throw new Error('fixture missing');
  const NOW = 1_800_000_000_000;

  it('copies the graph under a fresh id at version 1, stamped with now', () => {
    const copy = instantiateTemplate(entry, { now: NOW });
    expect(copy.id).not.toBe(entry.diagram.id);
    expect(copy.id).toMatch(/^d_[a-z0-9]{8}$/);
    expect(copy.version).toBe(1);
    expect(copy.meta).toEqual({ createdAt: NOW, updatedAt: NOW });
    expect(graphOf(copy)).toEqual(graphOf(entry.diagram));
    for (const el of [...copy.nodes, ...copy.edges, ...copy.groups]) {
      expect(el.meta).toEqual({ createdBy: 'import', createdAt: NOW, updatedAt: NOW, rev: 0 });
    }
    expect(validateDiagram(copy).ok).toBe(true);
  });

  it('accepts an explicit id and never shares objects with the template', () => {
    const copy = instantiateTemplate(entry, { id: 'd_custom01', now: NOW });
    expect(copy.id).toBe('d_custom01');
    expect(copy.nodes[0]).not.toBe(entry.diagram.nodes[0]);
    const first = copy.nodes[0];
    if (!first) throw new Error('empty');
    first.label = 'mutated';
    expect(entry.diagram.nodes[0]?.label).not.toBe('mutated');
  });
});
