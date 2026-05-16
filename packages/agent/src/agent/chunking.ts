/**
 * Split a long text into roughly even-sized chunks suitable for embedding.
 *
 * The goal isn't perfect linguistic chunking — it's "small enough to embed
 * coherently, big enough to be useful as a retrieved excerpt". For pilot
 * scale we do:
 *
 *  1. Normalize whitespace (collapse runs, preserve paragraph breaks).
 *  2. Split on paragraph boundaries first (preserves semantic units).
 *  3. If a paragraph is larger than maxChars, break it on sentence
 *     boundaries (period / question / exclamation / Nordic punctuation).
 *  4. Pack sentences into chunks up to maxChars, with `overlap` chars of
 *     trailing context carried into the next chunk to preserve continuity
 *     across boundaries.
 */
export interface ChunkOptions {
  maxChars?: number;
  overlap?: number;
}

const DEFAULT_MAX = 500;
const DEFAULT_OVERLAP = 50;

export function chunkText(input: string, opts: ChunkOptions = {}): string[] {
  const maxChars = Math.max(50, opts.maxChars ?? DEFAULT_MAX);
  const overlap = Math.max(0, Math.min(maxChars - 1, opts.overlap ?? DEFAULT_OVERLAP));

  // Normalize: collapse runs of whitespace, preserve double newlines as
  // paragraph separators.
  const normalized = input
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  if (!normalized) return [];

  const paragraphs = normalized.split(/\n\n+/);
  const units: string[] = [];
  for (const p of paragraphs) {
    const trimmed = p.trim();
    if (!trimmed) continue;
    if (trimmed.length <= maxChars) {
      units.push(trimmed);
    } else {
      units.push(...splitSentences(trimmed));
    }
  }

  const chunks: string[] = [];
  let buf = '';
  for (const unit of units) {
    const next = buf ? `${buf} ${unit}` : unit;
    if (next.length <= maxChars) {
      buf = next;
      continue;
    }
    if (buf) {
      chunks.push(buf);
      // Seed the next buffer with the trailing `overlap` chars of the
      // previous chunk so continuity isn't lost across the seam.
      const tail = buf.slice(-overlap);
      buf = unit.length <= maxChars ? `${tail} ${unit}`.trim() : unit;
      if (buf.length > maxChars) {
        // Single unit is itself bigger than maxChars — force-split.
        chunks.push(...hardSplit(buf, maxChars, overlap));
        buf = '';
      }
    } else {
      chunks.push(...hardSplit(unit, maxChars, overlap));
      buf = '';
    }
  }
  if (buf) chunks.push(buf);
  return chunks;
}

function splitSentences(text: string): string[] {
  // Split on . ! ? followed by whitespace + capital. Conservative —
  // doesn't try to handle abbreviations. Good enough for pilot.
  return text
    .split(/(?<=[.!?])\s+(?=[A-ZÅÄÖÆØ])/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function hardSplit(text: string, maxChars: number, overlap: number): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < text.length) {
    out.push(text.slice(i, i + maxChars));
    i += Math.max(1, maxChars - overlap);
  }
  return out;
}
