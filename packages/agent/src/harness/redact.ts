/** Spec 06 §6.1: nothing that looks like a credential may reach logs, events or RunRecords. */
const PATTERNS: RegExp[] = [
  /\bsk-[A-Za-z0-9_-]{8,}/g, // OpenAI / Anthropic / DeepSeek style
  /\bAIza[0-9A-Za-z_-]{20,}/g, // Google API keys
  /\bsk-or-[A-Za-z0-9_-]{8,}/g, // OpenRouter
  /(\bBearer\s+)[A-Za-z0-9._~+/=-]+/gi,
  /(\bx-api-key\b\s*[:=]\s*["']?)[^\s"',;]+/gi,
  /(\bx-goog-api-key\b\s*[:=]\s*["']?)[^\s"',;]+/gi,
  /(\bx-nivik-authorization\b\s*[:=]\s*["']?)[^\s"',;]+/gi,
];

export function redact(text: string): string {
  let out = text;
  for (const pattern of PATTERNS) {
    out = out.replace(pattern, (_match, prefix?: string) =>
      typeof prefix === 'string' ? `${prefix}***` : '***',
    );
  }
  return out;
}
