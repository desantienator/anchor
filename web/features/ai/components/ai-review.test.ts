import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import type { Note } from "@/features/notes/types";
import { noteVersionAfterFlush } from "./ai-review";

const note = (version: number): Note => ({
  id: "n1",
  title: "t",
  content: "c",
  isPinned: false,
  isArchived: false,
  state: "active",
  version,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  userId: "u1",
  permission: "owner",
});

describe("noteVersionAfterFlush", () => {
  it("sends the post-flush version when the flush saved a dirty draft", async () => {
    // The user typed, so the editor holds a dirty draft at version 4.
    const queryClient = new QueryClient();
    queryClient.setQueryData(["notes", "n1"], note(4));

    // flushEdits(): the save resolves only after handleSaved has bumped the
    // cached note to 5, before the queue reports settled.
    const flushEdits = async () => {
      queryClient.setQueryData(["notes", "n1"], note(5));
    };

    await flushEdits();
    // The captured-at-click version is 4; the request must carry 5.
    expect(noteVersionAfterFlush(queryClient, "n1", 4)).toBe(5);
  });

  it("keeps the captured version when the flush saved nothing", async () => {
    // No dirty draft: the flush is a no-op and the cache still holds the
    // same version that was captured at click time.
    const queryClient = new QueryClient();
    queryClient.setQueryData(["notes", "n1"], note(4));

    await (async () => {})();
    expect(noteVersionAfterFlush(queryClient, "n1", 4)).toBe(4);
  });

  it("falls back to the captured version when the cache is empty", () => {
    expect(noteVersionAfterFlush(new QueryClient(), "n1", 7)).toBe(7);
  });
});
