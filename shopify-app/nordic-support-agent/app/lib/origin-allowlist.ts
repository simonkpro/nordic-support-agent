/**
 * Origin allow-list check used by the public-token route and the chat
 * endpoints. Inputs are merchant-configured strings (per assistant) and
 * the browser-sent Origin/Referer header.
 *
 * Accepted entries:
 *   - "https://example.com"    exact origin match
 *   - "example.com"            scheme-agnostic host match
 *   - "*.example.com"          subdomain wildcard (matches sub.example.com,
 *                              but not example.com itself — add a second
 *                              entry for the apex if desired)
 *
 * Empty list ⇒ no restriction (back-compat for assistants created before
 * the allow-list feature shipped). Once a merchant sets even one entry,
 * the list is enforced strictly.
 *
 * Origin header is preferred; Referer is a fallback for old browsers /
 * navigations where Origin isn't sent. If neither is present and the
 * list is non-empty, the request is rejected.
 */
export function isOriginAllowed(
  origin: string | null,
  referer: string | null,
  allowedOrigins: string[],
): boolean {
  if (allowedOrigins.length === 0) return true;
  const candidate = origin?.trim() || (referer ? extractOrigin(referer) : null);
  if (!candidate) return false;
  const candidateHost = extractHost(candidate);
  if (!candidateHost) return false;
  for (const entry of allowedOrigins) {
    if (matches(entry.trim(), candidate, candidateHost)) return true;
  }
  return false;
}

function matches(entry: string, candidateOrigin: string, candidateHost: string): boolean {
  if (!entry) return false;
  if (entry === '*') return true;
  if (entry.startsWith('*.')) {
    const suffix = entry.slice(1); // ".example.com"
    return candidateHost.endsWith(suffix) && candidateHost.length > suffix.length;
  }
  if (entry.includes('://')) {
    return candidateOrigin === entry;
  }
  return candidateHost === entry;
}

function extractOrigin(refererUrl: string): string | null {
  try {
    return new URL(refererUrl).origin;
  } catch {
    return null;
  }
}

function extractHost(originOrUrl: string): string | null {
  try {
    return new URL(originOrUrl).host;
  } catch {
    return null;
  }
}
