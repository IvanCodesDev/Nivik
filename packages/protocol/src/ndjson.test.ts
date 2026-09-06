import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  encodeNdjsonLine,
  LineBuffer,
  NdjsonParseError,
  ndjsonReadableStream,
  parseNdjsonStream,
  parseNdjsonText,
} from './ndjson';
import { type RunEvent, RunEventSchema } from './run-event';

const ItemSchema = z.object({ n: z.number() });

function streamOf(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
}

async function collect<T>(iterable: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const item of iterable) out.push(item);
  return out;
}

describe('LineBuffer', () => {
  it('splits lines across chunk boundaries and strips CR', () => {
    const buffer = new LineBuffer();
    expect(buffer.push('{"n":1}\n{"n"')).toEqual(['{"n":1}']);
    expect(buffer.push(':2}\r\n{"n":3}')).toEqual(['{"n":2}']);
    expect(buffer.flush()).toBe('{"n":3}');
    expect(buffer.flush()).toBeNull();
  });
});

describe('parseNdjsonStream', () => {
  it('yields validated values regardless of how the bytes are chunked', async () => {
    const text = [1, 2, 3].map((n) => encodeNdjsonLine({ n })).join('');
    const whole = await collect(parseNdjsonStream(streamOf([text]), ItemSchema));
    const bytewise = await collect(parseNdjsonStream(streamOf([...text]), ItemSchema));
    expect(whole).toEqual([{ n: 1 }, { n: 2 }, { n: 3 }]);
    expect(bytewise).toEqual(whole);
  });

  it('accepts a final line without a trailing newline and skips blank lines', async () => {
    const items = await collect(
      parseNdjsonStream(streamOf(['{"n":1}\n\n', '{"n":2}']), ItemSchema),
    );
    expect(items).toEqual([{ n: 1 }, { n: 2 }]);
  });

  it('reports the line number of the first corrupt line', async () => {
    const source = streamOf(['{"n":1}\n{"n":"two"}\n{"n":3}\n']);
    const iterator = parseNdjsonStream(source, ItemSchema);
    await expect(iterator.next()).resolves.toEqual({ value: { n: 1 }, done: false });
    await expect(iterator.next()).rejects.toMatchObject({
      name: 'NdjsonParseError',
      line: 2,
      raw: '{"n":"two"}',
    } satisfies Partial<NdjsonParseError>);
  });

  it('decodes multi-byte characters split across chunks', async () => {
    const bytes = new TextEncoder().encode(encodeNdjsonLine({ s: '流式输出' }));
    const cut = 9; // inside the first CJK character
    const chunks = [bytes.slice(0, cut), bytes.slice(cut)];
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(chunk);
        controller.close();
      },
    });
    const items = await collect(parseNdjsonStream(stream, z.object({ s: z.string() })));
    expect(items).toEqual([{ s: '流式输出' }]);
  });
});

describe('ndjsonReadableStream', () => {
  it('round-trips RunEvents through the wire format', async () => {
    const events: RunEvent[] = [
      { type: 'status', stage: 'understanding' },
      { type: 'usage', usage: { inputTokens: 1, outputTokens: 2, calls: 1 } },
      { type: 'done', runId: 'run_0123456789' },
    ];
    async function* source() {
      for (const event of events) yield event;
    }
    const stream = ndjsonReadableStream(source());
    const decoded = await collect(parseNdjsonStream(stream, RunEventSchema));
    expect(decoded).toEqual(events);
  });

  it('stops the source generator when the consumer cancels', async () => {
    let finalized = false;
    async function* source() {
      try {
        for (let i = 0; i < 1_000; i += 1) yield { n: i };
      } finally {
        finalized = true;
      }
    }
    const reader = ndjsonReadableStream(source()).getReader();
    await reader.read();
    await reader.cancel();
    expect(finalized).toBe(true);
  });
});

describe('parseNdjsonText', () => {
  it('parses a whole document and reports bad lines', () => {
    expect(parseNdjsonText('{"n":1}\r\n{"n":2}\n', ItemSchema)).toEqual([{ n: 1 }, { n: 2 }]);
    expect(() => parseNdjsonText('{"n":1}\nnope\n', ItemSchema)).toThrow(NdjsonParseError);
  });
});
