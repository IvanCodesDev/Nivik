import type { FetchLike } from '../transport';

export interface SeenRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: Record<string, unknown> | null;
}

export const headersToRecord = (headers: Headers): Record<string, string> => {
  const out: Record<string, string> = {};
  headers.forEach((value, name) => {
    out[name] = value;
  });
  return out;
};

/** Minimal well-formed chat replies per wire format; enough for the AI SDK to parse `text` + usage. */
export const VENDOR_REPLIES = {
  openai: {
    id: 'chatcmpl-1',
    object: 'chat.completion',
    created: 1,
    model: 'm',
    choices: [{ index: 0, message: { role: 'assistant', content: 'OK' }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 3, completion_tokens: 1, total_tokens: 4 },
  },
  anthropic: {
    id: 'msg_1',
    type: 'message',
    role: 'assistant',
    model: 'm',
    content: [{ type: 'text', text: 'OK' }],
    stop_reason: 'end_turn',
    stop_sequence: null,
    usage: { input_tokens: 3, output_tokens: 1 },
  },
  google: {
    candidates: [
      { content: { role: 'model', parts: [{ text: 'OK' }] }, finishReason: 'STOP', index: 0 },
    ],
    usageMetadata: { promptTokenCount: 3, candidatesTokenCount: 1, totalTokenCount: 4 },
  },
} as const;

/** A `fetch` that records every request and answers with one fixed JSON reply. */
export function fakeVendor(reply: unknown) {
  const seen: SeenRequest[] = [];
  const fetch: FetchLike = async (input, init) => {
    const request = new Request(input, init);
    const text = request.method === 'GET' ? '' : await request.text();
    seen.push({
      url: request.url,
      method: request.method,
      headers: headersToRecord(request.headers),
      body: text ? (JSON.parse(text) as Record<string, unknown>) : null,
    });
    return new Response(JSON.stringify(reply), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };
  return { fetch, seen };
}
