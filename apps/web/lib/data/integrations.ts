export type IntegrationTint = 'violet' | 'orange' | 'gray' | 'pink' | 'green' | 'blue';

export const INTEGRATION_IDS = [
  'excalidraw',
  'drawio',
  'github',
  'mermaid',
  'notion',
  'google-drive',
  'figma',
  'plantuml',
  'slack',
  'confluence',
  'onedrive',
] as const;
export type IntegrationId = (typeof INTEGRATION_IDS)[number];

/** Descriptions come from the dictionaries (`t.integrations.descriptions[id]`). */
export interface Integration {
  id: IntegrationId;
  name: string;
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
    logo: '/brands/excalidraw.png',
    tint: 'violet',
    connected: true,
  },
  {
    id: 'drawio',
    name: 'draw.io',
    logo: '/brands/draw-io.svg',
    tint: 'orange',
    connected: true,
  },
  {
    id: 'github',
    name: 'GitHub',
    logo: '/brands/github.svg',
    tint: 'gray',
    logoSize: 40,
    connected: true,
  },
  {
    id: 'mermaid',
    name: 'Mermaid',
    logo: '/brands/mermaid.svg',
    tint: 'pink',
    connected: true,
  },
  {
    id: 'notion',
    name: 'Notion',
    logo: '/brands/notion.ico',
    tint: 'gray',
    logoSize: 36,
    connected: false,
  },
  {
    id: 'google-drive',
    name: 'Google Drive',
    logo: '/brands/google-drive.png',
    tint: 'green',
    connected: false,
  },
  {
    id: 'figma',
    name: 'Figma',
    logo: '/brands/figma.svg',
    tint: 'blue',
    connected: false,
  },
  {
    id: 'plantuml',
    name: 'PlantUML',
    logo: '/brands/plantuml.png',
    tint: 'violet',
    logoSize: 42,
    connected: false,
  },
  {
    id: 'slack',
    name: 'Slack',
    logo: '/brands/slack.png',
    tint: 'blue',
    connected: false,
  },
  {
    id: 'confluence',
    name: 'Confluence',
    logo: '/brands/confluence.svg',
    tint: 'blue',
    connected: false,
  },
  {
    id: 'onedrive',
    name: 'OneDrive',
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
