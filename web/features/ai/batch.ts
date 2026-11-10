import type { AiAnalysis } from "./api";
import { applyEdits, editKey } from "./patches";

/** The parts of a note a batch update can touch. */
export interface PlannedNote {
  id: string;
  content: string | null;
  tagIds?: string[];
}

/**
 * What one note needs after an analysis. Kept pure so the batch driver stays
 * about sequencing and this stays about deciding.
 */
export interface BatchUpdate {
  noteId: string;
  content?: string;
  tagIds?: string[];
  changed: boolean;
}

/**
 * Decides the write for a note from its stored content and the model's
 * suggestions. Spelling is applied in full; tags are only ever added.
 */
export function planUpdate(
  note: PlannedNote,
  analysis: AiAnalysis,
): BatchUpdate {
  const current = note.content ?? "";
  const accepted = new Set(analysis.edits.map(editKey));
  const patched = applyEdits(current, analysis, accepted);

  // A patch that no longer matches means the note moved under us; leave the
  // text alone rather than writing a guess.
  const content = patched.ok ? patched.content : current;
  const contentChanged = patched.ok && content !== current;

  const existing = note.tagIds ?? [];
  const additions = analysis.tagIds.filter((id) => !existing.includes(id));

  return {
    noteId: note.id,
    ...(contentChanged ? { content } : {}),
    ...(additions.length > 0
      ? { tagIds: [...new Set([...existing, ...additions])] }
      : {}),
    changed: contentChanged || additions.length > 0,
  };
}
