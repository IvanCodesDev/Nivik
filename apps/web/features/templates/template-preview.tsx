import type { DiagramTemplate, PreviewTone, TemplateNode } from '@/lib/data/templates';

const TONES: Record<PreviewTone, { fill: string; stroke: string; text: string }> = {
  lavender: { fill: '#f2eafd', stroke: '#dacaf6', text: '#766395' },
  sky: { fill: '#eef6ff', stroke: '#cbe3f8', text: '#5686ad' },
  mint: { fill: '#edf9f3', stroke: '#c1e9d8', text: '#508975' },
  sand: { fill: '#fff6e7', stroke: '#f3dbb5', text: '#aa8754' },
  rose: { fill: '#fff0f2', stroke: '#f3ced3', text: '#b77683' },
  decision: { fill: '#fff3e4', stroke: '#edd6b5', text: '#a88458' },
};

const EDGE_STROKE = '#a9b0bf';
const EDGE_LABEL = '#868da1';

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
          <path d="M0 0.6 L8 4 L0 7.4 Z" fill="#9aa3b2" />
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
  const tone = TONES[node.tone ?? 'lavender'];
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
