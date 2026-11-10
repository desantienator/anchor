"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Sparkles, TriangleAlert } from "lucide-react";
import * as React from "react";
import { toast } from "@/components/ui/toast";
import { sortTagsByName, type Tag, TagChip } from "@/features/tags";
import { type AiAnalysis, analyzeNote, getAiPreferences } from "../api";
import { applyEdits, editKey } from "../patches";

interface AiReviewProps {
  noteId: string;
  /** The saved version the analysis must be based on. */
  version: number;
  content: string;
  title: string;
  tagIds: string[];
  allTags: Tag[];
  canEditText: boolean;
  /** Saves pending edits and resolves once the note is on the server. */
  flushEdits: () => Promise<void>;
  onApplyTags: (next: string[]) => void;
  onApplyContent: (next: string) => void;
  onClose: () => void;
}

/**
 * Review before anything changes. Suggestions are held here, not applied on
 * arrival; the note is only written when the person presses Apply.
 */
export function AiReview({
  noteId,
  version,
  content,
  title,
  tagIds,
  allTags,
  canEditText,
  flushEdits,
  onApplyTags,
  onApplyContent,
  onClose,
}: AiReviewProps) {
  const queryClient = useQueryClient();
  const prefs = useQuery({
    queryKey: ["ai", "preferences"],
    queryFn: getAiPreferences,
  });
  const [analysis, setAnalysis] = React.useState<AiAnalysis | null>(null);
  const [chosenEdits, setChosenEdits] = React.useState<Set<string>>(new Set());
  const [chosenTags, setChosenTags] = React.useState<Set<string>>(new Set());
  const [warning, setWarning] = React.useState<string | null>(null);

  const analyze = useMutation({
    mutationFn: async (operation: "tags" | "spelling") => {
      // The analysis must describe the saved note, not a stale draft.
      await flushEdits();
      return analyzeNote(noteId, operation, version);
    },
    onSuccess: (result) => {
      setAnalysis(result);
      setWarning(null);
      setChosenEdits(new Set(result.edits.map(editKey)));
      setChosenTags(
        new Set(result.tagIds.filter((id) => !tagIds.includes(id))),
      );
    },
    onError: (error) => {
      setWarning(
        error instanceof Error ? error.message : "Local AI is unavailable.",
      );
    },
  });

  const tagById = new Map(allTags.map((tag) => [tag.id, tag]));
  const tagSuggestions = (analysis?.tagIds ?? []).filter(
    (id) => !tagIds.includes(id) && tagById.has(id),
  );

  const toggle = (
    set: Set<string>,
    update: (next: Set<string>) => void,
    key: string,
  ) => {
    const next = new Set(set);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    update(next);
  };

  const apply = () => {
    if (!analysis) return;

    const result = applyEdits(content, analysis, chosenEdits);
    if (!result.ok) {
      setWarning(
        result.reason === "stale"
          ? "The note changed since it was checked. Ask again to review fresh suggestions."
          : "These suggestions can’t be applied to this note.",
      );
      return;
    }

    const nextTags =
      chosenTags.size > 0 ? [...new Set([...tagIds, ...chosenTags])] : tagIds;
    const before = { content, tagIds };
    const after = {
      content: result.reason === "nothing-selected" ? content : result.content,
      tagIds: nextTags,
    };

    if (after.content !== before.content) onApplyContent(after.content);
    if (after.tagIds.length !== before.tagIds.length) onApplyTags(after.tagIds);

    queryClient.invalidateQueries({ queryKey: ["ai", "preferences"] });
    toast.success("Suggestions applied", {
      // Undo restores exactly what this operation replaced.
      undo: () => {
        onApplyContent(before.content);
        onApplyTags(before.tagIds);
      },
    });
    onClose();
  };

  const canUse = prefs.data?.enabled && !prefs.data.consentRequired;
  const nothingChosen = chosenEdits.size === 0 && chosenTags.size === 0;

  return (
    <div className="grid gap-4">
      {!canUse ? (
        <p className="text-ui text-muted-foreground">
          Turn on local AI in Settings first. Nothing is sent until you ask.
        </p>
      ) : (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="rounded-md bg-foreground/6 px-3 py-1.5 font-medium text-ui"
            disabled={analyze.isPending || !prefs.data?.taggingEnabled}
            onClick={() => analyze.mutate("tags")}
          >
            Suggest tags
          </button>
          <button
            type="button"
            className="rounded-md bg-foreground/6 px-3 py-1.5 font-medium text-ui"
            disabled={
              analyze.isPending || !canEditText || !prefs.data?.spellingEnabled
            }
            onClick={() => analyze.mutate("spelling")}
          >
            Check spelling
          </button>
          {analyze.isPending && (
            <span className="flex items-center gap-1.5 text-meta text-muted-foreground">
              <Sparkles aria-hidden className="size-3.5 animate-pulse" />
              Asking the local model…
            </span>
          )}
        </div>
      )}

      {warning && (
        <p className="flex items-start gap-2 rounded-md bg-late/10 p-2.5 text-meta text-late">
          <TriangleAlert aria-hidden className="mt-0.5 size-3.5 flex-none" />
          {warning}
        </p>
      )}

      {analysis?.warnings.map((text) => (
        <p key={text} className="text-meta text-muted-foreground">
          {text}
        </p>
      ))}

      {tagSuggestions.length > 0 && (
        <section className="grid gap-2">
          <h3 className="m-0 font-semibold text-meta">Tags</h3>
          <div className="flex flex-wrap gap-1.5">
            {sortTagsByName(
              tagSuggestions
                .map((id) => tagById.get(id))
                .filter((tag): tag is Tag => !!tag),
            ).map((tag) => (
              <button
                key={tag.id}
                type="button"
                aria-pressed={chosenTags.has(tag.id)}
                onClick={() => toggle(chosenTags, setChosenTags, tag.id)}
                className="cursor-pointer border-0 bg-transparent p-0 opacity-50 aria-pressed:opacity-100"
              >
                <TagChip name={tag.name} color={tag.color} />
              </button>
            ))}
          </div>
        </section>
      )}

      {analysis && analysis.edits.length > 0 && (
        <section className="grid gap-1.5">
          <h3 className="m-0 font-semibold text-meta">
            Spelling{" "}
            <span className="font-normal text-muted-foreground">
              ({chosenEdits.size} of {analysis.edits.length})
            </span>
          </h3>
          <ul className="m-0 grid list-none gap-1 p-0">
            {analysis.edits.map((edit) => {
              const key = editKey(edit);
              return (
                <li key={key}>
                  <label className="flex cursor-pointer items-baseline gap-2 text-ui">
                    <input
                      type="checkbox"
                      checked={chosenEdits.has(key)}
                      onChange={() => toggle(chosenEdits, setChosenEdits, key)}
                    />
                    <span>
                      <del className="text-muted-foreground">
                        {edit.original}
                      </del>{" "}
                      <ins className="text-accent-strong no-underline">
                        {edit.replacement}
                      </ins>
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {analysis &&
        analysis.edits.length === 0 &&
        analysis.tagIds.length === 0 && (
          <p className="text-ui text-muted-foreground">
            Nothing to change{title ? ` in “${title}”` : ""}.
          </p>
        )}

      <div className="flex justify-end gap-2">
        <button
          type="button"
          className="rounded-md px-3 py-1.5 text-ui"
          onClick={onClose}
        >
          Cancel
        </button>
        <button
          type="button"
          className="rounded-md bg-foreground px-3 py-1.5 font-medium text-ui text-surface disabled:opacity-40"
          disabled={!analysis || nothingChosen}
          onClick={apply}
        >
          Apply selected
        </button>
      </div>
    </div>
  );
}
