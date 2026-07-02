import { Agent, fetch as undiciFetch } from 'undici';
import { lookup as dnsLookup } from 'node:dns';
import { isIP } from 'node:net';

/**
 * SSRF-hardened fetch for user-supplied URLs (the sitemap crawler lets a
 * merchant point us at an arbitrary URL, and the fetched body is ingested
 * into their knowledge base — so an unguarded fetch is a read/exfil
 * channel into the cloud metadata service and the internal network).
 *
 * Defenses, all at the single choke point below:
 *   1. Scheme allowlist — http/https only (no file:, ftp:, etc.).
 *   2. DNS + IP validation AT CONNECT TIME, inside undici's Agent.lookup.
 *      Every resolved address is checked against private/reserved ranges,
 *      and the connection is pinned to the validated address — so there is
 *      no TOCTOU window for DNS rebinding between our check and the socket.
 *      Because validation happens in the connector, it also covers every
 *      redirect hop automatically.
 *   3. Manual redirect following with a hop cap and per-hop scheme
 *      re-validation (redirect: 'manual').
 *   4. Response-size cap enforced while streaming (a huge body can't be
 *      buffered to exhaust memory), plus a total timeout.
 *
 * The rule for IPv6 is deliberately coarse-but-safe: only global-unicast
 * space (2000::/3) is allowed. Everything else — loopback, ULA, link-local,
 * multicast, IPv4-mapped, NAT64 — is rejected, which also neutralises
 * mapped/embedded-IPv4 tricks without hand-parsing every form.
 */

const DEFAULT_TIMEOUT_MS = 15_000;
const MAX_REDIRECTS = 5;
const MAX_RESPONSE_BYTES = 5 * 1024 * 1024; // 5 MB

/** True if a resolved IP literal is in a private/reserved/loopback range. */
export function isBlockedAddress(ip: string): boolean {
  const family = isIP(ip);
  if (family === 4) return isBlockedIpv4(ip);
  if (family === 6) return isBlockedIpv6(ip);
  return true; // not a parseable IP — fail closed
}

function isBlockedIpv4(ip: string): boolean {
  const parts = ip.split('.').map((p) => Number(p));
  if (parts.length !== 4 || parts.some((p) => !Number.isInteger(p) || p < 0 || p > 255)) {
    return true;
  }
  const [a, b] = parts as [number, number, number, number];
  if (a === 0) return true; // 0.0.0.0/8 "this network"
  if (a === 10) return true; // 10.0.0.0/8 private
  if (a === 127) return true; // 127.0.0.0/8 loopback
  if (a === 169 && b === 254) return true; // 169.254.0.0/16 link-local (cloud metadata)
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12 private
  if (a === 192 && b === 168) return true; // 192.168.0.0/16 private
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10 CGNAT
  if (a === 192 && b === 0) return true; // 192.0.0.0/24 + 192.0.2.0/24
  if (a === 198 && (b === 18 || b === 19)) return true; // 198.18.0.0/15 benchmark
  if (a >= 224) return true; // 224.0.0.0/4 multicast + 240.0.0.0/4 reserved + 255.255.255.255
  return false;
}

function isBlockedIpv6(ip: string): boolean {
  // Strip a zone id if present, then read the first hextet. Only the
  // global-unicast block 2000::/3 (first hextet 0x2000–0x3fff) is allowed.
  const bare = ip.split('%')[0]!.toLowerCase();
  if (bare.startsWith('::')) return true; // ::1, ::, ::ffff:… all start compressed → block
  const firstGroup = bare.split(':')[0];
  if (!firstGroup) return true;
  const value = parseInt(firstGroup, 16);
  if (Number.isNaN(value)) return true;
  return !(value >= 0x2000 && value <= 0x3fff);
}

/** undici Agent lookup that validates + pins every resolved address. */
function safeLookup(
  hostname: string,
  options: { family?: number; all?: boolean; [k: string]: unknown },
  callback: (
    err: NodeJS.ErrnoException | null,
    address?: string | Array<{ address: string; family: number }>,
    family?: number,
  ) => void,
): void {
  dnsLookup(hostname, { ...options, all: true, verbatim: true }, (err, addresses) => {
    if (err) return callback(err);
    const list = addresses as unknown as Array<{ address: string; family: number }>;
    if (!list.length) {
      return callback(new Error(`DNS returned no records for ${hostname}`));
    }
    for (const a of list) {
      if (isBlockedAddress(a.address)) {
        return callback(
          new Error(`Blocked request to private/reserved address ${a.address} (${hostname})`),
        );
      }
    }
    if (options.all) return callback(null, list);
    const first = list[0]!;
    return callback(null, first.address, first.family);
  });
}

let sharedAgent: Agent | null = null;
function getAgent(): Agent {
  if (!sharedAgent) {
    // Redirects are followed manually (redirect: 'manual' on each fetch) so
    // every hop is scheme-checked; the connector re-validates each IP.
    sharedAgent = new Agent({
      connect: { lookup: safeLookup as never, timeout: DEFAULT_TIMEOUT_MS },
    });
  }
  return sharedAgent;
}

function assertUrlAllowed(u: URL): void {
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    throw new Error(`Refusing non-http(s) URL: ${u.protocol}//…`);
  }
  // undici does NOT run the Agent.lookup for a literal-IP host (there's
  // nothing to resolve), so the connect-time guard would be bypassed by
  // e.g. http://169.254.169.254/. Validate literal IPs here up front, on
  // the initial URL and every redirect hop. Hostname targets still go
  // through safeLookup, which closes the DNS-rebinding path.
  const host = u.hostname.replace(/^\[/, '').replace(/\]$/, ''); // unwrap [::1]
  if (isIP(host) && isBlockedAddress(host)) {
    throw new Error(`Blocked request to private/reserved address ${host}`);
  }
}

export interface SafeFetchResult {
  ok: boolean;
  status: number;
  contentType: string;
  /** Response headers, lowercased keys. */
  headers: Record<string, string>;
  text: string;
}

/**
 * Fetch a user-supplied URL safely and return the (size-capped) body as
 * text. Throws on blocked address, bad scheme, too many redirects, or
 * timeout. Callers get the same shape regardless of hop count.
 */
export async function safeFetchText(
  rawUrl: string,
  opts: { timeoutMs?: number; userAgent?: string } = {},
): Promise<SafeFetchResult> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    let current = new URL(rawUrl);
    assertUrlAllowed(current);

    let res: Awaited<ReturnType<typeof undiciFetch>> | null = null;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      res = await undiciFetch(current.toString(), {
        dispatcher: getAgent(),
        redirect: 'manual',
        signal: ctrl.signal,
        headers: {
          'user-agent': opts.userAgent ?? 'VitrioBot/1.0 (+sitemap crawler)',
          accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        },
      });

      if (res.status >= 300 && res.status < 400) {
        const location = res.headers.get('location');
        await res.body?.cancel().catch(() => undefined);
        if (!location) break; // 3xx without Location — treat as final
        if (hop === MAX_REDIRECTS) {
          throw new Error(`Too many redirects (>${MAX_REDIRECTS}) from ${rawUrl}`);
        }
        current = new URL(location, current); // resolve relative redirects
        assertUrlAllowed(current);
        continue;
      }
      break;
    }
    if (!res) throw new Error(`No response for ${rawUrl}`);

    const contentType = res.headers.get('content-type') ?? '';

    // Reject over-large bodies up front when the server is honest…
    const declared = Number(res.headers.get('content-length') ?? '0');
    if (declared > MAX_RESPONSE_BYTES) {
      await res.body?.cancel().catch(() => undefined);
      throw new Error(`Response too large (${declared} bytes) for ${rawUrl}`);
    }

    const headers: Record<string, string> = {};
    res.headers.forEach((value, key) => {
      headers[key.toLowerCase()] = value;
    });

    // …and enforce the cap while streaming for chunked/lying responses.
    const text = await readCapped(
      res.body as unknown as ReadableStream<Uint8Array> | null,
      MAX_RESPONSE_BYTES,
      rawUrl,
    );
    return { ok: res.ok, status: res.status, contentType, headers, text };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Best-effort check of whether a page can be embedded in an <iframe> from a
 * different origin. Reads X-Frame-Options and CSP frame-ancestors. Used by
 * the client-demo generator to warn before a demo link is sent. Fails open
 * (assumes framable) if the site can't be reached — the demo page will just
 * show a fallback if the iframe really is blocked.
 */
export async function checkFramable(
  rawUrl: string,
): Promise<{ framable: boolean; reason?: string }> {
  let res: SafeFetchResult;
  try {
    res = await safeFetchText(rawUrl, { timeoutMs: 8000 });
  } catch {
    return { framable: true }; // can't tell — don't block the demo
  }
  const xfo = (res.headers['x-frame-options'] ?? '').toLowerCase();
  if (xfo.includes('deny') || xfo.includes('sameorigin')) {
    return { framable: false, reason: 'X-Frame-Options: ' + xfo.trim() };
  }
  const csp = res.headers['content-security-policy'] ?? '';
  const fa = /frame-ancestors\s+([^;]+)/i.exec(csp);
  if (fa) {
    // A frame-ancestors directive is present, so it restricts embedding.
    // We can embed only if it's a wildcard or explicitly names vitrio.se;
    // 'self'/'none'/other origins all mean we're blocked.
    const value = fa[1]!.toLowerCase();
    const allowsUs =
      value.includes('*') || /https?:\/\/([a-z0-9-]+\.)?vitrio\.se/.test(value);
    if (!allowsUs) return { framable: false, reason: 'CSP frame-ancestors' };
  }
  return { framable: true };
}

async function readCapped(
  body: ReadableStream<Uint8Array> | null,
  cap: number,
  url: string,
): Promise<string> {
  if (!body) return '';
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > cap) {
        await reader.cancel().catch(() => undefined);
        throw new Error(`Response exceeded ${cap} bytes for ${url}`);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    merged.set(c, offset);
    offset += c.byteLength;
  }
  return new TextDecoder('utf-8').decode(merged);
}
