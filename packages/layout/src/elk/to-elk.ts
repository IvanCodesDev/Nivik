import type { Diagram, Id, LayoutSpec, Side } from '@nivik/ir';
import type { ElkExtendedEdge, ElkNode, ElkPort, LayoutOptions } from 'elkjs/lib/elk-api';
import { ELK_SPACING, GROUP_PAD, LARGE_GRAPH_ELEMENTS, MIN_CELL_H, MIN_CELL_W } from '../constants';
import type { SizeMap } from '../types';

const EDGE_ROUTING: Record<LayoutSpec['edgeRouting'], string> = {
  orthogonal: 'ORTHOGONAL',
  polyline: 'POLYLINE',
  straight: 'UNDEFINED',
};

const ELK_SIDE: Record<Exclude<Side, 'auto'>, string> = {
  top: 'NORTH',
  right: 'EAST',
  bottom: 'SOUTH',
  left: 'WEST',
};

const GROUP_PADDING = `[top=${GROUP_PAD.top},left=${GROUP_PAD.side},bottom=${GROUP_PAD.bottom},right=${GROUP_PAD.side}]`;

export interface GraphScale {
  nodes: number;
  edges: number;
}

/**
 * Spec 03 §5.2 root options. Node placement is NETWORK_SIMPLEX for the quality it gives everyday
 * diagrams and BRANDES_KOEPF past `LARGE_GRAPH_ELEMENTS`, where NS blows the §10 time budget.
 */
export function rootOptions(
  spec: LayoutSpec,
  scale: GraphScale = { nodes: 0, edges: 0 },
): LayoutOptions {
  const s = ELK_SPACING[spec.spacing];
  const large = scale.nodes + scale.edges > LARGE_GRAPH_ELEMENTS;
  return {
    'elk.algorithm': 'layered',
    'elk.direction': spec.direction,
    'elk.edgeRouting': EDGE_ROUTING[spec.edgeRouting],
    'elk.spacing.nodeNode': String(s.nodeNode),
    'elk.layered.spacing.nodeNodeBetweenLayers': String(s.betweenLayers),
    'elk.spacing.edgeNode': String(s.edgeNode),
    'elk.layered.spacing.edgeNodeBetweenLayers': String(s.edgeNode),
    'elk.spacing.edgeEdge': String(s.edgeEdge),
    'elk.layered.nodePlacement.strategy': large ? 'BRANDES_KOEPF' : 'NETWORK_SIMPLEX',
    'elk.layered.crossingMinimization.strategy': 'LAYER_SWEEP',
    'elk.layered.considerModelOrder.strategy': 'NODES_AND_EDGES',
    'elk.layered.mergeEdges': 'false',
    'elk.hierarchyHandling': 'INCLUDE_CHILDREN',
    'elk.separateConnectedComponents': 'true',
    'elk.spacing.componentComponent': String(2 * s.nodeNode),
  };
}

export const portId = (edgeId: Id, end: 'source' | 'target'): string => `${edgeId}__${end}`;

/** Spec 03 §5.1: groups become compound nodes, nodes leaves, fixed sides become ports. */
export function toElk(d: Diagram, sizes: SizeMap, spec: LayoutSpec): ElkNode {
  const ports = new Map<Id, ElkPort[]>();
  const addPort = (nodeId: Id, edgeId: Id, end: 'source' | 'target', side: Side) => {
    if (side === 'auto') return;
    const list = ports.get(nodeId) ?? [];
    list.push({
      id: portId(edgeId, end),
      width: 1,
      height: 1,
      layoutOptions: { 'elk.port.side': ELK_SIDE[side] },
    });
    ports.set(nodeId, list);
  };
  for (const e of d.edges) {
    addPort(e.source, e.id, 'source', e.sourceSide);
    addPort(e.target, e.id, 'target', e.targetSide);
  }

  const build = (parent: Id | null): ElkNode[] => [
    ...d.nodes
      .filter((n) => n.parent === parent)
      .map((n): ElkNode => {
        const size = sizes.get(n.id);
        const nodePorts = ports.get(n.id);
        return {
          id: n.id,
          width: size?.w,
          height: size?.h,
          ...(nodePorts
            ? { ports: nodePorts, layoutOptions: { 'elk.portConstraints': 'FIXED_SIDE' } }
            : {}),
        };
      }),
    ...d.groups
      .filter((g) => g.parent === parent)
      .map((g): ElkNode => {
        const children = build(g.id);
        return {
          id: g.id,
          layoutOptions: { 'elk.padding': GROUP_PADDING },
          ...(children.length > 0
            ? { children }
            : {
                width: MIN_CELL_W + 2 * GROUP_PAD.side,
                height: MIN_CELL_H + GROUP_PAD.top + GROUP_PAD.bottom,
              }),
        };
      }),
  ];

  const edges: ElkExtendedEdge[] = d.edges.map((e) => ({
    id: e.id,
    sources: [e.sourceSide === 'auto' ? e.source : portId(e.id, 'source')],
    targets: [e.targetSide === 'auto' ? e.target : portId(e.id, 'target')],
  }));

  return {
    id: 'root',
    layoutOptions: rootOptions(spec, { nodes: d.nodes.length, edges: d.edges.length }),
    children: build(null),
    edges,
  };
}
