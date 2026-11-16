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
  it("keeps segment ids aligned with the server when links, URLs, emails and code sit between lines", () => {
    // Mirror of proseSegments in server/src/ai/prose.ts (ids only): a
    // code/code-block or link attribute excludes the whole op; a URL or
    // email only excludes its own line.
    const serverIds = (
      ops: { insert?: unknown; attributes?: Record<string, unknown> }[],
    ): string[] => {
      const blockedAttributes = (
        attributes: Record<string, unknown> | undefined,
      ) =>
        !!attributes &&
        ["code-block", "code"].some((name) => !!attributes[name]);
      const url = /(?:https?:\/\/|www\.)\S+/i;
      const email = /\S+@\S+\.\S+/;
      const ids: string[] = [];
      let next = 0;
      for (const op of ops) {
        if (typeof op.insert !== "string") continue;
        const opBlocked =
          blockedAttributes(op.attributes) || !!op.attributes?.link;
        for (const part of op.insert.split("\n")) {
          if (part.length === 0) continue;
          if (opBlocked || url.test(part) || email.test(part)) continue;
          ids.push(`s${next++}`);
        }
      }
      return ids;
    };

    const ops = [
      { insert: "first line ok\n" },
      { insert: "second line ok\n" },
      { insert: "teh linked\n", attributes: { link: "https://example.com" } },
      { insert: "https://recieve.example.com/y\n" },
      { insert: "bob@example.com\n" },
      { insert: "code teh here\n", attributes: { "code-block": "plain" } },
      // One op, three lines: only the URL line is excluded, so the two
      // prose lines keep their own sN ids.
      { insert: "intro line\nhttps://skip.example/z\nand more prose\n" },
      { insert: "third line teh\n" },
      { insert: "fourth line\n" },
    ];
    const content = stored(ops);
    const expected = [
      ["s0", "first line ok"],
      ["s1", "second line ok"],
      ["s2", "intro line"],
      ["s3", "and more prose"],
      ["s4", "third line teh"],
      ["s5", "fourth line"],
    ];

    expect(storedSegments(content).map(({ id, text }) => [id, text])).toEqual(
      expected,
    );
    expect(serverIds(ops)).toEqual(expected.map(([id]) => id));

    const edits: AiAnalysis["edits"] = [
      {
        segmentId: "s4",
        start: 11,
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

    // The correction must land on "third line teh", not the drifted line.
    expect(result).toEqual({
      ok: true,
      content: stored([
        { insert: "first line ok\n" },
        { insert: "second line ok\n" },
        { insert: "teh linked\n", attributes: { link: "https://example.com" } },
        { insert: "https://recieve.example.com/y\n" },
        { insert: "bob@example.com\n" },
        { insert: "code teh here\n", attributes: { "code-block": "plain" } },
        { insert: "intro line\nhttps://skip.example/z\nand more prose\n" },
        { insert: "third line the\n" },
        { insert: "fourth line\n" },
      ]),
    });
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
