import { describe, expect, it } from 'vitest';
import {
  COMING_SOON_CATEGORIES,
  findTemplate,
  TEMPLATE_CATEGORIES,
  TEMPLATES,
  templatePrompt,
} from './templates';

describe('built-in templates', () => {
  it('have unique ids', () => {
    const ids = TEMPLATES.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('only reference nodes that exist', () => {
    for (const template of TEMPLATES) {
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
    expect(TEMPLATES.filter((t) => t.featured)).toHaveLength(1);
  });
});

describe('templatePrompt', () => {
  const pipeline = findTemplate('pipeline');

  it('chains the first five steps for a manual start', () => {
    expect(pipeline).toBeDefined();
    if (!pipeline) return;
    expect(templatePrompt(pipeline, false)).toBe(
      'Code Commit → Build → Test → Deploy to → Tests Pass?',
    );
  });

  it('describes the full structure for AI generation', () => {
    expect(pipeline).toBeDefined();
    if (!pipeline) return;
    expect(templatePrompt(pipeline, true)).toMatch(/^Build CI\/CD Pipeline using this structure: /);
    expect(templatePrompt(pipeline, true)).toContain('Production');
  });

  it('returns undefined for unknown ids', () => {
    expect(findTemplate('nope')).toBeUndefined();
    expect(findTemplate(null)).toBeUndefined();
  });
});
