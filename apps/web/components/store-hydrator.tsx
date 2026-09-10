'use client';

import { useEffect } from 'react';
import { loadDeviceKeys } from '@/lib/provider-keys';
import { useFavoritesStore } from '@/lib/stores/favorites-store';
import { useProviderKeys, useSettingsStore } from '@/lib/stores/settings-store';

/**
 * Persisted stores use `skipHydration` so the first client render matches the server.
 * This component rehydrates them from localStorage right after mount, then restores API keys from
 * the encrypted device vault when the user chose to keep them on this device (spec 06 §6.1).
 */
export function StoreHydrator() {
  useEffect(() => {
    let cancelled = false;
    void useFavoritesStore.persist.rehydrate();
    void Promise.resolve(useSettingsStore.persist.rehydrate()).then(async () => {
      if (useSettingsStore.getState().saved.keyStorage !== 'device') return;
      const keys = await loadDeviceKeys();
      if (!cancelled) useProviderKeys.getState().hydrate(keys);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  return null;
}
