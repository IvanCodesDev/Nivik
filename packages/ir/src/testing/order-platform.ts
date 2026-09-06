/** The spec §7.4 "Order Platform" example diagram (used by schema, index and readout tests). */
import type { Diagram } from '../schema';
import { diagram, edge, group, node } from './builders';

export const orderPlatform = (): Diagram =>
  diagram({
    id: 'd_orderplat',
    name: 'Order Platform',
    type: 'architecture',
    version: 12,
    groups: [group('edge', 'Edge', { role: 'layer' }), group('svc', 'Services', { role: 'layer' })],
    nodes: [
      node('web', 'Web App', { role: 'web' }),
      node('gw', 'API Gateway', { role: 'gateway', parent: 'edge' }),
      node('users', 'User Service', { role: 'service', parent: 'svc' }),
      node('orders', 'Order Service', { role: 'service', parent: 'svc' }),
      node('pay', 'Payment Service', { role: 'service', parent: 'svc', pinned: true }),
      node('pg', 'PostgreSQL', { type: 'cylinder', role: 'database' }),
      node('redis', 'Redis', { type: 'cylinder', role: 'cache' }),
      node('mq', 'Kafka', { type: 'hexagon', role: 'queue' }),
      node('stripe', 'Stripe', { type: 'box', role: 'external' }),
    ],
    edges: [
      edge('e1', 'web', 'gw', { label: 'HTTPS' }),
      edge('e2', 'gw', 'users', { label: 'REST' }),
      edge('e3', 'gw', 'orders', { label: 'REST' }),
      edge('e4', 'orders', 'pay', { label: 'gRPC', type: 'dependency' }),
      edge('e5', 'orders', 'mq', {
        label: 'OrderCreated',
        type: 'data',
        style: { stroke: 'dashed' },
      }),
      edge('e6', 'users', 'pg', { type: 'data' }),
      edge('e7', 'orders', 'pg', { type: 'data' }),
      edge('e8', 'users', 'redis', { type: 'data', style: { stroke: 'dotted' } }),
      edge('e9', 'pay', 'stripe', { label: 'HTTPS', type: 'dependency' }),
      edge('e10', 'mq', 'pay', { label: 'consume', type: 'data', style: { stroke: 'dashed' } }),
    ],
  });
