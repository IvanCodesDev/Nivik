/**
 * Spec 06 §6.2: which upstreams the LLM proxy may talk to. Public https hosts only, plus loopback
 * for self-hosted models when the deployment allows it. Decisions are made on the literal host in
 * the URL; the proxy does not resolve DNS, so a public name that resolves to a private address is
 * a known boundary (documented, not defended).
 */
export type UpstreamRejection = 'invalid' | 'scheme' | 'userinfo' | 'localhost' | 'private';

export type UpstreamVerdict = { ok: true; url: URL } | { ok: false; reason: UpstreamRejection };

export interface UpstreamPolicy {
  /** Allow `http(s)://localhost`, `127.0.0.0/8` and `[::1]` (self-hosted Ollama, dev relays). */
  allowLocalhost: boolean;
}

const LOOPBACK_NAMES = new Set(['localhost', 'localhost.']);

function parseIPv4(host: string): number[] | null {
  const parts = host.split('.');
  if (parts.length !== 4) return null;
  const octets = parts.map((part) => (/^\d{1,3}$/.test(part) ? Number(part) : Number.NaN));
  return octets.every((octet) => Number.isInteger(octet) && octet >= 0 && octet <= 255)
    ? octets
    : null;
}

/** Expands an IPv6 literal (without brackets) into 8 hextets; handles `::` and a mapped IPv4 tail. */
function parseIPv6(host: string): number[] | null {
  const lower = host.toLowerCase().replace(/%.*$/, '');
  if (!/^[0-9a-f:.]+$/.test(lower) || !lower.includes(':')) return null;
  let text = lower;
  let tail: number[] = [];
  const lastColon = text.lastIndexOf(':');
  const maybeV4 = text.slice(lastColon + 1);
  if (maybeV4.includes('.')) {
    const v4 = parseIPv4(maybeV4);
    if (!v4) return null;
    tail = [
      ((v4[0] as number) << 8) | (v4[1] as number),
      ((v4[2] as number) << 8) | (v4[3] as number),
    ];
    text = text.slice(0, lastColon + 1);
  }
  const halves = text.split('::');
  if (halves.length > 2) return null;
  const toHextets = (chunk: string) =>
    chunk === ''
      ? []
      : chunk
          .split(':')
          .map((h) => (/^[0-9a-f]{1,4}$/.test(h) ? Number.parseInt(h, 16) : Number.NaN));
  const head = toHextets(halves[0] ?? '');
  const rest = halves.length === 2 ? toHextets(halves[1] ?? '') : [];
  if ([...head, ...rest].some((h) => Number.isNaN(h))) return null;
  const known = head.length + rest.length + tail.length;
  if (halves.length === 2 ? known > 7 : known !== 8) return null;
  const fill = halves.length === 2 ? new Array<number>(8 - known).fill(0) : [];
  return [...head, ...fill, ...rest, ...tail];
}

const inRange = (octets: number[], prefix: number[], bits: number): boolean => {
  const value =
    ((octets[0] as number) << 24) |
    ((octets[1] as number) << 16) |
    ((octets[2] as number) << 8) |
    (octets[3] as number);
  const base =
    ((prefix[0] as number) << 24) |
    ((prefix[1] as number) << 16) |
    ((prefix[2] as number) << 8) |
    (prefix[3] as number);
  const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
  return (value & mask) >>> 0 === (base & mask) >>> 0;
};

const isLoopbackV4 = (octets: number[]) => inRange(octets, [127, 0, 0, 0], 8);

/** RFC 1918 / 6598 / 3927 / 1122 ranges plus broadcast: never a legitimate LLM endpoint. */
const isPrivateV4 = (octets: number[]) =>
  inRange(octets, [0, 0, 0, 0], 8) ||
  inRange(octets, [10, 0, 0, 0], 8) ||
  inRange(octets, [100, 64, 0, 0], 10) ||
  inRange(octets, [169, 254, 0, 0], 16) ||
  inRange(octets, [172, 16, 0, 0], 12) ||
  inRange(octets, [192, 168, 0, 0], 16) ||
  inRange(octets, [255, 255, 255, 255], 32);

type HostClass = 'public' | 'loopback' | 'private';

function classifyHost(hostname: string): HostClass {
  const bare =
    hostname.startsWith('[') && hostname.endsWith(']') ? hostname.slice(1, -1) : hostname;
  if (LOOPBACK_NAMES.has(bare.toLowerCase()) || bare.toLowerCase().endsWith('.localhost')) {
    return 'loopback';
  }
  const v4 = parseIPv4(bare);
  if (v4) {
    if (isLoopbackV4(v4)) return 'loopback';
    return isPrivateV4(v4) ? 'private' : 'public';
  }
  const v6 = parseIPv6(bare);
  if (v6) {
    const isZero = (from: number, to: number) => v6.slice(from, to).every((h) => h === 0);
    if (isZero(0, 7) && v6[7] === 1) return 'loopback'; // ::1
    if (isZero(0, 8)) return 'private'; // ::
    if (isZero(0, 5) && v6[5] === 0xffff) {
      // ::ffff:a.b.c.d — judge the embedded IPv4.
      const mapped = [
        (v6[6] as number) >> 8,
        (v6[6] as number) & 0xff,
        (v6[7] as number) >> 8,
        (v6[7] as number) & 0xff,
      ];
      if (isLoopbackV4(mapped)) return 'loopback';
      return isPrivateV4(mapped) ? 'private' : 'public';
    }
    const first = v6[0] as number;
    if ((first & 0xfe00) === 0xfc00) return 'private'; // fc00::/7 unique local
    if ((first & 0xffc0) === 0xfe80) return 'private'; // fe80::/10 link local
    return 'public';
  }
  return 'public';
}

export function isPrivateAddress(hostname: string): boolean {
  return classifyHost(hostname) !== 'public';
}

export function checkUpstream(raw: string, policy: UpstreamPolicy): UpstreamVerdict {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, reason: 'invalid' };
  }
  if (url.username || url.password) return { ok: false, reason: 'userinfo' };
  const kind = classifyHost(url.hostname);
  if (kind === 'loopback') {
    if (!policy.allowLocalhost) return { ok: false, reason: 'localhost' };
    if (url.protocol !== 'https:' && url.protocol !== 'http:')
      return { ok: false, reason: 'scheme' };
    return { ok: true, url };
  }
  if (url.protocol !== 'https:') return { ok: false, reason: 'scheme' };
  if (kind === 'private') return { ok: false, reason: 'private' };
  return { ok: true, url };
}
