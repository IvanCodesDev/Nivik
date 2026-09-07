'use client';

import { cn, Select, Switch } from '@nivik/ui';
import { DotsNine, type Icon, Square } from '@phosphor-icons/react';
import { type CSSProperties, useMemo } from 'react';
import type { Dictionary } from '@/lib/i18n/dictionaries';
import { useT } from '@/lib/i18n/provider';
import {
  CANVAS_BACKGROUNDS,
  CANVAS_PATTERNS,
  type CanvasPattern,
  canvasBackgroundVar,
  EDGE_STYLES,
  GRID_SIZES,
  NODE_RADIUS,
  NODE_STYLES,
  SELECTION_STYLES,
  type Settings,
  THEMES,
  useSettingsStore,
} from '@/lib/stores/settings-store';
import { CardHeading, DetailsCard, GroupLabel, RowsCard, SettingRow } from './primitives';
import styles from './settings.module.css';

const PATTERN_ICONS: Record<CanvasPattern, Icon> = { dots: DotsNine, plain: Square };

function buildOptions(t: Dictionary['settings']['appearance']) {
  return {
    gridSizes: GRID_SIZES.map((value) => ({ value, label: t.gridPx(value) })),
    selections: SELECTION_STYLES.map((value) => ({ value, label: t.selections[value] })),
    themes: THEMES.map((value) => ({ value, label: t.themes[value] })),
    nodeStyles: NODE_STYLES.map((value) => ({ value, label: t.nodeStyles[value] })),
    edgeStyles: EDGE_STYLES.map((value) => ({ value, label: t.edgeStyles[value] })),
  };
}

export function AppearanceSection() {
  const t = useT();
  const copy = t.settings.appearance;
  const draft = useSettingsStore((s) => s.draft);
  const update = useSettingsStore((s) => s.update);
  const options = useMemo(() => buildOptions(copy), [copy]);

  return (
    <>
      <RowsCard>
        <CardHeading title={copy.canvas} description={copy.canvasDescription} />
        <GroupLabel>{copy.canvas}</GroupLabel>
        <SettingRow
          label={copy.background}
          description={copy.backgroundDescription}
          width="auto"
          compact
          control={
            <div className={styles.backgroundControl}>
              <div className={styles.patterns} role="radiogroup" aria-label={copy.pattern}>
                {CANVAS_PATTERNS.map((pattern) => {
                  const PatternIcon = PATTERN_ICONS[pattern];
                  return (
                    <button
                      key={pattern}
                      type="button"
                      role="radio"
                      aria-checked={draft.canvasPattern === pattern}
                      className={styles.pattern}
                      onClick={() => update({ canvasPattern: pattern })}
                    >
                      <PatternIcon size={14} weight="bold" aria-hidden="true" />
                      {copy.patterns[pattern]}
                    </button>
                  );
                })}
              </div>
              <div className={styles.swatches} role="radiogroup" aria-label={copy.paper}>
                {CANVAS_BACKGROUNDS.map((tint) => (
                  <button
                    key={tint}
                    type="button"
                    role="radio"
                    aria-checked={draft.canvasBackground === tint}
                    aria-label={copy.backgrounds[tint]}
                    title={copy.backgrounds[tint]}
                    className={cn(styles.swatch, draft.canvasPattern === 'dots' && styles.dotted)}
                    style={{ backgroundColor: canvasBackgroundVar(tint) }}
                    onClick={() => update({ canvasBackground: tint })}
                  />
                ))}
              </div>
            </div>
          }
        />
        <SettingRow
          htmlFor="grid-size"
          label={copy.gridSize}
          description={copy.gridSizeDescription}
          width="narrow"
          compact
          control={
            <Select
              id="grid-size"
              value={draft.gridSize}
              options={options.gridSizes}
              onValueChange={(gridSize) => update({ gridSize })}
            />
          }
        />

        <GroupLabel>{copy.editing}</GroupLabel>
        <SettingRow
          htmlFor="snap"
          label={copy.snap}
          description={copy.snapDescription}
          width="auto"
          compact
          control={
            <Switch id="snap" checked={draft.snap} onCheckedChange={(snap) => update({ snap })} />
          }
        />
        <SettingRow
          htmlFor="selection"
          label={copy.selection}
          description={copy.selectionDescription}
          compact
          control={
            <Select
              id="selection"
              value={draft.selection}
              options={options.selections}
              onValueChange={(selection) => update({ selection })}
            />
          }
        />

        <GroupLabel>{copy.appearance}</GroupLabel>
        <SettingRow
          htmlFor="theme"
          label={copy.theme}
          description={copy.themeDescription}
          compact
          control={
            <Select
              id="theme"
              value={draft.theme}
              options={options.themes}
              onValueChange={(theme) => update({ theme })}
            />
          }
        />
        <SettingRow
          htmlFor="node-style"
          label={copy.nodeStyle}
          description={copy.nodeStyleDescription}
          compact
          control={
            <Select
              id="node-style"
              value={draft.nodeStyle}
              options={options.nodeStyles}
              onValueChange={(nodeStyle) => update({ nodeStyle })}
            />
          }
        />
        <SettingRow
          htmlFor="edge-style"
          label={copy.edgeStyle}
          description={copy.edgeStyleDescription}
          compact
          control={
            <Select
              id="edge-style"
              value={draft.edgeStyle}
              options={options.edgeStyles}
              onValueChange={(edgeStyle) => update({ edgeStyle })}
            />
          }
        />
      </RowsCard>

      <DetailsCard title={copy.preview} description={copy.previewDescription} defaultOpen>
        <CanvasPreview settings={draft} />
      </DetailsCard>
    </>
  );
}

function CanvasPreview({ settings }: { settings: Settings }) {
  const t = useT();
  const surfaceStyle: CSSProperties = {
    backgroundColor: canvasBackgroundVar(settings.canvasBackground),
    ...(settings.canvasPattern === 'dots' && {
      backgroundImage: 'radial-gradient(circle, var(--nv-canvas-dot) 0.8px, transparent 1px)',
      backgroundSize: `${settings.gridSize}px ${settings.gridSize}px`,
    }),
  };
  const nodeStyle: CSSProperties = { borderRadius: NODE_RADIUS[settings.nodeStyle] };

  return (
    <div className={styles.canvasPreview} style={surfaceStyle} aria-hidden="true">
      <span className={styles.previewNode} style={nodeStyle}>
        {t.settings.appearance.previewIdea}
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
        {t.settings.appearance.previewPicture}
      </span>
    </div>
  );
}
