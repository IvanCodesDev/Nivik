import { describe, expect, it } from 'vitest';
import { isNivik, mainOf, parseNativeId, partId, tagOf } from './id-map';

describe('id map (spec 04 §5.1)', () => {
  it('names parts and parses them back', () => {
    expect(partId('n_1', 'main')).toBe('n_1');
    expect(partId('n_1', 'label')).toBe('n_1:label');
    expect(parseNativeId('n_1')).toEqual({ id: 'n_1', part: 'main' });
    expect(parseNativeId('n_1:lifeline')).toEqual({ id: 'n_1', part: 'lifeline' });
    expect(parseNativeId('n_1:nonsense')).toBeNull();
    expect(parseNativeId('Not An Id')).toBeNull();
    expect(mainOf('order-events:icon')).toBe('order-events');
    expect(mainOf('___')).toBeNull();
  });
  it('recognises nivik custom data', () => {
    expect(isNivik({ nivik: tagOf('n_1', 'main', 3) })).toBe(true);
    expect(isNivik({ nivik: { id: 'n_1' } })).toBe(false);
    expect(isNivik(null)).toBe(false);
    expect(isNivik({ other: 1 })).toBe(false);
  });
});
