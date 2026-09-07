import type { ExcalidrawElement } from '@excalidraw/excalidraw/element/types';

type Loose = Record<string, unknown>;

/** A complete Excalidraw element from a few fields (tests only). */
export function excalidrawElement<T extends ExcalidrawElement['type']>(
  type: T,
  fields: Loose & { id: string; x: number; y: number },
): Extract<ExcalidrawElement, { type: T }> {
  const base: Loose = {
    type,
    width: 120,
    height: 56,
    angle: 0,
    strokeColor: '#1e1e1e',
    backgroundColor: 'transparent',
    fillStyle: 'solid',
    strokeWidth: 1,
    strokeStyle: 'solid',
    roughness: 0,
    opacity: 100,
    groupIds: [],
    frameId: null,
    index: null,
    roundness: null,
    seed: 1,
    version: 1,
    versionNonce: 1,
    isDeleted: false,
    boundElements: null,
    updated: 0,
    link: null,
    locked: false,
  };
  const extra: Loose =
    type === 'text'
      ? {
          text: '',
          originalText: '',
          fontSize: 20,
          fontFamily: 6,
          textAlign: 'center',
          verticalAlign: 'middle',
          containerId: null,
          autoResize: true,
          lineHeight: 1.25,
        }
      : type === 'arrow' || type === 'line'
        ? {
            points: [
              [0, 0],
              [100, 0],
            ],
            lastCommittedPoint: null,
            startBinding: null,
            endBinding: null,
            startArrowhead: null,
            endArrowhead: type === 'arrow' ? 'arrow' : null,
            elbowed: false,
          }
        : type === 'frame'
          ? { name: null }
          : type === 'freedraw'
            ? { points: [[0, 0]], pressures: [], simulatePressure: true, lastCommittedPoint: null }
            : type === 'image'
              ? { fileId: null, status: 'pending', scale: [1, 1], crop: null }
              : {};
  return { ...base, ...extra, ...fields } as unknown as Extract<ExcalidrawElement, { type: T }>;
}
