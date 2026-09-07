'use client';

import { cn } from '@nivik/ui';
import type { CSSProperties } from 'react';
import { useT } from '@/lib/i18n/provider';
import styles from './canvas.module.css';
import {
  BODY_MOTION,
  HINT_GLYPHS,
  type HintLine,
  hintLine,
  inkTiming,
  type MotionProfile,
  penTimings,
  scheduleLine,
  TITLE_MOTION,
  type Timing,
} from './hint-glyphs';

/** Font size in px per em. */
const TITLE_SIZE = 30;
const BODY_SIZE = 15;
/** Pen width in em units (1000 per em): about 0.8px on the title, 0.55px on the body. */
const TITLE_PEN = 26;
const BODY_PEN = 36;

/**
 * The empty-canvas hint, hand-written: each glyph's contours are drawn by a pen one after
 * another, then the glyph is inked in. Outlines come from `hint-glyphs.json`; copy without
 * outlines yet falls back to plain text.
 */
export function SketchHint() {
  const t = useT();
  const title = hintLine(t.canvas.hintTitle);
  const body = hintLine(t.canvas.hintBody);
  const titleSchedule = scheduleLine(title?.glyphs.length ?? 0, TITLE_MOTION);
  // The body starts while the last title glyph is still being inked.
  const bodyStart = Math.max(0, Math.round(titleSchedule.duration - TITLE_MOTION.draw * 0.4));

  return (
    <div className={styles.hint}>
      <ScriptLine
        text={t.canvas.hintTitle}
        line={title}
        size={TITLE_SIZE}
        pen={TITLE_PEN}
        profile={TITLE_MOTION}
        start={0}
        className={styles.hintTitle}
      />
      <ScriptLine
        text={t.canvas.hintBody}
        line={body}
        size={BODY_SIZE}
        pen={BODY_PEN}
        profile={BODY_MOTION}
        start={bodyStart}
        className={styles.hintBody}
      />
    </div>
  );
}

interface ScriptLineProps {
  text: string;
  line: HintLine | null;
  size: number;
  pen: number;
  profile: MotionProfile;
  /** Delay before the first glyph starts, in ms. */
  start: number;
  className?: string;
}

function ScriptLine({ text, line, size, pen, profile, start, className }: ScriptLineProps) {
  if (!line) return <span className={className}>{text}</span>;

  const { ascent, descent, unitsPerEm, glyphs } = HINT_GLYPHS;
  const height = ascent - descent;
  const { stagger } = scheduleLine(line.glyphs.length, profile);

  return (
    <svg
      className={cn(styles.script, className)}
      viewBox={`0 ${-ascent} ${line.width} ${height}`}
      width={(line.width / unitsPerEm) * size}
      height={(height / unitsPerEm) * size}
      role="img"
      aria-label={text}
      style={{ '--pen': pen } as CSSProperties}
    >
      {line.glyphs.map((glyph, index) => {
        const contours = glyphs[glyph.g] ?? [];
        const glyphStart = start + index * stagger;
        return (
          <g key={`${index}-${glyph.g}`} transform={`translate(${glyph.x} 0)`}>
            {penTimings(contours.length, glyphStart, profile.draw).map((timing, contour) => (
              <path
                key={contour}
                d={contours[contour]}
                pathLength={1}
                className={styles.pen}
                style={timingStyle(timing)}
              />
            ))}
            <path
              d={contours.join('')}
              className={styles.ink}
              style={timingStyle(inkTiming(glyphStart, profile.draw))}
            />
          </g>
        );
      })}
    </svg>
  );
}

function timingStyle({ delay, duration }: Timing): CSSProperties {
  return { '--delay': `${delay}ms`, '--duration': `${duration}ms` } as CSSProperties;
}
