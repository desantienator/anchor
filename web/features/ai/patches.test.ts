import { describe, expect, it } from "vitest";
import type { AiAnalysis } from "./api";
import { applyEdits, editKey, storedSegments } from "./patches";

const stored = (ops: unknown[]) => JSON.stringify({ ops });

const analysis = (edits: AiAnalysis["edits"], baseVersion = 1): AiAnalysis => ({
  noteId: "n1",
  baseVersion,
  tagIds: [],
  edits,
  coverage: null,
  warnings: [],
});

const acceptedAll = (a: AiAnalysis) => new Set(a.edits.map(editKey));

describe("applyEdits", () => {
  it("replaces a word and keeps the Delta shape", () => {
    const content = stored([{ insert: "teh cat\n" }]);
    const result = applyEdits(
      content,
      analysis([
        {
          segmentId: "s0",
          start: 0,
          length: 3,
          original: "teh",
          replacement: "the",
        },
      ]),
      acceptedAll(
        analysis([
          {
            segmentId: "s0",
            start: 0,
            length: 3,
            original: "teh",
            replacement: "the",
          },
        ]),
      ),
    );

    expect(result.ok).toBe(true);
    expect(JSON.parse(result.content).ops).toEqual([{ insert: "the cat\n" }]);
  });

  it("preserves quoted and multiline text, which raw offsets would corrupt", () => {
    const content = stored([
      { insert: 'he said "teh thing"\n' },
      { insert: "second teh line\n" },
    ]);
    const edits = [
      {
        segmentId: "s0",
        start: 9,
        length: 3,
        original: "teh",
        replacement: "the",
      },
      {
        segmentId: "s1",
        start: 7,
        length: 3,
        original: "teh",
        replacement: "the",
      },
    ];
    const result = applyEdits(
      content,
      analysis(edits),
      acceptedAll(analysis(edits)),
    );

    expect(result.ok).toBe(true);
    expect(JSON.parse(result.content).ops).toEqual([
      { insert: 'he said "the thing"\n' },
      { insert: "second the line\n" },
    ]);
  });

  it("keeps attributes on the line it edits", () => {
    const content = stored([
      { insert: "teh item\n", attributes: { list: "unchecked" } },
    ]);
    const edits = [
      {
        segmentId: "s0",
        start: 0,
        length: 3,
        original: "teh",
        replacement: "the",
      },
    ];
    const result = applyEdits(
      content,
      analysis(edits),
      acceptedAll(analysis(edits)),
    );

    expect(JSON.parse(result.content).ops).toEqual([
      { insert: "the item\n", attributes: { list: "unchecked" } },
    ]);
  });

  it("applies only the accepted edits", () => {
    const content = stored([{ insert: "teh cat sat\n" }]);
    const edits = [
      {
        segmentId: "s0",
        start: 0,
        length: 3,
        original: "teh",
        replacement: "the",
      },
      {
        segmentId: "s0",
        start: 8,
        length: 3,
        original: "sat",
        replacement: "sat",
      },
    ];
    const only = new Set([editKey(edits[0])]);
    const result = applyEdits(content, analysis(edits), only);

    expect(JSON.parse(result.content).ops).toEqual([
      { insert: "the cat sat\n" },
    ]);
  });

  it("applies several edits in one line from the end", () => {
    const content = stored([{ insert: "teh cat teh\n" }]);
    const edits = [
      {
        segmentId: "s0",
        start: 0,
        length: 3,
        original: "teh",
        replacement: "the",
      },
      {
        segmentId: "s0",
        start: 8,
        length: 3,
        original: "teh",
        replacement: "the",
      },
    ];
    const result = applyEdits(
      content,
      analysis(edits),
      acceptedAll(analysis(edits)),
    );

    expect(JSON.parse(result.content).ops).toEqual([
      { insert: "the cat the\n" },
    ]);
  });

  it("refuses a patch when the text moved since analysis", () => {
    const content = stored([{ insert: "the cat\n" }]);
    const edits = [
      {
        segmentId: "s0",
        start: 0,
        length: 3,
        original: "teh",
        replacement: "the",
      },
    ];
    const result = applyEdits(
      content,
      analysis(edits),
      acceptedAll(analysis(edits)),
    );

    expect(result).toMatchObject({ ok: false, reason: "stale" });
  });

  it("leaves the note alone when its content is not a Delta", () => {
    const edits = [
      {
        segmentId: "s0",
        start: 0,
        length: 3,
        original: "teh",
        replacement: "the",
      },
    ];
    const result = applyEdits(
      "plain text",
      analysis(edits),
      acceptedAll(analysis(edits)),
    );

    expect(result.ok).toBe(false);
  });
});

describe("storedSegments", () => {
  it("mirrors server segment ids across ops and newlines", () => {
    const segments = storedSegments(
      stored([
        { insert: "one\ntwo\n" },
        { insert: { image: "x" } },
        { insert: "three\n" },
      ]),
    );

    expect(segments.map(({ id, text }) => [id, text])).toEqual([
      ["s0", "one"],
      ["s1", "two"],
      ["s2", "three"],
    ]);
  });
});
