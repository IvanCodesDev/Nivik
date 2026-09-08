import { serve } from '@hono/node-server';
import { createDefaultDeps, createMockAgent } from '@nivik/agent';
import { createApp } from './app';
import { loadConfig } from './config';

const config = loadConfig();

const log = (message: string, data?: Record<string, unknown>) => {
  const suffix = data ? ` ${JSON.stringify(data)}` : '';
  console.log(`[agent-runtime] ${message}${suffix}`);
};

// The scripted mock agent stands in until the provider-backed stages land (roadmap 1.5–1.7).
const agent = createMockAgent(
  createDefaultDeps({
    log: (level, message, data) => {
      if (level === 'debug') return;
      log(`${level}: ${message}`, data);
    },
  }),
  { paceMs: config.mockPaceMs },
);

const { app, registry } = createApp({
  agent,
  webOrigins: config.webOrigins,
  version: config.version,
  proxyAllowLocalhost: config.proxyAllowLocalhost,
  log,
});

const server = serve({ fetch: app.fetch, hostname: config.host, port: config.port }, (info) => {
  log(`listening on http://${info.address}:${info.port}`, {
    webOrigins: config.webOrigins,
    agent: 'mock',
    proxyAllowLocalhost: config.proxyAllowLocalhost,
  });
});

const shutdown = (signal: string) => {
  log(`${signal} received, shutting down`, registry.counts());
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 5_000).unref();
};
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
