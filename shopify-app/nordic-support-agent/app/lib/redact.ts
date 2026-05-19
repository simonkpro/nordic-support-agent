/**
 * Redacts the highest-risk PII patterns that show up in customer chat
 * before strings hit our logs. We keep order numbers and first names —
 * they're useful for debugging and aren't sensitive on their own — and
 * strip the things that are either regulated (personnummer, card PAN)
 * or directly identifying (email, phone).
 *
 * Order matters: card → personnummer → phone → email. Card and
 * personnummer regexes both match digit runs; running card first prevents
 * a 12-digit card from being misclassified as a Swedish personal id.
 *
 * Intentionally conservative — we'd rather over-redact a phone-like
 * number in a log line than leak one. Not a security boundary by itself;
 * the boundaries are "don't log success-path message bodies" and
 * "AI Gateway is ZDR". This is the third line of defense.
 */

const CARD_RE = /\b(?:\d[ -]?){13,19}\b/g;
const PERSONNUMMER_RE = /\b(?:19|20)?\d{6}[- ]?\d{4}\b/g;
const PHONE_RE = /(?:\+?\d[\d\s\-]{7,}\d)/g;
const EMAIL_RE = /[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}/g;

export function redactPii(input: string): string {
  if (!input) return input;
  return input
    .replace(CARD_RE, (m) => (looksLikeCard(m) ? '[REDACTED_CARD]' : m))
    .replace(PERSONNUMMER_RE, '[REDACTED_PERSONNUMMER]')
    .replace(PHONE_RE, (m) => (looksLikePhone(m) ? '[REDACTED_PHONE]' : m))
    .replace(EMAIL_RE, '[REDACTED_EMAIL]');
}

function looksLikeCard(s: string): boolean {
  const digits = s.replace(/\D/g, '');
  if (digits.length < 13 || digits.length > 19) return false;
  let sum = 0;
  let alt = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let n = digits.charCodeAt(i) - 48;
    if (alt) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
    alt = !alt;
  }
  return sum % 10 === 0;
}

function looksLikePhone(s: string): boolean {
  const digits = s.replace(/\D/g, '');
  return digits.length >= 8 && digits.length <= 15;
}

/**
 * Drop-in for console.error in handlers — redacts string args and the
 * `.message` of any Error before they hit stdout. Pass the same arglist
 * you'd pass to console.error.
 */
export function logErrorRedacted(...args: unknown[]): void {
  console.error(...args.map(redactArg));
}

function redactArg(a: unknown): unknown {
  if (typeof a === 'string') return redactPii(a);
  if (a instanceof Error) {
    const safe = new Error(redactPii(a.message));
    safe.name = a.name;
    safe.stack = a.stack ? redactPii(a.stack) : undefined;
    return safe;
  }
  return a;
}
