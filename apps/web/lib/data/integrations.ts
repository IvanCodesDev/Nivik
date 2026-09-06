export type IntegrationTint = 'violet' | 'orange' | 'gray' | 'pink' | 'green' | 'blue';

export interface Integration {
  id: string;
  name: string;
  description: string;
  /** Path under /public/brands. */
  logo: string;
  tint: IntegrationTint;
  /** Logo box size in px when it differs from the 38px default. */
  logoSize?: number;
  connected: boolean;
}

/** Integration catalog shown on /integrations. Connection state is UI-only until Phase 2. */
export const INTEGRATIONS: readonly Integration[] = [
  {
    id: 'excalidraw',
    name: 'Excalidraw',
    description: 'Collaborative diagramming',
    logo: '/brands/excalidraw.png',
    tint: 'violet',
    connected: true,
  },
  {
    id: 'drawio',
    name: 'draw.io',
    description: 'Diagram editor',
    logo: '/brands/draw-io.svg',
    tint: 'orange',
    connected: true,
  },
  {
    id: 'github',
    name: 'GitHub',
    description: 'Code hosting & collaboration',
    logo: '/brands/github.svg',
    tint: 'gray',
    logoSize: 40,
    connected: true,
  },
  {
    id: 'mermaid',
    name: 'Mermaid',
    description: 'Diagram & flowchart syntax',
    logo: '/brands/mermaid.svg',
    tint: 'pink',
    connected: true,
  },
  {
    id: 'notion',
    name: 'Notion',
    description: 'Docs, wikis, and projects',
    logo: '/brands/notion.ico',
    tint: 'gray',
    logoSize: 36,
    connected: false,
  },
  {
    id: 'google-drive',
    name: 'Google Drive',
    description: 'Store and sync your files',
    logo: '/brands/google-drive.png',
    tint: 'green',
    connected: false,
  },
  {
    id: 'figma',
    name: 'Figma',
    description: 'Design files and components',
    logo: '/brands/figma.svg',
    tint: 'blue',
    connected: false,
  },
  {
    id: 'plantuml',
    name: 'PlantUML',
    description: 'UML diagrams as code',
    logo: '/brands/plantuml.png',
    tint: 'violet',
    logoSize: 42,
    connected: false,
  },
  {
    id: 'slack',
    name: 'Slack',
    description: 'Team communication',
    logo: '/brands/slack.png',
    tint: 'blue',
    connected: false,
  },
  {
    id: 'confluence',
    name: 'Confluence',
    description: 'Docs and knowledge base',
    logo: '/brands/confluence.svg',
    tint: 'blue',
    connected: false,
  },
  {
    id: 'onedrive',
    name: 'OneDrive',
    description: 'Microsoft cloud storage',
    logo: '/brands/onedrive.svg',
    tint: 'blue',
    connected: false,
  },
];

/** Renderer choices offered in the template preview dialog. */
export const RENDERERS = [
  { id: 'excalidraw', name: 'Excalidraw', logo: '/brands/excalidraw.png', color: '#4f66b8' },
  { id: 'drawio', name: 'draw.io', logo: '/brands/draw-io.svg', color: '#b46d1c' },
  { id: 'mermaid', name: 'Mermaid', logo: '/brands/mermaid.svg', color: '#aa528d' },
  { id: 'nivik', name: 'Nivik', logo: '/brand/nivik-logo.png', color: '#7455ce' },
] as const;

export type RendererId = (typeof RENDERERS)[number]['id'];
