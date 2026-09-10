import type { ResolvedSource } from '@nivik/protocol';

export interface SourceChunk {
  sourceId: string;
  title: string;
  index: number;
  text: string;
}

const CHUNK_CHARS = 800;

/** Paragraph-aligned chunks of roughly 800 characters; the unit of search and of `readSource`. */
export function chunkSource(source: ResolvedSource): SourceChunk[] {
  const paragraphs = source.text
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);
  const chunks: SourceChunk[] = [];
  let buffer = '';
  const flush = () => {
    if (buffer.trim()) {
      chunks.push({
        sourceId: source.id,
        title: source.title,
        index: chunks.length,
        text: buffer.trim(),
      });
    }
    buffer = '';
  };
  for (const paragraph of paragraphs) {
    if (paragraph.length > CHUNK_CHARS) {
      flush();
      for (let i = 0; i < paragraph.length; i += CHUNK_CHARS) {
        buffer = paragraph.slice(i, i + CHUNK_CHARS);
        flush();
      }
      continue;
    }
    if (buffer.length + paragraph.length + 2 > CHUNK_CHARS) flush();
    buffer = buffer ? `${buffer}\n\n${paragraph}` : paragraph;
  }
  flush();
  return chunks;
}

const tokenize = (text: string): string[] =>
  text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t.length > 1);

export interface SearchHit extends SourceChunk {
  score: number;
}

/**
 * Spec 09 §3.3 `searchSources`: BM25 over paragraph chunks, no vector store. Good enough to point
 * the model at the right passage of a design doc; `readSource` then returns it verbatim.
 */
export function searchSources(
  sources: readonly ResolvedSource[],
  query: string,
  limit = 3,
): SearchHit[] {
  const chunks = sources.flatMap(chunkSource);
  if (chunks.length === 0) return [];
  const terms = tokenize(query);
  if (terms.length === 0) return [];
  const docs = chunks.map((chunk) => tokenize(chunk.text));
  const avgLen = docs.reduce((sum, d) => sum + d.length, 0) / docs.length || 1;
  const df = new Map<string, number>();
  for (const doc of docs) {
    for (const term of new Set(doc)) df.set(term, (df.get(term) ?? 0) + 1);
  }
  const k1 = 1.2;
  const b = 0.75;
  const n = docs.length;
  const hits: SearchHit[] = [];
  docs.forEach((doc, i) => {
    const tf = new Map<string, number>();
    for (const term of doc) tf.set(term, (tf.get(term) ?? 0) + 1);
    let score = 0;
    for (const term of terms) {
      const f = tf.get(term) ?? 0;
      if (f === 0) continue;
      const idf = Math.log(1 + (n - (df.get(term) ?? 0) + 0.5) / ((df.get(term) ?? 0) + 0.5));
      score += idf * ((f * (k1 + 1)) / (f + k1 * (1 - b + (b * doc.length) / avgLen)));
    }
    if (score > 0) hits.push({ ...(chunks[i] as SourceChunk), score });
  });
  return hits
    .sort(
      (a, b2) => b2.score - a.score || a.sourceId.localeCompare(b2.sourceId) || a.index - b2.index,
    )
    .slice(0, Math.max(1, Math.min(limit, 5)));
}

export interface ReadSourceInput {
  sourceId: string;
  /** Chunk range, inclusive; defaults to the first two chunks. */
  from?: number;
  to?: number;
}

/** Spec 09 §3.3 `readSource`: a source passage verbatim, capped so one call stays ≤ ~1.5K tokens. */
export function readSource(
  sources: readonly ResolvedSource[],
  input: ReadSourceInput,
): { title: string; text: string; chunks: number; from: number; to: number } | null {
  const source = sources.find((s) => s.id === input.sourceId);
  if (!source) return null;
  const chunks = chunkSource(source);
  const from = Math.max(0, Math.min(input.from ?? 0, Math.max(0, chunks.length - 1)));
  const to = Math.max(from, Math.min(input.to ?? from + 1, chunks.length - 1, from + 3));
  return {
    title: source.title,
    text: chunks
      .slice(from, to + 1)
      .map((c) => c.text)
      .join('\n\n'),
    chunks: chunks.length,
    from,
    to,
  };
}
