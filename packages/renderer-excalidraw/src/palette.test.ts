import { describe, expect, it } from 'vitest';
import { colorsFor, textColorFor } from './palette';

const theme = { preset: 'nivik-soft', strokeStyle: 'clean', fontScale: 'm' } as const;

describe('colorsFor (spec 04 §6.2 style rows)', () => {
  it('maps palette + default emphasis to the palette hex, clean stroke to roughness 0 / Nunito', () => {
    expect(colorsFor(theme, { palette: 'mint' })).toEqual({
      strokeColor: '#91b9a9',
      backgroundColor: '#eff9f5',
      strokeWidth: 1,
      strokeStyle: 'solid',
      opacity: 100,
      roughness: 0,
      fontFamily: 6,
      fillStyle: 'solid',
    });
    expect(textColorFor(theme, { palette: 'mint' })).toBe('#2f4f44');
  });
  it('falls back to neutral without a palette', () => {
    expect(colorsFor(theme, undefined).backgroundColor).toBe('#f4f4f7');
  });
  it('muted softens the stroke, strong uses the text colour and a bold stroke', () => {
    expect(colorsFor(theme, { palette: 'mint', emphasis: 'muted' })).toMatchObject({
      strokeColor: '#c0d9cf',
      strokeWidth: 1,
    });
    expect(colorsFor(theme, { palette: 'mint', emphasis: 'strong' })).toMatchObject({
      strokeColor: '#2f4f44',
      strokeWidth: 2,
    });
  });
  it('presets: contrast strokes with the text colour, mono ignores the palette', () => {
    expect(colorsFor({ ...theme, preset: 'nivik-contrast' }, { palette: 'mint' }).strokeColor).toBe(
      '#2f4f44',
    );
    expect(colorsFor({ ...theme, preset: 'mono' }, { palette: 'mint' }).backgroundColor).toBe(
      '#f4f4f7',
    );
  });
  it('fill tokens: translucent → opacity 50, none → transparent; stroke token → strokeStyle', () => {
    expect(colorsFor(theme, { fill: 'translucent' }).opacity).toBe(50);
    expect(colorsFor(theme, { fill: 'none' }).backgroundColor).toBe('transparent');
    expect(colorsFor(theme, { stroke: 'dashed' }).strokeStyle).toBe('dashed');
  });
  it('overrides win; sketch theme → roughness 1 / Excalifont', () => {
    expect(
      colorsFor(theme, { palette: 'mint', override: { fill: '#ffeeaa', stroke: '#112233' } }),
    ).toMatchObject({ backgroundColor: '#ffeeaa', strokeColor: '#112233' });
    expect(textColorFor(theme, { override: { text: '#010203' } })).toBe('#010203');
    expect(colorsFor({ ...theme, strokeStyle: 'sketch' }, undefined)).toMatchObject({
      roughness: 1,
      fontFamily: 5,
    });
  });
});
