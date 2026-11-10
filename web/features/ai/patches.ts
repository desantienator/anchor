import type { AiAnalysis } from "./api";

/**
 * Offsets are character positions in the note's plain text, but content is a
 * serialized Delta where a quote or backslash occupies two JSON characters.
 * Edits therefore address segments and are applied to the ops themselves.
 */
export interface SegmentRef {
  id: string;
  opIndex: number;
  partIndex: number;
  text: string;
}

interface Op {
  insert?: unknown;
  attributes?: Record<string, unknown>;
}

function opsOf(content: string): Op[] | null {
  try {
    const parsed: unknown = JSON.parse(content);
    if (Array.isArray(parsed)) return parsed as Op[];
    if (parsed && typeof parsed === "object" && "ops" in parsed) {
      const { ops } = parsed;
      if (Array.isArray(ops)) return ops as Op[];
    }
  } catch {
    // Not a Delta: refuse to patch rather than corrupt the note.
  }
  return null;
}

/**
 * Mirrors the server's segmenting so edit IDs line up. Any divergence shows
 * up as a stale check failure at apply time, never as a silent bad write.
 */
export function storedSegments(content: string): SegmentRef[] {
  const ops = opsOf(content) ?? [];
  const segments: SegmentRef[] = [];
  let next = 0;

  ops.forEach((op, opIndex) => {
    if (typeof op.insert !== "string") return;
    op.insert.split("\n").forEach((part, partIndex) => {
      if (part.length === 0) return;
      segments.push({ id: `s${next++}`, opIndex, partIndex, text: part });
    });
  });

  return segments;
}

export interface PatchResult {
  ok: boolean;
  content: string;
  reason?: "stale" | "parse" | "nothing-selected";
}

/**
 * Rebuilds the stored content with the selected corrections. Every edit is
 * re-checked against the current text, so a note that changed after analysis
 * is rejected instead of being patched at a guessed position.
 */
export function applyEdits(
  content: string,
  analysis: AiAnalysis,
  accepted: Set<string>,
): PatchResult {
  const chosen = analysis.edits.filter((edit) => accepted.has(editKey(edit)));
  if (chosen.length === 0) {
    return { ok: true, content, reason: "nothing-selected" };
  }

  const ops = opsOf(content);
  if (!ops) return { ok: false, content, reason: "parse" };

  const segments = new Map(storedSegments(content).map((s) => [s.id, s]));

  // Group by the op they live in, then by the line part inside that op.
  const byOp = new Map<number, Map<number, typeof chosen>>();
  for (const edit of chosen) {
    const segment = segments.get(edit.segmentId);
    if (!segment) return { ok: false, content, reason: "stale" };
    if (
      segment.text.slice(edit.start, edit.start + edit.length) !== edit.original
    )
      return { ok: false, content, reason: "stale" };

    const parts = byOp.get(segment.opIndex) ?? new Map();
    const list = parts.get(segment.partIndex) ?? [];
    list.push(edit);
    parts.set(segment.partIndex, list);
    byOp.set(segment.opIndex, parts);
  }

  for (const [opIndex, parts] of byOp) {
    const op = ops[opIndex];
    if (typeof op.insert !== "string")
      return { ok: false, content, reason: "stale" };

    op.insert = op.insert
      .split("\n")
      .map((part, partIndex) => {
        const edits = parts.get(partIndex);
        if (!edits?.length) return part;
        // From the end, so earlier offsets in this line stay valid.
        return [...edits]
          .sort((a, b) => b.start - a.start)
          .reduce(
            (text, edit) =>
              text.slice(0, edit.start) +
              edit.replacement +
              text.slice(edit.start + edit.length),
            part,
          );
      })
      .join("\n");
  }

  return { ok: true, content: JSON.stringify({ ops }) };
}

export function editKey(edit: {
  segmentId: string;
  start: number;
  original: string;
}): string {
  return `${edit.segmentId}:${edit.start}:${edit.original}`;
}

export function operationLabel(operation: "tags" | "spelling"): string {
  return operation === "tags" ? "Tag suggestions" : "Spelling suggestions";
}
