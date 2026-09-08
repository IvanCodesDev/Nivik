import { type ProviderConfig, ProviderConfigSchema } from '@nivik/protocol';
import { describe, expect, it } from 'vitest';
import { contextLengthFor, KNOWN_CONTEXT_LENGTHS, listModels, probeProvider } from './probe';
import type { FetchLike } from './transport';

interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: Record<string, unknown> | null;
}

const headersToRecord = (headers: Headers): Record<string, string> => {
  const out: Record<string, string> = {};
  headers.forEach((value, name) => {
    out[name] = value;
  });
  return out;
};

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });

const completion = (message: Record<string, unknown>, finish = 'stop') =>
  json({
    id: 'c',
    object: 'chat.completion',
    created: 1,
    model: 'm',
    choices: [{ index: 0, message: { role: 'assistant', ...message }, finish_reason: finish }],
    usage: { prompt_tokens: 2, completion_tokens: 1, total_tokens: 3 },
  });

interface UpstreamOptions {
  models?: Response;
  /** Text returned for the structured-output probe; defaults to valid JSON. */
  jsonText?: string;
  /** Answer tool probes with plain text instead of a tool call. */
  ignoreTools?: boolean;
}

/** An OpenAI-compatible vendor that answers each probe the way a capable model would. */
function openAiUpstream(opts: UpstreamOptions = {}) {
  const calls: Call[] = [];
  const fetch: FetchLike = async (input, init) => {
    const request = new Request(input, init);
    const text = request.method === 'GET' ? '' : await request.text();
    const body = text ? (JSON.parse(text) as Record<string, unknown>) : null;
    calls.push({
      url: request.url,
      method: request.method,
      headers: headersToRecord(request.headers),
      body,
    });

    if (request.url.endsWith('/models')) {
      return opts.models ?? json({ object: 'list', data: [{ id: 'm2' }, { id: 'm1' }] });
    }
    const messages = (body?.messages ?? []) as { role: string; content: unknown }[];
    const hadToolResult = messages.some((m) => m.role === 'tool');
    const prompt = JSON.stringify(messages);
    if (body?.tools && !hadToolResult && !opts.ignoreTools) {
      return completion(
        {
          content: null,
          tool_calls: [
            { id: 'call_1', type: 'function', function: { name: 'ping', arguments: '{}' } },
          ],
        },
        'tool_calls',
      );
    }
    if (body?.response_format || prompt.includes('"ok"')) {
      return completion({ content: opts.jsonText ?? '{"ok":true}' });
    }
    return completion({ content: 'OK' });
  };
  return { fetch, calls };
}

const moonshot = (model = 'kimi-k2'): ProviderConfig =>
  ProviderConfigSchema.parse({
    id: 'p1',
    name: 'Moonshot',
    kind: 'moonshot',
    baseUrl: 'https://api.moonshot.cn/v1',
    model,
  });

describe('listModels (probe P1)', () => {
  it('reads OpenAI-style lists with a bearer token', async () => {
    const { fetch, calls } = openAiUpstream();
    const result = await listModels(moonshot(), 'sk-moon', { fetch });
    expect(result.models).toEqual(['m1', 'm2']);
    expect(calls[0]?.url).toBe('https://api.moonshot.cn/v1/models');
    expect(calls[0]?.headers.authorization).toBe('Bearer sk-moon');
  });

  it('reads Gemini lists with x-goog-api-key and keeps the token limits', async () => {
    const calls: Call[] = [];
    const fetch: FetchLike = async (input, init) => {
      const request = new Request(input, init);
      calls.push({
        url: request.url,
        method: request.method,
        headers: headersToRecord(request.headers),
        body: null,
      });
      return json({
        models: [
          { name: 'models/gemini-2.0-flash', inputTokenLimit: 1_048_576 },
          { name: 'models/embedding-001' },
        ],
      });
    };
    const google = ProviderConfigSchema.parse({
      id: 'g',
      name: 'Gemini',
      kind: 'google',
      baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
      model: 'gemini-2.0-flash',
    });
    const result = await listModels(google, 'g-key', { fetch });
    expect(result.models).toEqual(['embedding-001', 'gemini-2.0-flash']);
    expect(result.contextLength.get('gemini-2.0-flash')).toBe(1_048_576);
    expect(calls[0]?.headers['x-goog-api-key']).toBe('g-key');
    expect(calls[0]?.url).toBe('https://generativelanguage.googleapis.com/v1beta/models');
  });

  it('reads Anthropic lists with x-api-key and the version header', async () => {
    const calls: Call[] = [];
    const fetch: FetchLike = async (input, init) => {
      const request = new Request(input, init);
      calls.push({
        url: request.url,
        method: request.method,
        headers: headersToRecord(request.headers),
        body: null,
      });
      return json({ data: [{ id: 'claude-x', display_name: 'Claude X' }] });
    };
    const anthropic = ProviderConfigSchema.parse({
      id: 'a',
      name: 'Anthropic',
      kind: 'anthropic',
      baseUrl: 'https://api.anthropic.com/v1',
      model: 'claude-x',
    });
    expect((await listModels(anthropic, 'sk-ant', { fetch })).models).toEqual(['claude-x']);
    expect(calls[0]?.headers['x-api-key']).toBe('sk-ant');
    expect(calls[0]?.headers['anthropic-version']).toBeDefined();
  });

  it('turns HTTP failures into provider errors', async () => {
    const { fetch } = openAiUpstream({ models: json({ error: 'nope' }, 401) });
    await expect(listModels(moonshot(), 'bad', { fetch })).rejects.toMatchObject({
      code: 'E_PROVIDER_AUTH',
    });
  });
});

describe('probeProvider (spec 05 §9.3)', () => {
  it('reports every capability a cooperative model demonstrates', async () => {
    const { fetch, calls } = openAiUpstream();
    let tick = 0;
    const report = await probeProvider(moonshot(), 'sk-moon', { fetch, now: () => (tick += 100) });
    expect(report.models).toEqual(['m1', 'm2']);
    expect(report.text).toBe(true);
    expect(report.json).toBe(true);
    expect(report.tools).toBe(true);
    expect(report.vision).toBeNull();
    expect(report.latencyMs).toBe(100);
    expect(report.errors).toEqual([]);
    // No vendor figure in the list, so the known-model table answers (kimi-k2 → 128K, estimated).
    expect(report.contextLength).toEqual({ value: 131_072, estimated: true });
    expect(calls.filter((c) => c.url.endsWith('/chat/completions')).length).toBeGreaterThanOrEqual(
      3,
    );
  });

  it('keeps probing when the model list is unavailable', async () => {
    const { fetch } = openAiUpstream({ models: json({ error: 'nope' }, 401) });
    const report = await probeProvider(moonshot(), 'sk-moon', { fetch });
    expect(report.models).toBeNull();
    expect(report.errors).toEqual([
      expect.objectContaining({ probe: 'models', code: 'E_PROVIDER_AUTH' }),
    ]);
    expect(report.text).toBe(true);
    expect(report.json).toBe(true);
  });

  it('marks structured output unsupported when the model answers prose', async () => {
    const { fetch } = openAiUpstream({ jsonText: 'Sure! Here is some prose.' });
    const report = await probeProvider(moonshot(), 'sk-moon', { fetch });
    expect(report.json).toBe(false);
    expect(report.errors.map((e) => e.probe)).toEqual(['json']);
    expect(report.errors[0]?.code).toBe('E_NO_OBJECT');
    expect(report.text).toBe(true);
    expect(report.tools).toBe(true);
  });

  it('marks tools unsupported when the model never calls one', async () => {
    const { fetch } = openAiUpstream({ ignoreTools: true });
    const report = await probeProvider(moonshot(), 'sk-moon', { fetch });
    expect(report.tools).toBe(false);
    expect(report.errors).toEqual([]);
  });

  it('runs the vision probe only when asked', async () => {
    const { fetch, calls } = openAiUpstream();
    const report = await probeProvider(moonshot(), 'sk-moon', { fetch, vision: true });
    expect(report.vision).toBe(true);
    const visionCall = calls.find((c) => JSON.stringify(c.body).includes('image_url'));
    expect(visionCall).toBeDefined();
  });

  it('prefers the vendor token limit, then the known-model table, then the estimate', async () => {
    const { fetch } = openAiUpstream({
      models: json({ object: 'list', data: [{ id: 'kimi-k2', context_length: 131_072 }] }),
    });
    const fromVendor = await probeProvider(moonshot(), 'sk-moon', { fetch });
    expect(fromVendor.contextLength).toEqual({ value: 131_072, estimated: false });

    expect(contextLengthFor('gpt-4o-mini', new Map())).toEqual({
      value: KNOWN_CONTEXT_LENGTHS['gpt-4o'],
      estimated: true,
    });
    expect(contextLengthFor('totally-unknown', new Map())).toEqual({
      value: 32_768,
      estimated: true,
    });
  });

  it('never puts the key into the report', async () => {
    const { fetch } = openAiUpstream({
      models: json({ error: 'Invalid key Bearer sk-moon' }, 401),
    });
    const report = await probeProvider(moonshot(), 'sk-moon', { fetch });
    expect(JSON.stringify(report)).not.toContain('sk-moon');
  });
});
