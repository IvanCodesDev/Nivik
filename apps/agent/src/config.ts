export interface RuntimeConfig {
  host: string;
  port: number;
  /** Origins allowed to call the runtime (CORS). `/healthz` is always open. */
  webOrigins: string[];
  /** Delay between scripted mock events so the UI shows stage transitions during development. */
  mockPaceMs: number;
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
