import { type Id, isId } from '@nivik/ir';

/** Spec 04 §5.1: one IR element may own several native elements. */
export const NATIVE_PARTS = ['main', 'label', 'icon', 'lifeline'] as const;
export type NativePart = (typeof NATIVE_PARTS)[number];

/** `customData.nivik` on every native element the adapters create. */
export interface NivikTag {
  id: Id;
  part: NativePart;
  rev: number;
}

const isPart = (value: string): value is NativePart =>
  (NATIVE_PARTS as readonly string[]).includes(value);

export const partId = (id: Id, part: NativePart): string =>
  part === 'main' ? id : `${id}:${part}`;

/** IR ids never contain ':', so the last colon separates the part suffix. */
export function parseNativeId(nativeId: string): { id: Id; part: NativePart } | null {
  const at = nativeId.lastIndexOf(':');
  if (at === -1) return isId(nativeId) ? { id: nativeId, part: 'main' } : null;
  const id = nativeId.slice(0, at);
  const part = nativeId.slice(at + 1);
  return isId(id) && isPart(part) ? { id, part } : null;
}

export const mainOf = (nativeId: string): Id | null => parseNativeId(nativeId)?.id ?? null;

export const tagOf = (id: Id, part: NativePart, rev: number): NivikTag => ({ id, part, rev });

export function isNivik(customData: unknown): customData is { nivik: NivikTag } {
  if (typeof customData !== 'object' || customData === null) return false;
  const tag = (customData as { nivik?: unknown }).nivik;
  if (typeof tag !== 'object' || tag === null) return false;
  const { id, part, rev } = tag as Partial<NivikTag>;
  return (
    typeof id === 'string' &&
    isId(id) &&
    typeof part === 'string' &&
    isPart(part) &&
    typeof rev === 'number'
  );
}
