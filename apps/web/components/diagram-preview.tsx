import type { Diagram } from '@nivik/ir';
import { paletteVar } from '@nivik/ui';
import { useId, useMemo } from 'react';
import { type PreviewNode, previewOf } from '@/lib/diagram-preview';

const EDGE_STROKE = 'var(--nv-muted-soft)';
const EDGE_LABEL = 'var(--nv-muted)';
const GROUP_STROKE = 'var(--nv-card-border)';
const GROUP_LABEL = 'var(--nv-muted)';
const FONT = 'var(--nv-font)';

interface DiagramPreviewProps {
  diagram: Diagram;
  /** Accessible description; defaults to the diagram name and its node labels. */
  label?: string;
  className?: string;
}

/**
 * Read-only schematic of a document (PRD §5.6 Preview): the IR's own geometry as a resolution-
 * independent SVG that scales with its container. Not a renderer — no sketch style, no icons.
 */
export function DiagramPreview({ diagram, label, className }: DiagramPreviewProps) {
  const model = useMemo(() => previewOf(diagram), [diagram]);
  const markerId = `arrow-${useId()}`;
  const description =
    label ?? `${diagram.name}: ${model.nodes.map((n) => n.lines.join(', ')).join('; ')}`;

  return (
    <svg
      className={className}
      viewBox={`0 0 ${model.width} ${model.height}`}
      preserveAspectRatio="xMidYMid meet"
      role="img"
      aria-label={description}
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
      <g fontFamily={FONT}>
        {model.groups.map((g) => (
          <g key={g.id}>
            <rect
              x={g.x}
              y={g.y}
              width={g.w}
              height={g.h}
              rx={10}
              fill="none"
              stroke={GROUP_STROKE}
              strokeWidth={1.2}
              strokeDasharray="6 4"
            />
            {g.label && (
              <text x={g.x + 12} y={g.y + 18} fill={GROUP_LABEL} fontSize={12} fontWeight={600}>
                {g.label}
              </text>
            )}
          </g>
        ))}
      </g>
      <g fill="none" stroke={EDGE_STROKE} strokeWidth={1.35} strokeLinejoin="round">
        {model.edges.map((e) => {
          const first = e.points[0];
          const last = e.points[e.points.length - 1];
          if (!first || !last) return null;
          const mid = e.points[Math.floor((e.points.length - 1) / 2)] ?? first;
          const next = e.points[Math.floor((e.points.length - 1) / 2) + 1] ?? last;
          return (
            <g key={e.id}>
              <polyline
                points={e.points.map((p) => `${p.x},${p.y}`).join(' ')}
                markerEnd={e.directed ? `url(#${markerId})` : undefined}
              />
              {e.label && (
                <text
                  x={(mid.x + next.x) / 2}
                  y={(mid.y + next.y) / 2 - 6}
                  fill={EDGE_LABEL}
                  stroke="none"
                  fontSize={11}
                  textAnchor="middle"
                  fontFamily={FONT}
                >
                  {e.label}
                </text>
              )}
            </g>
          );
        })}
      </g>
      <g fontFamily={FONT}>
        {model.nodes.map((n) => (
          <Node key={n.id} node={n} />
        ))}
      </g>
    </svg>
  );
}

function Node({ node }: { node: PreviewNode }) {
  const fill = paletteVar(node.palette, 'fill');
  const stroke = paletteVar(node.palette, 'stroke');
  const text = paletteVar(node.palette, 'text');
  const { x, y, w, h, lines } = node;

  if (node.shape === 'line') {
    return (
      <line x1={x} y1={y + h / 2} x2={x + w} y2={y + h / 2} stroke={stroke} strokeWidth={1.5} />
    );
  }

  const shape =
    node.shape === 'text' ? null : node.shape === 'diamond' ? (
      <polygon
        points={`${x + w / 2},${y} ${x + w},${y + h / 2} ${x + w / 2},${y + h} ${x},${y + h / 2}`}
        fill={fill}
        stroke={stroke}
        strokeWidth={1.35}
      />
    ) : node.shape === 'ellipse' ? (
      <ellipse
        cx={x + w / 2}
        cy={y + h / 2}
        rx={w / 2}
        ry={h / 2}
        fill={fill}
        stroke={stroke}
        strokeWidth={1.35}
      />
    ) : (
      <rect
        x={x}
        y={y}
        width={w}
        height={h}
        rx={node.shape === 'rounded' ? 12 : 4}
        fill={fill}
        stroke={stroke}
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
          fill={text}
          fontSize={12}
          fontWeight={700}
          textAnchor="middle"
        >
          {lines[0]}
        </text>
        <line x1={x} y1={y + 29} x2={x + w} y2={y + 29} stroke={stroke} strokeWidth={1.35} />
        {lines.slice(1).map((line, i) => (
          <text key={`${i}-${line}`} x={x + 10} y={y + 48 + i * 18} fill={text} fontSize={11}>
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
          key={`${i}-${line}`}
          x={x + w / 2}
          y={y + h / 2 + 4 + (i - (lines.length - 1) / 2) * 16}
          fill={text}
          fontSize={12}
          fontWeight={500}
          textAnchor="middle"
        >
          {line}
        </text>
      ))}
    </g>
  );
}
