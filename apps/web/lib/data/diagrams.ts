import {
  Buildings,
  Cpu,
  Database,
  FlowArrow,
  type Icon,
  ListNumbers,
  SquaresFour,
  Star,
} from '@phosphor-icons/react';
import type { LibraryFilter } from '@/lib/library';

/** Chip icons for the Library filters (PRD §5.3); labels come from `t.library.categories`. */
export const LIBRARY_FILTER_ICONS: Record<LibraryFilter, Icon> = {
  all: SquaresFour,
  architecture: Buildings,
  flow: FlowArrow,
  system: Cpu,
  data: Database,
  sequence: ListNumbers,
  favorite: Star,
};
