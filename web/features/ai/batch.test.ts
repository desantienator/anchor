import { describe, expect, it } from "vitest";
import type { AiAnalysis } from "./api";
import type { PlannedNote } from "./batch";
import { planUpdate } from "./batch";

const note = (content: string, tagIds: string[] = []): PlannedNote => ({
  id: "n1",
  content,
  tagIds,
});

const analysis = (
  edits: AiAnalysis["edits"],
  tagIds: string[] = [],
): AiAnalysis => ({
  noteId: "n1",
  baseVersion: 3,
  tagIds,
  edits,
  coverage: null,
  warnings: [],
});

const delta = (text: string) =>
  JSON.stringify({ ops: [{ insert: `${text}\n` }] });

describe("planUpdate", () => {
  it("applies spelling and adds new tags in one write", () => {
    const plan = planUpdate(
      note(delta("teh cat"), ["old"]),
      analysis(
        [
          {
            segmentId: "s0",
            start: 0,
            length: 3,
            original: "teh",
            replacement: "the",
          },
        ],
        ["new", "old"],
      ),
    );

    expect(plan.changed).toBe(true);
    expect(JSON.parse(plan.content ?? "")).toEqual({
      ops: [{ insert: "the cat\n" }],
    });
    // "old" was already there, so only "new" is added and nothing is removed.
    expect(plan.tagIds).toEqual(["old", "new"]);
  });

  it("reports no change when the model suggests nothing new", () => {
    const plan = planUpdate(
      note(delta("fine"), ["existing"]),
      analysis([], ["existing"]),
    );

    expect(plan).toEqual({ noteId: "n1", changed: false });
  });

  it("writes tags alone when a spelling patch no longer matches", () => {
    const plan = planUpdate(
      note(delta("the cat")),
      analysis(
        [
          {
            segmentId: "s0",
            start: 0,
            length: 3,
            original: "teh",
            replacement: "the",
          },
        ],
        ["fresh"],
      ),
    );

    expect(plan.content).toBeUndefined();
    expect(plan.tagIds).toEqual(["fresh"]);
    expect(plan.changed).toBe(true);
  });

  it("never removes an existing tag", () => {
    const plan = planUpdate(note(delta("x"), ["a", "b"]), analysis([], []));

    expect(plan.tagIds).toBeUndefined();
    expect(plan.changed).toBe(false);
  });
});
