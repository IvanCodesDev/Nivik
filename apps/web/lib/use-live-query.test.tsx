// @vitest-environment happy-dom
import 'fake-indexeddb/auto';
import { createDiagram } from '@nivik/ir';
import { DiagramRepository, NivikDB } from '@nivik/storage';
import { cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { useLiveQuery } from './use-live-query';

let counter = 0;

describe('useLiveQuery', () => {
  afterEach(cleanup);

  it('starts undefined, delivers the first result and follows later writes', async () => {
    const repo = new DiagramRepository(new NivikDB(`live-query-${++counter}`));
    const { result, unmount } = renderHook(() =>
      useLiveQuery(() => repo.list().then((rows) => rows.map((r) => r.name)), [repo]),
    );
    expect(result.current).toBeUndefined();
    await waitFor(() => expect(result.current).toEqual([]));

    await repo.create(createDiagram({ id: 'd_live00001', name: 'First', type: 'flow', now: 1 }));
    await waitFor(() => expect(result.current).toEqual(['First']));

    await repo.create(createDiagram({ id: 'd_live00002', name: 'Second', type: 'flow', now: 2 }));
    await waitFor(() => expect(result.current).toEqual(['Second', 'First']));

    unmount();
    await repo.remove('d_live00001');
    // No update after unmount: the subscription is gone.
    expect(result.current).toEqual(['Second', 'First']);
  });
});
