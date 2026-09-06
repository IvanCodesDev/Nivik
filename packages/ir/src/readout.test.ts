import { describe, expect, it } from 'vitest';
import { estimateTokens, toReadout } from './readout';
import { diagram, edge, group, node } from './testing/builders';
import { orderPlatform, orderPlatformLaidOut } from './testing/order-platform';

/** Spec 01 §7.4, verbatim. */
const SPEC_EXAMPLE = `# Order Platform | type=architecture | v=12 | nodes=9 edges=10 groups=2
## groups
group edge "Edge" role=layer
group svc "Services" role=layer
## nodes
node web "Web App" type=rounded role=web
node gw "API Gateway" type=rounded role=gateway in=edge
node users "User Service" type=rounded role=service in=svc
node orders "Order Service" type=rounded role=service in=svc
node pay "Payment Service" type=rounded role=service in=svc pinned
node pg "PostgreSQL" type=cylinder role=database
node redis "Redis" type=cylinder role=cache
node mq "Kafka" type=hexagon role=queue
node stripe "Stripe" type=box role=external
## edges
edge e1 web -> gw "HTTPS"
edge e2 gw -> users "REST"
edge e3 gw -> orders "REST"
edge e4 orders -> pay "gRPC" type=dependency
edge e5 orders -> mq "OrderCreated" type=data style=dashed
edge e6 users -> pg type=data
edge e7 orders -> pg type=data
edge e8 users -> redis type=data style=dotted
edge e9 pay -> stripe "HTTPS" type=dependency
edge e10 mq -> pay "consume" type=data style=dashed
## selection
orders pay`;

const lines = (text: string) => text.split('\n');

describe('toReadout — syntax', () => {
  it('reproduces the spec §7.4 example byte for byte', () => {
    const readout = toReadout(orderPlatform(), { selection: ['orders', 'pay'] });
    expect(readout.text).toBe(SPEC_EXAMPLE);
    expect(readout.truncated).toBe(false);
    expect(readout.degraded).toEqual([]);
    expect(readout.shown).toEqual({ nodes: 9, edges: 10, groups: 2 });
  });

  it('omits default values and empty sections, and shows non-default ones', () => {
    const d = diagram({
      name: 'Tiny',
      type: 'flow',
      version: 3,
      groups: [
        group('g1', undefined, { parent: null }),
        group('g2', 'Inner', { parent: 'g1', role: 'lane' }),
      ],
      nodes: [node('a', 'A', { type: 'box', parent: 'g2' }), node('b', 'B', { type: 'box' })],
      edges: [
        edge('x', 'a', 'b', { direction: 'both' }),
        edge('y', 'b', 'a', { direction: 'none', type: 'flow' }),
      ],
    });
    expect(toReadout(d).text).toBe(
      [
        '# Tiny | type=flow | v=3 | nodes=2 edges=2 groups=2',
        '## groups',
        'group g1',
        'group g2 "Inner" parent=g1 role=lane',
        '## nodes',
        'node a "A" type=box in=g2',
        'node b "B" type=box',
        '## edges',
        'edge x a -> b dir=both',
        'edge y b -> a dir=none',
      ].join('\n'),
    );
    expect(toReadout(diagram({ name: 'Empty' })).text).toBe(
      '# Empty | type=architecture | v=1 | nodes=0 edges=0 groups=0',
    );
  });

  it('reproduces the spec §7.4 SWOT example (grid layout, cells on groups only) byte for byte', () => {
    const frame = (id: string, label: string, col: number, row: number) =>
      group(id, label, { role: 'frame', cell: { col, row, colSpan: 1, rowSpan: 1 } });
    const text = (id: string, label: string, parent: string) =>
      node(id, label, { type: 'text', parent });
    const swot = diagram({
      name: 'Q3 SWOT',
      type: 'swot',
      version: 3,
      layout: {
        algorithm: 'grid',
        direction: 'RIGHT',
        spacing: 'normal',
        edgeRouting: 'orthogonal',
        autoLayout: true,
      },
      groups: [
        frame('s', 'Strengths', 0, 0),
        frame('w', 'Weaknesses', 1, 0),
        frame('o', 'Opportunities', 0, 1),
        frame('t', 'Threats', 1, 1),
      ],
      nodes: [
        text('s1', 'Strong brand', 's'),
        text('s2', 'Low churn', 's'),
        text('w1', 'Single supplier', 'w'),
        text('w2', 'Thin margins', 'w'),
        text('o1', 'New markets', 'o'),
        text('o2', 'Partnerships', 'o'),
        text('t1', 'Price war', 't'),
        text('t2', 'Regulation', 't'),
      ],
    });
    expect(toReadout(swot).text).toBe(
      [
        '# Q3 SWOT | type=swot | layout=grid | v=3 | nodes=8 edges=0 groups=4',
        '## groups',
        'group s "Strengths" role=frame cell=0,0',
        'group w "Weaknesses" role=frame cell=1,0',
        'group o "Opportunities" role=frame cell=0,1',
        'group t "Threats" role=frame cell=1,1',
        '## nodes',
        'node s1 "Strong brand" type=text in=s',
        'node s2 "Low churn" type=text in=s',
        'node w1 "Single supplier" type=text in=w',
        'node w2 "Thin margins" type=text in=w',
        'node o1 "New markets" type=text in=o',
        'node o2 "Partnerships" type=text in=o',
        'node t1 "Price war" type=text in=t',
        'node t2 "Regulation" type=text in=t',
      ].join('\n'),
    );
  });

  it('shows non-default layout in the header, spans on cells, and line axis / arrow', () => {
    const gridLayout = {
      algorithm: 'grid',
      direction: 'RIGHT',
      spacing: 'normal',
      edgeRouting: 'orthogonal',
      autoLayout: true,
    } as const;
    const roadmap = diagram({
      name: 'Roadmap',
      type: 'roadmap',
      version: 2,
      layout: gridLayout,
      nodes: [
        node('q1', 'Q1', { type: 'box', cell: { col: 0, row: 0, colSpan: 1, rowSpan: 1 } }),
        node('q2', 'Q2', { type: 'box', cell: { col: 1, row: 0, colSpan: 2, rowSpan: 1 } }),
        node('axis', '', {
          type: 'line',
          cell: { col: 0, row: 1, colSpan: 3, rowSpan: 1 },
          data: { arrow: 'end' },
        }),
        node('div', '', { type: 'line', data: { axis: 'vertical', arrow: 'none' }, pinned: true }),
      ],
    });
    expect(toReadout(roadmap).text).toBe(
      [
        '# Roadmap | type=roadmap | layout=grid | v=2 | nodes=4 edges=0 groups=0',
        '## nodes',
        'node q1 "Q1" type=box cell=0,0',
        'node q2 "Q2" type=box cell=1,0+2x1',
        'node axis "" type=line arrow=end cell=0,1+3x1',
        'node div "" type=line axis=vertical pinned',
      ].join('\n'),
    );

    const down = diagram({
      name: 'Down',
      type: 'flow',
      layout: { ...gridLayout, algorithm: 'layered', direction: 'DOWN' },
      nodes: [node('a', 'A', { cell: { col: 0, row: 0, colSpan: 1, rowSpan: 1 } })],
    });
    expect(toReadout(down).text).toBe(
      [
        '# Down | type=flow | layout=layered DOWN | v=1 | nodes=1 edges=0 groups=0',
        '## nodes',
        'node a "A" type=rounded',
      ].join('\n'),
    );
  });

  it('escapes quotes, backslashes and newlines inside strings', () => {
    const d = diagram({
      nodes: [
        node('a', 'Say "hi"\\now', { type: 'box' }),
        node('b', 'two\nlines', { type: 'box' }),
      ],
      edges: [edge('e', 'a', 'b', { label: 'quote " here' })],
    });
    const text = toReadout(d).text;
    expect(lines(text)).toContain('node a "Say \\"hi\\"\\\\now" type=box');
    expect(lines(text)).toContain('node b "two\\nlines" type=box');
    expect(lines(text)).toContain('edge e a -> b "quote \\" here"');
  });

  it('lists only selected ids that exist, in diagram order', () => {
    const text = toReadout(orderPlatform(), { selection: ['pay', 'ghost', 'web'] }).text;
    expect(lines(text).at(-2)).toBe('## selection');
    expect(lines(text).at(-1)).toBe('web pay');
    expect(toReadout(orderPlatform(), { selection: ['ghost'] }).text).not.toContain('## selection');
  });
});

describe('toReadout — details', () => {
  it('adds descriptions only on request, cut to 80 characters', () => {
    const long = 'x'.repeat(100);
    const d = diagram({
      nodes: [
        node('a', 'A', { type: 'box', description: 'Short one' }),
        node('b', 'B', { type: 'box', description: long }),
      ],
    });
    expect(toReadout(d).text).not.toContain('desc=');
    const text = toReadout(d, { includeDescriptions: true }).text;
    expect(lines(text)).toContain('node a "A" type=box desc="Short one"');
    expect(lines(text)).toContain(`node b "B" type=box desc="${'x'.repeat(79)}…"`);
  });

  it('adds rounded geometry only on request', () => {
    const d = orderPlatformLaidOut();
    d.nodes = d.nodes.map((n) =>
      n.id === 'web'
        ? { ...n, position: { x: 40.4, y: 39.6 } }
        : n.id === 'gw'
          ? { ...n, size: undefined }
          : n,
    );
    expect(toReadout(d).text).not.toContain('@');
    const text = toReadout(d, { includeGeometry: true }).text;
    expect(lines(text)).toContain('node web "Web App" type=rounded role=web @40,40 160x64');
    expect(lines(text)).toContain(
      'node gw "API Gateway" type=rounded role=gateway in=edge @260,40',
    );
    expect(lines(text)).toContain(
      'node pay "Payment Service" type=rounded role=service in=svc pinned @260,180 160x64',
    );
  });

  it('adds typed-data details: entity columns, participant/state kind, message order, relation cardinality', () => {
    const d = diagram({
      type: 'erd',
      nodes: [
        node('users', 'users', {
          type: 'entity',
          data: {
            columns: [
              { name: 'id', type: 'int', pk: true },
              { name: 'org_id', type: 'int', fk: 'orgs', nullable: true },
              { name: 'email' },
            ],
          },
        }),
        node('orgs', 'orgs', {
          type: 'entity',
          data: { columns: [{ name: 'id', type: 'int', pk: true }] },
        }),
        node('alice', 'Alice', { type: 'participant', data: { kind: 'actor' } }),
        node('shop', 'Shop', { type: 'participant', data: { kind: 'system', order: 2 } }),
        node('s0', 'Start', { type: 'state', data: { kind: 'initial' } }),
      ],
      edges: [
        edge('r1', 'users', 'orgs', { type: 'relation', data: { cardinality: 'n-1' } }),
        edge('m1', 'alice', 'shop', {
          type: 'message',
          label: 'browse',
          data: { order: 1, kind: 'sync' },
        }),
      ],
    });
    const text = toReadout(d).text;
    expect(lines(text)).toEqual(
      expect.arrayContaining([
        'node users "users" type=entity',
        '  columns: id:int pk, org_id:int fk->orgs null, email',
        'node alice "Alice" type=participant kind=actor',
        'node shop "Shop" type=participant kind=system',
        'node s0 "Start" type=state kind=initial',
        'edge r1 users -> orgs type=relation card=n-1',
        'edge m1 alice -> shop "browse" type=message order=1',
      ]),
    );
  });

  it('summarises validation warnings and renderer annotations under ## notes', () => {
    const d = diagram({
      nodes: [
        node('lonely', 'Lonely', { type: 'box' }),
        node('a', 'A', { type: 'box' }),
        node('b', 'B', { type: 'box' }),
      ],
      edges: [edge('e', 'a', 'b')],
    });
    const text = toReadout(d, { annotations: 3 }).text;
    const tail = lines(text).slice(lines(text).indexOf('## notes'));
    expect(tail[0]).toBe('## notes');
    expect(tail[1]).toMatch(/^W_ORPHAN_NODE lonely: /);
    expect(tail[2]).toBe('annotations: 3 items (renderer-only, read-only)');
    expect(toReadout(d, { includeNotes: false }).text).not.toContain('## notes');
    expect(toReadout(orderPlatform()).text).not.toContain('## notes');
  });
});

describe('toReadout — scope', () => {
  it('keeps the selection, its N-hop neighbourhood and same-group siblings; other groups become one-line summaries', () => {
    const readout = toReadout(orderPlatform(), { scope: { selection: ['stripe'], hops: 1 } });
    expect(readout.text).toBe(
      [
        '# Order Platform | type=architecture | v=12 | nodes=9 edges=10 groups=2 | scope=selection+1hop shown nodes=2 edges=1',
        '## groups',
        'group edge "Edge" role=layer nodes=1',
        'group svc "Services" role=layer',
        '## nodes',
        'node pay "Payment Service" type=rounded role=service in=svc pinned',
        'node stripe "Stripe" type=box role=external',
        '## edges',
        'edge e9 pay -> stripe "HTTPS" type=dependency',
        '## selection',
        'stripe',
      ].join('\n'),
    );
    expect(readout.shown).toEqual({ nodes: 2, edges: 1, groups: 1 });
  });

  it('expands siblings of selected nodes inside a group and can be told not to', () => {
    const withSiblings = toReadout(orderPlatform(), { scope: { selection: ['pay'], hops: 1 } });
    // 1 hop from pay: orders, stripe, mq; siblings in svc: users
    expect(
      lines(withSiblings.text)
        .filter((l) => l.startsWith('node '))
        .map((l) => l.split(' ')[1]),
    ).toEqual(['users', 'orders', 'pay', 'mq', 'stripe']);
    const bare = toReadout(orderPlatform(), {
      scope: { selection: ['pay'], hops: 1 },
      includeSiblings: false,
    });
    expect(
      lines(bare.text)
        .filter((l) => l.startsWith('node '))
        .map((l) => l.split(' ')[1]),
    ).toEqual(['orders', 'pay', 'mq', 'stripe']);
  });

  it('only keeps notes about shown elements', () => {
    const d = diagram({
      nodes: [
        node('lonely', 'Lonely', { type: 'box' }),
        node('a', 'A', { type: 'box' }),
        node('b', 'B', { type: 'box' }),
      ],
      edges: [edge('e', 'a', 'b')],
    });
    expect(toReadout(d, { scope: { selection: ['a'], hops: 1 } }).text).not.toContain(
      'W_ORPHAN_NODE',
    );
    expect(toReadout(d, { scope: { selection: ['lonely'], hops: 1 } }).text).toContain(
      'W_ORPHAN_NODE',
    );
  });
});

describe('toReadout — token budget', () => {
  const big = () => {
    const d = orderPlatform();
    d.nodes = d.nodes.map((n) => ({
      ...n,
      description: `Handles ${n.label} traffic and persistence for the platform`,
    }));
    // a duplicate of e4 next to the selection so `## notes` has content inside the scope
    d.edges.push(edge('e4b', 'orders', 'pay', { label: 'gRPC', type: 'dependency' }));
    return d;
  };
  const opts = {
    scope: { selection: ['orders'] as string[], hops: 2 as const },
    includeDescriptions: true,
  };

  it('estimates tokens roughly at four characters per token, CJK at one', () => {
    expect(estimateTokens('')).toBe(0);
    expect(estimateTokens('abcdefgh')).toBe(2);
    expect(estimateTokens('订单服务')).toBe(4);
  });

  it('degrades step by step until the text fits', () => {
    const full = toReadout(big(), opts);
    expect(full.degraded).toEqual([]);
    expect(full.text).toContain('desc=');

    const noDesc = toReadout(big(), { ...opts, includeDescriptions: false });
    const step1 = toReadout(big(), { ...opts, maxTokens: noDesc.tokens });
    expect(step1.degraded).toEqual(['descriptions']);
    expect(step1.text).toBe(noDesc.text);

    const noNotes = toReadout(big(), { ...opts, includeDescriptions: false, includeNotes: false });
    const step2 = toReadout(big(), { ...opts, maxTokens: noNotes.tokens });
    expect(step2.degraded).toEqual(['descriptions', 'notes']);
    expect(step2.text).toBe(noNotes.text);

    const oneHop = toReadout(big(), {
      scope: { selection: ['orders'], hops: 1 },
      includeDescriptions: false,
      includeNotes: false,
    });
    const step3 = toReadout(big(), { ...opts, maxTokens: oneHop.tokens });
    expect(step3.degraded).toEqual(['descriptions', 'notes', 'hops']);
    expect(step3.text).toBe(oneHop.text);

    const noSiblings = toReadout(big(), {
      scope: { selection: ['orders'], hops: 1 },
      includeDescriptions: false,
      includeNotes: false,
      includeSiblings: false,
    });
    const step4 = toReadout(big(), { ...opts, maxTokens: noSiblings.tokens });
    expect(step4.degraded).toEqual(['descriptions', 'notes', 'hops', 'siblings']);
    expect(step4.text).toBe(noSiblings.text);
    expect(step4.truncated).toBe(false);

    const step5 = toReadout(big(), { ...opts, maxTokens: 10 });
    expect(step5.degraded).toEqual(['descriptions', 'notes', 'hops', 'siblings']);
    expect(step5.truncated).toBe(true);
    expect(step5.text).toBe(noSiblings.text);
  });

  it('with scope "all" the hop and sibling steps have nothing to trim', () => {
    const readout = toReadout(big(), { includeDescriptions: true, maxTokens: 10 });
    expect(readout.degraded).toEqual(['descriptions', 'notes']);
    expect(readout.truncated).toBe(true);
  });
});
