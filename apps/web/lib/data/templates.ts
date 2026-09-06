export const TEMPLATE_CATEGORIES = [
  'Architecture',
  'Flowchart',
  'Business Flow',
  'Data Flow',
  'ERD',
  'Sequence',
  'System',
  'Mind Map',
] as const;
export type TemplateCategory = (typeof TEMPLATE_CATEGORIES)[number];

/** Categories that exist in the switcher but have no templates yet. */
export const COMING_SOON_CATEGORIES: readonly TemplateCategory[] = ['Mind Map'];

export type PreviewTone = 'lavender' | 'sky' | 'mint' | 'sand' | 'rose' | 'decision';

export interface TemplateNode {
  label: string;
  x: number;
  y: number;
  w: number;
  h: number;
  tone?: PreviewTone;
  shape?: 'rect' | 'diamond';
}

export interface TemplateEdge {
  from: number;
  to: number;
  label?: string;
}

export interface DiagramTemplate {
  id: string;
  title: string;
  category: TemplateCategory;
  description: string;
  /** Card background tint. */
  wash: string;
  featured?: boolean;
  width?: number;
  height: number;
  nodes: TemplateNode[];
  edges: TemplateEdge[];
}

const n = (
  label: string,
  x: number,
  y: number,
  w: number,
  h: number,
  tone?: PreviewTone,
  shape?: 'rect' | 'diamond',
): TemplateNode => ({ label, x, y, w, h, tone, shape });

const e = (from: number, to: number, label?: string): TemplateEdge => ({ from, to, label });

function customerJourney(): Pick<DiagramTemplate, 'nodes' | 'edges'> {
  const stages = ['Awareness', 'Consideration', 'Purchase', 'Retention', 'Advocacy'];
  const actions = [
    'Discover product',
    'Compare options',
    'Make purchase',
    'Use product',
    'Recommend product',
  ];
  const touchpoints = [
    'Ad / Social Media',
    'Reviews / Research',
    'Checkout Process',
    'Support / Help Center',
    'Share / Feedback',
  ];
  const nodes: TemplateNode[] = [];
  const edges: TemplateEdge[] = [];
  stages.forEach((stage, i) => {
    const x = 5 + i * 100;
    nodes.push(
      n(stage, x, 40, 92, 35, 'sky'),
      n(actions[i] ?? '', x, 115, 92, 42),
      n(touchpoints[i] ?? '', x, 193, 92, 42, 'sky'),
    );
    edges.push(e(i * 3, i * 3 + 1), e(i * 3 + 1, i * 3 + 2));
    if (i) edges.push(e((i - 1) * 3, i * 3));
  });
  return { nodes, edges };
}

/** Built-in templates. Converted to IR JSON in @nivik/templates once the IR lands (spec 00 §5.2). */
export const TEMPLATES: readonly DiagramTemplate[] = [
  {
    id: 'microservices',
    title: 'Microservices System Architecture',
    category: 'Architecture',
    featured: true,
    wash: '#f6f0fc',
    description:
      'A comprehensive architecture for a scalable microservices system with API gateway, service mesh, data layer, and observability.',
    height: 510,
    nodes: [
      n('Web App', 45, 25, 110, 45, 'sky'),
      n('Mobile App', 195, 25, 110, 45, 'sky'),
      n('Admin Portal', 345, 25, 110, 45, 'sky'),
      n('API Gateway', 165, 112, 170, 45),
      n('User Service', 20, 215, 100, 48, 'sky'),
      n('Order Service', 140, 215, 100, 48, 'mint'),
      n('Payment Service', 260, 215, 100, 48, 'sand'),
      n('Inventory Service', 380, 215, 100, 48, 'rose'),
      n('PostgreSQL', 35, 330, 125, 48, 'sky'),
      n('Redis Cache', 190, 330, 120, 48, 'rose'),
      n('S3 Storage', 340, 330, 125, 48, 'mint'),
      n('Kubernetes', 30, 430, 135, 45, 'sky'),
      n('Docker Registry', 185, 430, 135, 45, 'sky'),
      n('CI/CD Pipeline', 340, 430, 135, 45, 'sky'),
    ],
    edges: [
      e(0, 3),
      e(1, 3),
      e(2, 3),
      e(3, 4),
      e(3, 5),
      e(3, 6),
      e(3, 7),
      e(4, 8),
      e(5, 9),
      e(6, 10),
      e(8, 11),
      e(9, 12),
      e(10, 13),
    ],
  },
  {
    id: 'authentication',
    title: 'User Authentication Flow',
    category: 'Flowchart',
    wash: '#f5eefb',
    description:
      'A secure sign-in flow with credential validation, session creation, and error handling.',
    height: 435,
    nodes: [
      n('Start', 160, 10, 95, 30, 'mint'),
      n('Enter credentials', 135, 68, 145, 35),
      n('Valid user?', 137, 139, 142, 58, 'decision', 'diamond'),
      n('Show error', 330, 150, 120, 38, 'rose'),
      n('Create session', 135, 238, 145, 35),
      n('Redirect to dashboard', 115, 310, 185, 35),
      n('End', 160, 380, 95, 30, 'mint'),
    ],
    edges: [e(0, 1), e(1, 2), e(2, 3, 'No'), e(2, 4, 'Yes'), e(4, 5), e(5, 6), e(3, 1)],
  },
  {
    id: 'validation',
    title: 'Data Validation Flow',
    category: 'Flowchart',
    wash: '#fdf0f5',
    description:
      'Validate incoming data, handle errors, and process clean results through a clear decision flow.',
    height: 435,
    nodes: [
      n('Start', 155, 10, 90, 30, 'mint'),
      n('Input Data', 135, 70, 130, 35),
      n('Is Data Valid?', 135, 145, 130, 58, 'decision', 'diamond'),
      n('Show Error', 320, 156, 120, 36, 'rose'),
      n('Process Data', 135, 245, 130, 35, 'sky'),
      n('Output Result', 135, 310, 130, 35),
      n('End', 155, 380, 90, 30, 'mint'),
    ],
    edges: [e(0, 1), e(1, 2), e(2, 3, 'No'), e(2, 4, 'Yes'), e(4, 5), e(5, 6), e(3, 5)],
  },
  {
    id: 'journey',
    title: 'Customer Journey Map',
    category: 'Business Flow',
    wash: '#faf5f1',
    description:
      'Map the customer experience from awareness to advocacy, including touchpoints and customer actions.',
    height: 260,
    ...customerJourney(),
  },
  {
    id: 'ecommerce',
    title: 'E-commerce System',
    category: 'System',
    wash: '#edf9f5',
    description:
      'A scalable storefront connecting product, order, and payment services to a shared data layer.',
    height: 315,
    nodes: [
      n('Users', 200, 10, 100, 35, 'sky'),
      n('Load Balancer', 175, 75, 150, 38, 'mint'),
      n('Web App', 15, 155, 105, 38, 'mint'),
      n('Product Service', 135, 155, 105, 38, 'mint'),
      n('Order Service', 255, 155, 105, 38, 'mint'),
      n('Payment Service', 375, 155, 110, 38, 'mint'),
      n('Database', 15, 247, 105, 38, 'mint'),
      n('Cache', 135, 247, 105, 38, 'mint'),
      n('Message Queue', 255, 247, 105, 38, 'mint'),
      n('File Storage', 375, 247, 110, 38, 'mint'),
    ],
    edges: [e(0, 1), e(1, 2), e(1, 3), e(1, 4), e(1, 5), e(2, 6), e(3, 7), e(4, 8), e(5, 9)],
  },
  {
    id: 'database',
    title: 'Database Schema (ERD)',
    category: 'ERD',
    wash: '#f7f0fc',
    description:
      'A relational schema for customers, orders, products, and line items with primary and foreign keys.',
    height: 385,
    nodes: [
      n('users\nid (PK)\nname\nemail\ncreated_at', 20, 25, 125, 140),
      n('orders\nid (PK)\nuser_id (FK)\nstatus\ncreated_at', 190, 25, 125, 140),
      n('order_items\nid (PK)\norder_id (FK)\nproduct_id (FK)\nquantity', 355, 25, 130, 140),
      n('products\nid (PK)\nname\nprice\nstock', 355, 220, 130, 135),
    ],
    edges: [e(0, 1), e(1, 2), e(2, 3)],
  },
  {
    id: 'pipeline',
    title: 'CI/CD Pipeline',
    category: 'Flowchart',
    wash: '#eff5fc',
    description:
      'Automate builds, tests, staging deployments, and release checks before shipping to production.',
    width: 600,
    height: 270,
    nodes: [
      n('Code Commit', 15, 110, 70, 50, 'sky'),
      n('Build', 110, 110, 60, 50, 'sky'),
      n('Test', 195, 110, 60, 50, 'sky'),
      n('Deploy to\nStaging', 280, 110, 75, 50, 'sky'),
      n('Tests Pass?', 375, 102, 85, 66, 'decision', 'diamond'),
      n('Production', 485, 110, 90, 50, 'sky'),
    ],
    edges: [e(0, 1), e(1, 2), e(2, 3), e(3, 4), e(4, 5, 'Yes'), e(4, 2, 'No')],
  },
  {
    id: 'network',
    title: 'Infrastructure Network',
    category: 'System',
    wash: '#f8effc',
    description:
      'A virtual private cloud with public, application, and database subnets protected by a firewall.',
    height: 330,
    nodes: [
      n('Internet', 190, 15, 120, 35),
      n('Firewall', 190, 82, 120, 35),
      n('Public Subnet\nLoad Balancer', 25, 200, 135, 75, 'sky'),
      n('Private Subnet\nApp Servers', 180, 200, 135, 75),
      n('DB Subnet\nDatabase', 340, 200, 135, 75, 'sky'),
    ],
    edges: [e(0, 1), e(1, 2), e(2, 3), e(3, 4)],
  },
];

export function findTemplate(id: string | null | undefined): DiagramTemplate | undefined {
  return id ? TEMPLATES.find((t) => t.id === id) : undefined;
}

/** First line of each node label — used to build starter prompts. */
export function templateNodeNames(template: DiagramTemplate): string[] {
  return template.nodes.map((node) => node.label.split('\n')[0] ?? node.label);
}

/** Starter prompt handed to the canvas composer when a template is used. */
export function templatePrompt(template: DiagramTemplate, withAi: boolean): string {
  const names = templateNodeNames(template);
  return withAi
    ? `Build ${template.title} using this structure: ${names.join(', ')}`
    : names.slice(0, 5).join(' → ');
}
