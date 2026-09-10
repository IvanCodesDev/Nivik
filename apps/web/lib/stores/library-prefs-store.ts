import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { LIBRARY_SORTS, type LibrarySort } from '@/lib/library';

interface LibraryPrefsState {
  sort: LibrarySort;
  setSort: (sort: LibrarySort) => void;
}

const isSort = (value: unknown): value is LibrarySort =>
  (LIBRARY_SORTS as readonly unknown[]).includes(value);

/** How the Library is ordered; a device preference like the settings, not part of any diagram. */
export const useLibraryPrefs = create<LibraryPrefsState>()(
  persist(
    (set) => ({
      sort: 'edited',
      setSort: (sort) => set({ sort }),
    }),
    {
      name: 'nivik.library.v1',
      storage: createJSONStorage(() => localStorage),
      skipHydration: true,
      partialize: (state) => ({ sort: state.sort }),
      merge: (persisted, current) => {
        const stored = persisted as Partial<LibraryPrefsState> | undefined;
        return { ...current, sort: isSort(stored?.sort) ? stored.sort : current.sort };
      },
    },
  ),
);
