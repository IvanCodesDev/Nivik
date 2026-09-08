import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // No floating dev-tools badge (<nextjs-portal>); compile/runtime errors still surface.
  devIndicators: false,
  // Workspace packages ship TypeScript source; let Next compile them as part of the app.
  transpilePackages: [
    '@nivik/agent',
    '@nivik/ir',
    '@nivik/layout',
    '@nivik/protocol',
    '@nivik/renderer-core',
    '@nivik/renderer-excalidraw',
    '@nivik/storage',
    '@nivik/templates',
    '@nivik/ui',
  ],
  images: {
    // Brand logos are tiny static files; serve them as-is.
    unoptimized: true,
  },
};

export default nextConfig;
