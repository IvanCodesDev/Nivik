import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // No floating dev-tools badge (<nextjs-portal>); compile/runtime errors still surface.
  devIndicators: false,
  // Workspace packages ship TypeScript source; let Next compile them as part of the app.
  transpilePackages: ['@nivik/ui', '@nivik/protocol', '@nivik/agent'],
  images: {
    // Brand logos are tiny static files; serve them as-is.
    unoptimized: true,
  },
};

export default nextConfig;
