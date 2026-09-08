import { RunError } from '@nivik/protocol';
import { describe, expect, it } from 'vitest';
import { createTransportFetch, type FetchLike, toProxyRequest } from './transport';

interface Seen {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string | null;
}

const headersToRecord = (headers: Headers): Record<string, string> => {
  const out: Record<string, string> = {};
  headers.forEach((value, name) => {
    out[name] = value;
  });
  return out;
};

function recorder(responder?: (seen: Seen, n: number) => Response | Error) {
  const seen: Seen[] = [];
  const fetch: FetchLike = async (input, init) => {
    const request = new Request(input, init);
    const entry: Seen = {
      url: request.url,
      method: request.method,
      headers: headersToRecord(request.headers),
      body: request.method === 'GET' ? null : await request.text(),
    };
    seen.push(entry);
    const out = responder?.(entry, seen.length) ?? new Response('{}', { status: 200 });
    if (out instanceof Error) throw out;
    return out;
  };
  return { fetch, seen };
}

const UPSTREAM = 'https://api.moonshot.cn/v1/chat/completions';
const RUNTIME = 'http://localhost:3400/';

describe('toProxyRequest (spec 05 §9.4, 06 §6.2)', () => {
  it('moves the upstream url and credentials into x-nivik-* headers and keeps the body', () => {
    const { url, init } = toProxyRequest(
      UPSTREAM,
      {
        method: 'POST',
        headers: { authorization: 'Bearer sk-1', 'content-type': 'application/json' },
        body: '{"a":1}',
      },
      RUNTIME,
      120_000,
    );
    expect(url).toBe('http://localhost:3400/v1/proxy/llm');
    const headers = new Headers(init.headers);
    expect(headers.get('x-nivik-upstream')).toBe(UPSTREAM);
    expect(headers.get('x-nivik-authorization')).toBe('Bearer sk-1');
    expect(headers.get('x-nivik-timeout-ms')).toBe('120000');
    expect(headers.get('content-type')).toBe('application/json');
    expect(headers.has('authorization')).toBe(false);
    expect(headers.has('x-nivik-headers')).toBe(false);
    expect(init.method).toBe('POST');
    expect(init.body).toBe('{"a":1}');
  });

  it('packs vendor credential headers into x-nivik-headers', () => {
    const { init } = toProxyRequest(
      'https://api.anthropic.com/v1/messages',
      {
        method: 'POST',
        headers: {
          'x-api-key': 'k',
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true',
          accept: 'application/json',
        },
      },
      RUNTIME,
      30_000,
    );
    const headers = new Headers(init.headers);
    expect(JSON.parse(headers.get('x-nivik-headers') ?? '{}')).toEqual({
      'x-api-key': 'k',
      'anthropic-version': '2023-06-01',
    });
    expect(headers.has('x-api-key')).toBe(false);
    expect(headers.has('anthropic-dangerous-direct-browser-access')).toBe(false);
    expect(headers.get('accept')).toBe('application/json');
  });
});

describe('createTransportFetch', () => {
  it('direct passes the request through untouched', async () => {
    const { fetch, seen } = recorder();
    const transport = createTransportFetch({ mode: 'direct', runtimeUrl: RUNTIME, fetch });
    await transport.fetch(UPSTREAM, { method: 'POST', headers: { authorization: 'Bearer x' } });
    expect(seen[0]?.url).toBe(UPSTREAM);
    expect(seen[0]?.headers.authorization).toBe('Bearer x');
    expect(transport.effective).toBe('direct');
  });

  it('proxy always goes through the runtime', async () => {
    const { fetch, seen } = recorder();
    const transport = createTransportFetch({ mode: 'proxy', runtimeUrl: RUNTIME, fetch });
    await transport.fetch(UPSTREAM, { method: 'GET', headers: { authorization: 'Bearer x' } });
    expect(seen[0]?.url).toBe('http://localhost:3400/v1/proxy/llm');
    expect(seen[0]?.headers['x-nivik-upstream']).toBe(UPSTREAM);
    expect(transport.effective).toBe('proxy');
  });

  it('auto switches to the proxy on a fetch TypeError and stays there', async () => {
    const switches: string[] = [];
    const { fetch, seen } = recorder((entry) =>
      entry.url === UPSTREAM ? new TypeError('Failed to fetch') : new Response('{}'),
    );
    const transport = createTransportFetch({
      mode: 'auto',
      runtimeUrl: RUNTIME,
      fetch,
      onSwitch: (mode) => switches.push(mode),
    });
    const first = await transport.fetch(UPSTREAM, { method: 'POST', body: '{}' });
    expect(first.status).toBe(200);
    expect(seen.map((s) => s.url)).toEqual([UPSTREAM, 'http://localhost:3400/v1/proxy/llm']);
    expect(switches).toEqual(['proxy']);
    expect(transport.effective).toBe('proxy');

    await transport.fetch(UPSTREAM, { method: 'POST', body: '{}' });
    expect(seen).toHaveLength(3);
    expect(seen[2]?.url).toBe('http://localhost:3400/v1/proxy/llm');
    expect(switches).toEqual(['proxy']);
  });

  it('auto without a runtime reports E_PROVIDER_CORS', async () => {
    const { fetch } = recorder(() => new TypeError('Failed to fetch'));
    const transport = createTransportFetch({ mode: 'auto', runtimeUrl: null, fetch });
    await expect(transport.fetch(UPSTREAM, { method: 'POST' })).rejects.toMatchObject({
      code: 'E_PROVIDER_CORS',
    });
    await expect(transport.fetch(UPSTREAM, { method: 'POST' })).rejects.toBeInstanceOf(RunError);
  });

  it('auto does not switch on HTTP errors or aborts', async () => {
    const { fetch, seen } = recorder(() => new Response('nope', { status: 401 }));
    const transport = createTransportFetch({ mode: 'auto', runtimeUrl: RUNTIME, fetch });
    const response = await transport.fetch(UPSTREAM, { method: 'POST' });
    expect(response.status).toBe(401);
    expect(seen).toHaveLength(1);
    expect(transport.effective).toBe('direct');

    const abort = recorder(() => new DOMException('The operation was aborted.', 'AbortError'));
    const t2 = createTransportFetch({ mode: 'auto', runtimeUrl: RUNTIME, fetch: abort.fetch });
    await expect(t2.fetch(UPSTREAM, { method: 'POST' })).rejects.toThrow('aborted');
    expect(abort.seen).toHaveLength(1);
  });

  it('accepts Request objects and URL instances as input', async () => {
    const { fetch, seen } = recorder();
    const transport = createTransportFetch({ mode: 'proxy', runtimeUrl: RUNTIME, fetch });
    await transport.fetch(new URL(UPSTREAM), { method: 'GET' });
    await transport.fetch(
      new Request(UPSTREAM, { method: 'POST', body: 'x', headers: { authorization: 'Bearer q' } }),
    );
    expect(seen[0]?.headers['x-nivik-upstream']).toBe(UPSTREAM);
    expect(seen[1]?.headers['x-nivik-authorization']).toBe('Bearer q');
    expect(seen[1]?.body).toBe('x');
  });
});
