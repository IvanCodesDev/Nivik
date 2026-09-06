'use client';

import { useEffect } from 'react';
import { useFavoritesStore } from '@/lib/stores/favorites-store';
import { useSettingsStore } from '@/lib/stores/settings-store';

/**
 * Persisted stores use `skipHydration` so the first client render matches the server.
 * This component rehydrates them from localStorage right after mount.
 */
export function StoreHydrator() {
  useEffect(() => {
    void useSettingsStore.persist.rehydrate();
    void useFavoritesStore.persist.rehydrate();
  }, []);
  return null;
}
