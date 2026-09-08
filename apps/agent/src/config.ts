export interface RuntimeConfig {
  host: string;
  port: number;
  /** Origins allowed to call the runtime (CORS). `/healthz` is always open. */
  webOrigins: string[];
  /** Delay between scripted mock events so the UI shows stage transitions during development. */
  mockPaceMs: number;
  /**
   * Spec 06 §6.2: may the LLM proxy forward to loopback upstreams (self-hosted models)? On outside
   * production; `NIVIK_PROXY_ALLOW_LOCAL=1` turns it on for a production deployment that wants it.
   */
  proxyAllowLocalhost: boolean;
  version: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): RuntimeConfig {
  return {
    host: env.NIVIK_AGENT_HOST ?? '127.0.0.1',
    port: parsePort(env.NIVIK_AGENT_PORT, 3400),
    webOrigins: (env.NIVIK_WEB_ORIGIN ?? 'http://localhost:3000')
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean),
    mockPaceMs: parseNonNegative(env.NIVIK_MOCK_PACE_MS, 350),
    proxyAllowLocalhost: env.NIVIK_PROXY_ALLOW_LOCAL
      ? env.NIVIK_PROXY_ALLOW_LOCAL === '1' || env.NIVIK_PROXY_ALLOW_LOCAL === 'true'
      : env.NODE_ENV !== 'production',
    version: env.npm_package_version ?? '0.0.0',
  };
}

function parsePort(raw: string | undefined, fallback: number): number {
  const value = Number(raw);
  return Number.isInteger(value) && value > 0 && value < 65_536 ? value : fallback;
}

function parseNonNegative(raw: string | undefined, fallback: number): number {
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}
