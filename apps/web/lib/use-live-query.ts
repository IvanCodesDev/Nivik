'use client';

import { liveQuery } from '@nivik/storage';
import { type DependencyList, useEffect, useState } from 'react';

/**
 * Re-runs `querier` whenever the Dexie tables it read change (spec 07 §2: the UI never polls).
 * `undefined` until the first result; the last good value is kept if a later run fails. The query
 * should go through the repository, not the tables, so the storage rules stay in one place.
 */
export function useLiveQuery<T>(querier: () => Promise<T>, deps: DependencyList): T | undefined {
  const [value, setValue] = useState<T | undefined>(undefined);

  const subscribe = () => {
    const subscription = liveQuery(querier).subscribe({
      next: (next) => setValue(next),
      error: (error: unknown) => console.error('[nivik] live query failed', error),
    });
    return () => subscription.unsubscribe();
  };
  // biome-ignore lint/correctness/useExhaustiveDependencies: the caller's deps decide when to re-subscribe.
  useEffect(subscribe, deps);

  return value;
}
