import { describe, expect, it } from 'vitest';
import { acceptedEdits, acceptedTagIds, parseJsonObject } from './ai-parser';

const segmentMap = (
  ...items: Array<{ id: string; offset: number; text: string }>
) => {
  const map = new Map<string, { id: string; offset: number; text: string }>();
  for (const item of items) map.set(item.id, item);
  return map;
};

const segments = segmentMap(
  { id: 's0', offset: 0, text: 'teh cat' },
  { id: 's1', offset: 8, text: 'the the cat' },
);

describe('parseJsonObject', () => {
  it('accepts a bare object and one fenced object', () => {
    expect(parseJsonObject('{"tagIds":[]}')).toEqual({ tagIds: [] });
    expect(parseJsonObject('```json\n{"tagIds":[]}\n```')).toEqual({
      tagIds: [],
    });
  });

  it('rejects prose, arrays and salvaged fragments', () => {
    expect(parseJsonObject('Sure! {"tagIds":[]}')).toBeNull();
    expect(parseJsonObject('[]')).toBeNull();
    expect(parseJsonObject('{"tagIds":[]} hope that helps')).toBeNull();
  });
});

describe('acceptedTagIds', () => {
  const allowed = new Set(['a', 'b', 'c', 'd']);

  it('keeps allowed ids, drops strangers and de-duplicates', () => {
    expect(
      acceptedTagIds({ tagIds: ['a', 'zzz', 'a', 'b', 'c', 'd'] }, allowed),
    ).toEqual(['a', 'b', 'c']);
  });

  it('accepts an empty choice and rejects a wrong shape', () => {
    expect(acceptedTagIds({ tagIds: [] }, allowed)).toEqual([]);
    expect(acceptedTagIds({ tags: ['a'] }, allowed)).toEqual([]);
  });
});

describe('acceptedEdits', () => {
  it('maps an exact unique original back to its range', () => {
    expect(
      acceptedEdits(
        {
          edits: [{ segmentId: 's0', original: 'teh', replacement: 'the' }],
        },
        segments,
      ),
    ).toEqual([
      {
        segmentId: 's0',
        start: 0,
        length: 3,
        original: 'teh',
        replacement: 'the',
      },
    ]);
  });

  it('drops ambiguous repeats instead of guessing which one', () => {
    expect(
      acceptedEdits(
        {
          edits: [{ segmentId: 's1', original: 'the', replacement: 'a' }],
        },
        segments,
      ),
    ).toEqual([]);
  });

  it('drops structural and markup edits', () => {
    const edits = acceptedEdits(
      {
        edits: [
          { segmentId: 's0', original: 'cat', replacement: 'cat\n' },
          { segmentId: 's0', original: 'cat', replacement: '<b>cat</b>' },
          { segmentId: 's0', original: 'cat', replacement: 'dog' },
        ],
      },
      segments,
    );

    expect(edits.map((edit) => edit.replacement)).toEqual(['dog']);
  });

  it('refuses overlapping edits and unknown segments', () => {
    expect(
      acceptedEdits(
        {
          edits: [
            { segmentId: 's0', original: 'teh', replacement: 'the' },
            { segmentId: 's0', original: 'eh', replacement: 'ehh' },
            { segmentId: 'nope', original: 'cat', replacement: 'dog' },
          ],
        },
        segments,
      ),
    ).toHaveLength(1);
  });

  it('ignores a no-op replacement', () => {
    expect(
      acceptedEdits(
        { edits: [{ segmentId: 's0', original: 'cat', replacement: 'cat' }] },
        segments,
      ),
    ).toEqual([]);
  });
});
