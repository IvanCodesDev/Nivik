'use client';

import { cn, Select, Switch } from '@nivik/ui';
import type { CSSProperties } from 'react';
import { type Settings, useSettingsStore } from '@/lib/stores/settings-store';
import { CardHeading, DetailsCard, GroupLabel, RowsCard, SettingRow } from './primitives';
import styles from './settings.module.css';

const GRID_SIZES: readonly { value: Settings['gridSize']; label: string }[] = [
  { value: '12', label: '12 px' },
  { value: '18', label: '18 px' },
  { value: '20', label: '20 px' },
  { value: '24', label: '24 px' },
  { value: '32', label: '32 px' },
];

const BACKGROUNDS = [
  { value: '#faf9fb', label: 'Soft white', dotted: true },
  { value: '#f5f1ff', label: 'Lavender' },
  { value: '#eff9f5', label: 'Mint' },
  { value: '#fff9ed', label: 'Warm paper' },
] as const;

const SELECTION_STYLES: readonly { value: Settings['selection']; label: string }[] = [
  { value: 'outline', label: 'Default (Outline)' },
  { value: 'fill', label: 'Soft highlight' },
];

const THEMES: readonly { value: Settings['theme'] | 'dark'; label: string; disabled?: boolean }[] =
  [
    { value: 'light', label: 'Light' },
    { value: 'system', label: 'Light (System)' },
    { value: 'dark', label: 'Dark · Coming soon', disabled: true },
  ];

const NODE_STYLES: readonly { value: Settings['nodeStyle']; label: string }[] = [
  { value: 'rounded', label: 'Rounded' },
  { value: 'square', label: 'Square' },
  { value: 'pill', label: 'Pill' },
];

const EDGE_STYLES: readonly { value: Settings['edgeStyle']; label: string }[] = [
  { value: 'solid', label: 'Solid' },
  { value: 'dashed', label: 'Dashed' },
];

const NODE_RADIUS: Record<Settings['nodeStyle'], number> = { rounded: 9, square: 2, pill: 30 };

export function AppearanceSection() {
  const draft = useSettingsStore((s) => s.draft);
  const update = useSettingsStore((s) => s.update);

  return (
    <>
      <RowsCard>
        <CardHeading title="Canvas" description="How the drawing surface looks and behaves." />
        <GroupLabel>Canvas</GroupLabel>
        <SettingRow
          htmlFor="show-grid"
          label="Show Grid"
          description="Dotted guide behind your diagram."
          width="auto"
          compact
          control={
            <Switch
              id="show-grid"
              checked={draft.showGrid}
              onCheckedChange={(showGrid) => update({ showGrid })}
            />
          }
        />
        <SettingRow
          htmlFor="grid-size"
          label="Grid Size"
          description="Spacing between dots."
          width="narrow"
          compact
          control={
            <Select
              id="grid-size"
              value={draft.gridSize}
              options={GRID_SIZES}
              onValueChange={(gridSize) => update({ gridSize })}
            />
          }
        />
        <SettingRow
          label="Canvas Background"
          description="Base color under the grid."
          width="auto"
          compact
          control={
            <div className={styles.swatches} role="radiogroup" aria-label="Canvas background">
              {BACKGROUNDS.map((bg) => (
                <button
                  key={bg.value}
                  type="button"
                  role="radio"
                  aria-checked={draft.canvasBackground === bg.value}
                  aria-label={bg.label}
                  title={bg.label}
                  className={cn(styles.swatch, 'dotted' in bg && bg.dotted && styles.dotted)}
                  style={{ backgroundColor: bg.value }}
                  onClick={() => update({ canvasBackground: bg.value })}
                />
              ))}
            </div>
          }
        />

        <GroupLabel>Editing</GroupLabel>
        <SettingRow
          htmlFor="snap"
          label="Snap to Grid"
          description="Align shapes to the grid while dragging."
          width="auto"
          compact
          control={
            <Switch id="snap" checked={draft.snap} onCheckedChange={(snap) => update({ snap })} />
          }
        />
        <SettingRow
          htmlFor="selection"
          label="Selection Style"
          description="How selected shapes are highlighted."
          compact
          control={
            <Select
              id="selection"
              value={draft.selection}
              options={SELECTION_STYLES}
              onValueChange={(selection) => update({ selection })}
            />
          }
        />

        <GroupLabel>Appearance</GroupLabel>
        <SettingRow
          htmlFor="theme"
          label="Theme"
          description="Dark mode is on the roadmap."
          compact
          control={
            <Select
              id="theme"
              value={draft.theme}
              options={THEMES}
              onValueChange={(theme) => {
                if (theme !== 'dark') update({ theme });
              }}
            />
          }
        />
        <SettingRow
          htmlFor="node-style"
          label="Default Node Style"
          description="Corner treatment for new shapes."
          compact
          control={
            <Select
              id="node-style"
              value={draft.nodeStyle}
              options={NODE_STYLES}
              onValueChange={(nodeStyle) => update({ nodeStyle })}
            />
          }
        />
        <SettingRow
          htmlFor="edge-style"
          label="Default Edge Style"
          description="Line style for new connectors."
          compact
          control={
            <Select
              id="edge-style"
              value={draft.edgeStyle}
              options={EDGE_STYLES}
              onValueChange={(edgeStyle) => update({ edgeStyle })}
            />
          }
        />
      </RowsCard>

      <DetailsCard
        title="Preview your canvas"
        description="A live look at the current draft."
        defaultOpen
      >
        <CanvasPreview settings={draft} />
      </DetailsCard>
    </>
  );
}

function CanvasPreview({ settings }: { settings: Settings }) {
  const gridStyle: CSSProperties = settings.showGrid
    ? {
        backgroundColor: settings.canvasBackground,
        backgroundImage: 'radial-gradient(circle, rgba(166,169,181,.35) .8px, transparent 1px)',
        backgroundSize: `${settings.gridSize}px ${settings.gridSize}px`,
      }
    : { backgroundColor: settings.canvasBackground };
  const nodeStyle: CSSProperties = { borderRadius: NODE_RADIUS[settings.nodeStyle] };

  return (
    <div className={styles.canvasPreview} style={gridStyle} aria-hidden="true">
      <span className={styles.previewNode} style={nodeStyle}>
        Your idea
      </span>
      <span className={styles.previewEdge} style={{ borderTopStyle: settings.edgeStyle }} />
      <span
        className={cn(
          styles.previewNode,
          styles.selected,
          settings.selection === 'fill' && styles.selectedFill,
        )}
        style={nodeStyle}
      >
        A clearer picture
      </span>
    </div>
  );
}
