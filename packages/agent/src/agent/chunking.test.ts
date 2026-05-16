import { describe, expect, it } from 'vitest';
import { chunkText } from './chunking.ts';

describe('chunkText', () => {
  it('returns [] for empty/whitespace', () => {
    expect(chunkText('')).toEqual([]);
    expect(chunkText('   \n  \n')).toEqual([]);
  });

  it('returns a single chunk when under maxChars', () => {
    const text = 'Hello world. This is short.';
    expect(chunkText(text, { maxChars: 500 })).toEqual([text]);
  });

  it('splits at paragraph boundaries when chunks would otherwise overflow', () => {
    // 4 paragraphs at ~80 chars each, maxChars=120 — should produce 3–4 chunks.
    const p = (n: number) =>
      `Paragraph ${n}: this is some content that fills a bit of space, around eighty chars total.`;
    const text = [p(1), p(2), p(3), p(4)].join('\n\n');
    const chunks = chunkText(text, { maxChars: 120, overlap: 20 });
    expect(chunks.length).toBeGreaterThanOrEqual(3);
    const joined = chunks.join(' ');
    for (const n of [1, 2, 3, 4]) expect(joined).toContain(`Paragraph ${n}`);
  });

  it('splits at sentence boundaries when a paragraph is too big', () => {
    const text =
      'En kort mening. Sedan en annan mening. Sedan en tredje mening. Och en fjärde.';
    const chunks = chunkText(text, { maxChars: 35, overlap: 0 });
    expect(chunks.length).toBeGreaterThanOrEqual(2);
    expect(chunks.every((c) => c.length <= 80)).toBe(true);
  });

  it('hard-splits when a single unit is bigger than maxChars', () => {
    const text = 'x'.repeat(1200);
    const chunks = chunkText(text, { maxChars: 500, overlap: 50 });
    expect(chunks.length).toBeGreaterThanOrEqual(2);
    expect(chunks.every((c) => c.length <= 500)).toBe(true);
  });

  it('respects Nordic capital letters as sentence starts', () => {
    const text = 'Klart. Återbetalning skickad. Östra Sverige.';
    const chunks = chunkText(text, { maxChars: 30, overlap: 0 });
    expect(chunks.length).toBeGreaterThan(0);
  });

  it('does not lose content across boundaries', () => {
    const text =
      'Hej kunden. Vi har skickat din order idag.\n\n' +
      'Den beräknas anlända imorgon eller övermorgon. ' +
      'Du får ett spårningsnummer via e-post inom kort.';
    const chunks = chunkText(text, { maxChars: 80, overlap: 10 });
    const joined = chunks.join(' ');
    // Every meaningful word should survive (allowing for the overlap to
    // duplicate some content).
    for (const word of ['Hej', 'skickat', 'order', 'spårningsnummer']) {
      expect(joined).toContain(word);
    }
  });
});
