import type { z } from 'zod';

export class NdjsonParseError extends Error {
  readonly line: number;
  readonly raw: string;

  constructor(line: number, raw: string, message: string) {
    super(`NDJSON line ${line}: ${message}`);
    this.name = 'NdjsonParseError';
    this.line = line;
    this.raw = raw;
  }
}

export function encodeNdjsonLine(value: unknown): string {
  return `${JSON.stringify(value)}\n`;
}

/**
 * Incremental line splitter: feed arbitrary chunks, get back complete lines. Handles CRLF and
 * lines split across chunk boundaries; `flush()` returns a trailing line without a newline.
 */
export class LineBuffer {
  #pending = '';

  push(chunk: string): string[] {
    this.#pending += chunk;
    const lines: string[] = [];
    let start = 0;
    for (;;) {
      const nl = this.#pending.indexOf('\n', start);
      if (nl === -1) break;
      lines.push(stripCr(this.#pending.slice(start, nl)));
      start = nl + 1;
    }
    this.#pending = this.#pending.slice(start);
    return lines;
  }

  flush(): string | null {
    const rest = stripCr(this.#pending);
    this.#pending = '';
    return rest.length > 0 ? rest : null;
  }
}

function stripCr(line: string): string {
  return line.endsWith('\r') ? line.slice(0, -1) : line;
}

/**
 * Parse an NDJSON byte stream into validated values. Blank lines are skipped; the first
 * invalid line aborts with `NdjsonParseError` (the stream is considered corrupt past that point).
 */
export async function* parseNdjsonStream<S extends z.ZodType>(
  stream: ReadableStream<Uint8Array>,
  schema: S,
): AsyncGenerator<z.output<S>> {
  const decoder = new TextDecoder();
  const buffer = new LineBuffer();
  const reader = stream.getReader();
  let lineNo = 0;

  const parse = (raw: string): z.output<S> | undefined => {
    lineNo += 1;
    if (raw.trim().length === 0) return undefined;
    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch {
      throw new NdjsonParseError(lineNo, raw, 'invalid JSON');
    }
    const result = schema.safeParse(json);
    if (!result.success) {
      throw new NdjsonParseError(lineNo, raw, result.error.issues[0]?.message ?? 'schema mismatch');
    }
    return result.data;
  };

  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      for (const line of buffer.push(decoder.decode(value, { stream: true }))) {
        const parsed = parse(line);
        if (parsed !== undefined) yield parsed;
      }
    }
    const tail = buffer.flush();
    const last = decoder.decode();
    const rest = tail === null ? last : tail + last;
    if (rest.length > 0) {
      const parsed = parse(rest);
      if (parsed !== undefined) yield parsed;
    }
  } finally {
    reader.releaseLock();
  }
}

/** Convenience for tests and non-streaming consumers. */
export function parseNdjsonText<S extends z.ZodType>(text: string, schema: S): z.output<S>[] {
  const out: z.output<S>[] = [];
  const lines = text.split('\n');
  lines.forEach((rawLine, index) => {
    const raw = stripCr(rawLine);
    if (raw.trim().length === 0) return;
    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch {
      throw new NdjsonParseError(index + 1, raw, 'invalid JSON');
    }
    const result = schema.safeParse(json);
    if (!result.success) {
      throw new NdjsonParseError(
        index + 1,
        raw,
        result.error.issues[0]?.message ?? 'schema mismatch',
      );
    }
    out.push(result.data);
  });
  return out;
}

/** Turn an async iterable of values into an NDJSON byte stream (used by the runtime response). */
export function ndjsonReadableStream<T>(source: AsyncIterable<T>): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const iterator = source[Symbol.asyncIterator]();
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      const { value, done } = await iterator.next();
      if (done) {
        controller.close();
        return;
      }
      controller.enqueue(encoder.encode(encodeNdjsonLine(value)));
    },
    async cancel(reason) {
      await iterator.return?.(reason);
    },
  });
}
