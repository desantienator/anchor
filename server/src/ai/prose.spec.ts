import { describe, expect, it } from 'vitest';
import { chunkSegments, proseSegments, tagExcerpt } from './prose';

const delta = (ops: unknown[]) => JSON.stringify({ ops });

describe('proseSegments', () => {
  it('returns exact offsets into plain text for simple prose', () => {
    const { segments, totalChars } = proseSegments(
      delta([{ insert: 'teh cat\n' }, { insert: 'sat\n' }]),
    );

    expect(segments).toEqual([
      { id: 's0', offset: 0, text: 'teh cat' },
      { id: 's1', offset: 8, text: 'sat' },
    ]);
    expect(totalChars).toBe(10);
  });

  it('skips code, links, URLs and embeds', () => {
    const { segments } = proseSegments(
      delta([
        { insert: 'see ' },
        {
          insert: 'https://example.com',
          attributes: { link: 'https://example.com' },
        },
        { insert: ' and\n' },
        { insert: 'run()', attributes: { 'code-block': true } },
        { insert: '\n' },
        { insert: { image: 'x' } },
        { insert: 'mail a@b.co\n' },
        { insert: 'the end\n' },
      ]),
    );

    expect(segments.map((segment) => segment.text)).toEqual([
      'see ',
      ' and',
      'the end',
    ]);
  });

  it('accepts a bare operation array and legacy plain text', () => {
    expect(
      proseSegments(JSON.stringify([{ insert: 'hello\n' }])).segments,
    ).toEqual([{ id: 's0', offset: 0, text: 'hello' }]);
    expect(proseSegments('just words').invalid).toBe(true);
  });

  it('flags content it cannot parse instead of guessing', () => {
    expect(proseSegments('{not json').invalid).toBe(true);
  });
});

describe('chunkSegments', () => {
  it('never splits a segment and respects the budget', () => {
    const segments = ['a'.repeat(4), 'b'.repeat(4), 'c'.repeat(8)].map(
      (text, index) => ({ id: `s${index}`, offset: 0, text }),
    );

    const chunks = chunkSegments(segments, 8, 5);

    expect(chunks.map((chunk) => chunk.map((s) => s.id))).toEqual([
      ['s0', 's1'],
      ['s2'],
    ]);
  });

  it('skips a segment larger than the whole budget instead of truncating it', () => {
    const segments = [
      { id: 's0', offset: 0, text: 'ok' },
      { id: 's1', offset: 3, text: 'x'.repeat(20) },
    ];

    expect(
      chunkSegments(segments, 8, 5).map((chunk) => chunk.map((s) => s.id)),
    ).toEqual([['s0']]);
  });

  it('reports only what it sent when the chunk cap is reached', () => {
    const segments = Array.from({ length: 5 }, (_, index) => ({
      id: `s${index}`,
      offset: 0,
      text: 'x'.repeat(4),
    }));

    expect(chunkSegments(segments, 4, 2)).toHaveLength(2);
  });
});

describe('tagExcerpt', () => {
  it('includes the title and stops at the limit', () => {
    const excerpt = tagExcerpt(
      'Groceries',
      [{ id: 's0', offset: 0, text: 'milk and eggs' }],
      12,
    );

    expect(excerpt).toHaveLength(12);
    expect(excerpt.startsWith('Groceries')).toBe(true);
  });
});
