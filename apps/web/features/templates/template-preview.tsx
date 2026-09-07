import { type PaletteName, paletteVar } from '@nivik/ui';
import type { DiagramTemplate, PreviewTone, TemplateNode } from '@/lib/data/templates';

const TONE_PALETTES: Record<PreviewTone, PaletteName> = {
  lavender: 'lavender',
  sky: 'sky',
  mint: 'mint',
  sand: 'sand',
  rose: 'rose',
  decision: 'sand',
};

/** Thumbnails are softer than a real canvas: strokes and labels lean toward the fill. */
function toneColors(tone: PreviewTone) {
  const palette = TONE_PALETTES[tone];
  const [fill, stroke, text] = (['fill', 'stroke', 'text'] as const).map((part) =>
    paletteVar(palette, part),
  );
  return {
    fill,
    stroke: `color-mix(in srgb, ${stroke} 55%, ${fill})`,
    text: `color-mix(in srgb, ${text} 55%, ${stroke})`,
  };
}

const EDGE_STROKE = 'var(--nv-muted-soft)';
const EDGE_LABEL = 'var(--nv-muted)';

interface TemplatePreviewProps {
  template: DiagramTemplate;
  className?: string;
}

/**
 * Schematic rendering of a template's nodes and edges. Replaces the prototype's
 * `<canvas>` painter with a resolution-independent SVG that scales with its container.
 */
export function TemplatePreview({ template, className }: TemplatePreviewProps) {
  const width = template.width ?? 500;
  const markerId = `arrow-${template.id}`;
  const label = `${template.title}: ${template.nodes
    .map((node) => node.label.replaceAll('\n', ', '))
    .join('; ')}`;

  return (
    <svg
      className={className}
      viewBox={`0 0 ${width} ${template.height}`}
      preserveAspectRatio="xMidYMid meet"
      role="img"
      aria-label={label}
      style={{ display: 'block', width: '100%', height: '100%' }}
    >
      <defs>
        <marker
          id={markerId}
          viewBox="0 0 8 8"
          refX="7"
          refY="4"
          markerWidth="7"
          markerHeight="7"
          orient="auto-start-reverse"
        >
          <path d="M0 0.6 L8 4 L0 7.4 Z" fill={EDGE_STROKE} />
        </marker>
      </defs>
      <g fill="none" stroke={EDGE_STROKE} strokeWidth={1.35} strokeLinejoin="round">
        {template.edges.map((edge, index) => {
          const a = template.nodes[edge.from];
          const b = template.nodes[edge.to];
          if (!a || !b) return null;
          const points = routeEdge(a, b);
          const first = points[0];
          const last = points[points.length - 1];
          if (!first || !last) return null;
          return (
            <g key={`${edge.from}-${edge.to}-${index}`}>
              <polyline
                points={points.map(([x, y]) => `${x},${y}`).join(' ')}
                markerEnd={`url(#${markerId})`}
              />
              {edge.label && (
                <text
                  x={(first[0] + last[0]) / 2 + 13}
                  y={(first[1] + last[1]) / 2 - 7}
                  fill={EDGE_LABEL}
                  stroke="none"
                  fontSize={10}
                  textAnchor="middle"
                  fontFamily="var(--nv-font)"
                >
                  {edge.label}
                </text>
              )}
            </g>
          );
        })}
      </g>
      <g fontFamily="var(--nv-font)">
        {template.nodes.map((node, index) => (
          <PreviewNode key={index} node={node} />
        ))}
      </g>
    </svg>
  );
}

/** Same-row neighbours connect side-to-side; everything else takes an orthogonal path. */
function routeEdge(a: TemplateNode, b: TemplateNode): [number, number][] {
  if (Math.abs(a.y - b.y) < 70 && b.x > a.x) {
    return [
      [a.x + a.w, a.y + a.h / 2],
      [b.x, b.y + b.h / 2],
    ];
  }
  const x = a.x + a.w / 2;
  const y = a.y + a.h;
  const xx = b.x + b.w / 2;
  const yy = b.y;
  const mid = (y + yy) / 2;
  return [
    [x, y],
    [x, mid],
    [xx, mid],
    [xx, yy],
  ];
}

function PreviewNode({ node }: { node: TemplateNode }) {
  const tone = toneColors(node.tone ?? 'lavender');
  const lines = node.label.split('\n');
  const { x, y, w, h } = node;

  const shape =
    node.shape === 'diamond' ? (
      <polygon
        points={`${x + w / 2},${y} ${x + w},${y + h / 2} ${x + w / 2},${y + h} ${x},${y + h / 2}`}
        fill={tone.fill}
        stroke={tone.stroke}
        strokeWidth={1.35}
      />
    ) : (
      <rect
        x={x}
        y={y}
        width={w}
        height={h}
        rx={6}
        fill={tone.fill}
        stroke={tone.stroke}
        strokeWidth={1.35}
      />
    );

  if (lines.length > 2) {
    // Entity-style box: bold header, rule, left-aligned rows.
    return (
      <g>
        {shape}
        <text
          x={x + w / 2}
          y={y + 19}
          fill={tone.text}
          fontSize={11}
          fontWeight={700}
          textAnchor="middle"
        >
          {lines[0]}
        </text>
        <line x1={x} y1={y + 29} x2={x + w} y2={y + 29} stroke={tone.stroke} strokeWidth={1.35} />
        {lines.slice(1).map((line, i) => (
          <text key={i} x={x + 10} y={y + 48 + i * 20} fill={tone.text} fontSize={10}>
            {line}
          </text>
        ))}
      </g>
    );
  }

  return (
    <g>
      {shape}
      {lines.map((line, i) => (
        <text
          key={i}
          x={x + w / 2}
          y={y + h / 2 + 4 + (i - (lines.length - 1) / 2) * 15}
          fill={tone.text}
          fontSize={11}
          fontWeight={500}
          textAnchor="middle"
        >
          {line}
        </text>
      ))}
    </g>
  );
}
