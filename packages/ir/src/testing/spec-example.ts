/** Spec 02 §9: the AI edit "introduce a Kafka topic between Order and Payment" (raw JSON, unparsed). */
export const specExampleChangeSet = () => ({
  id: 'cs_9f3k2a1b',
  diagramId: 'd_ab12cd34',
  baseVersion: 12,
  origin: 'ai',
  runId: 'run_77x',
  summary: 'Introduce Kafka topic between Order and Payment; mark Payment as external-style',
  createdAt: 1_788_000_000_000,
  actions: [
    {
      op: 'addNode',
      node: {
        id: 'order-events',
        type: 'hexagon',
        label: 'order-events',
        role: 'topic',
        parent: 'svc',
        near: 'orders',
      },
    },
    { op: 'deleteEdge', id: 'e4' },
    {
      op: 'addEdge',
      edge: {
        id: 'e11',
        source: 'orders',
        target: 'order-events',
        type: 'data',
        label: 'publish',
        style: { stroke: 'dashed' },
      },
    },
    {
      op: 'addEdge',
      edge: {
        id: 'e12',
        source: 'order-events',
        target: 'pay',
        type: 'data',
        label: 'consume',
        style: { stroke: 'dashed' },
      },
    },
    { op: 'setStyle', targets: ['pay'], style: { palette: 'sand', emphasis: 'muted' } },
  ],
});
