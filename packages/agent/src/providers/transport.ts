import { RunError } from '@nivik/protocol';

export type TransportMode = 'auto' | 'direct' | 'proxy';
export type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export interface TransportOptions {
  mode: TransportMode;
  /** Agent Runtime base url; `null` when the user has not configured one. */
  runtimeUrl: string | null;
  /** Forwarded to the proxy so it can time the upstream out (spec 06 §6.2: client value + 5s). */
  timeoutMs?: number;
  onSwitch?(mode: 'proxy'): void;
  fetch?: FetchLike;
}

export interface TransportFetch {
  readonly fetch: FetchLike;
  readonly mode: TransportMode;
  /** What requests currently use; `auto` flips to `proxy` after the first CORS failure. */
  readonly effective: 'direct' | 'proxy';
}

export const PROXY_PATH = '/v1/proxy/llm';
export const UPSTREAM_HEADER = 'x-nivik-upstream';
export const AUTHORIZATION_HEADER = 'x-nivik-authorization';
export const EXTRA_HEADERS_HEADER = 'x-nivik-headers';
export const TIMEOUT_HEADER = 'x-nivik-timeout-ms';
const DEFAULT_TIMEOUT_MS = 120_000;

/** Headers that carry credentials or are only meaningful for a browser → vendor request. */
export const CREDENTIAL_HEADER_PATTERN = /^(authorization|x-api-key|x-goog-api-key|anthropic-.*)$/i;
const BROWSER_ONLY_HEADERS = new Set(['anthropic-dangerous-direct-browser-access']);

/** `fetch` rejects with a TypeError for CORS and network failures, and only for those. */
export const isCorsFailure = (error: unknown): boolean => error instanceof TypeError;

const proxyUrl = (runtimeUrl: string) => `${runtimeUrl.replace(/\/+$/, '')}${PROXY_PATH}`;

/**
 * Rewrites a vendor request into a call to the stateless runtime proxy (spec 06 §6.2): upstream
 * url and credentials travel in `x-nivik-*` headers, everything else is left as it was.
 */
export function toProxyRequest(
  url: string,
  init: RequestInit | undefined,
  runtimeUrl: string,
  timeoutMs: number,
): { url: string; init: RequestInit } {
  const headers = new Headers(init?.headers);
  const forwarded: Record<string, string> = {};
  const original: [string, string][] = [];
  headers.forEach((value, name) => {
    original.push([name, value]);
  });
  for (const [name, value] of original) {
    if (name === 'authorization') {
      headers.set(AUTHORIZATION_HEADER, value);
      headers.delete(name);
    } else if (BROWSER_ONLY_HEADERS.has(name)) {
      headers.delete(name);
    } else if (CREDENTIAL_HEADER_PATTERN.test(name)) {
      forwarded[name] = value;
      headers.delete(name);
    }
  }
  headers.set(UPSTREAM_HEADER, url);
  headers.set(TIMEOUT_HEADER, String(timeoutMs));
  if (Object.keys(forwarded).length > 0)
    headers.set(EXTRA_HEADERS_HEADER, JSON.stringify(forwarded));
  return { url: proxyUrl(runtimeUrl), init: { ...init, method: init?.method ?? 'POST', headers } };
}

/** Normalises the three `fetch(input)` shapes into a url plus init the proxy rewrite understands. */
async function normalise(
  input: string | URL | Request,
  init: RequestInit | undefined,
): Promise<{ url: string; init: RequestInit | undefined }> {
  if (typeof input === 'string') return { url: input, init };
  if (input instanceof URL) return { url: input.toString(), init };
  const request = input;
  const merged: RequestInit = {
    method: request.method,
    headers: new Headers(request.headers),
    body: request.method === 'GET' || request.method === 'HEAD' ? undefined : await request.text(),
    signal: request.signal,
    ...init,
  };
  return { url: request.url, init: merged };
}

/**
 * Spec 05 §9.4 transport. `direct` talks to the vendor, `proxy` always goes through the runtime,
 * `auto` starts direct and switches to the proxy for the rest of this instance's life the first
 * time the browser refuses the request (CORS). Without a runtime, `auto` surfaces the refusal as
 * `E_PROVIDER_CORS` so the UI can point at Settings.
 */
export function createTransportFetch(opts: TransportOptions): TransportFetch {
  const base: FetchLike = opts.fetch ?? ((input, init) => globalThis.fetch(input, init));
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  let effective: 'direct' | 'proxy' = opts.mode === 'proxy' ? 'proxy' : 'direct';

  const viaProxy = (url: string, init: RequestInit | undefined) => {
    if (!opts.runtimeUrl) {
      throw new RunError(
        'E_PROVIDER_CORS',
        'The provider refused a direct browser request and no Agent Runtime is configured to proxy it',
      );
    }
    const proxied = toProxyRequest(url, init, opts.runtimeUrl, timeoutMs);
    return base(proxied.url, proxied.init);
  };

  const fetch: FetchLike = async (input, init) => {
    const { url, init: normalised } = await normalise(input, init);
    if (effective === 'proxy') return viaProxy(url, normalised);
    try {
      return await base(url, normalised);
    } catch (error) {
      if (opts.mode !== 'auto' || !isCorsFailure(error)) throw error;
      if (!opts.runtimeUrl) {
        throw new RunError(
          'E_PROVIDER_CORS',
          'The provider refused a direct browser request and no Agent Runtime is configured to proxy it',
          { cause: error },
        );
      }
      effective = 'proxy';
      opts.onSwitch?.('proxy');
      return viaProxy(url, normalised);
    }
  };

  return {
    fetch,
    mode: opts.mode,
    get effective() {
      return effective;
    },
  };
}
