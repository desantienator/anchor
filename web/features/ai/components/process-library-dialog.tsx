"use client";

import { useQuery } from "@tanstack/react-query";
import { Sparkles } from "lucide-react";
import * as React from "react";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { Note } from "@/features/notes/types";
import { getAiPreferences } from "../api";
import {
  type BatchTarget,
  useLibraryProcessing,
} from "../use-library-processing";

interface ProcessLibraryDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  notes: Note[];
}

/**
 * Walks every editable note through the model. The confirmation states the
 * count and what will change, because this writes without a per-note review.
 */
export function ProcessLibraryDialog({
  open,
  onOpenChange,
  notes,
}: ProcessLibraryDialogProps) {
  const { progress, start, stop, isRunning, undoLastRun } =
    useLibraryProcessing();
  const prefs = useQuery({
    queryKey: ["ai", "preferences"],
    queryFn: getAiPreferences,
    enabled: open,
  });

  const targets: BatchTarget[] = React.useMemo(
    () =>
      notes
        .filter(
          (note) =>
            note.state === "active" &&
            (note.permission === "owner" || note.permission === "editor"),
        )
        .map((note) => ({
          id: note.id,
          title: note.title,
          version: note.version,
          content: note.content ?? null,
          tagIds: note.tagIds ?? [],
        })),
    [notes],
  );

  const [tagging, setTagging] = React.useState(true);
  const [spelling, setSpelling] = React.useState(true);
  const operations = [
    ...(tagging ? (["tags"] as const) : []),
    ...(spelling ? (["spelling"] as const) : []),
  ];
  const ready = prefs.data?.enabled && !prefs.data.consentRequired;
  const finished = progress.status === "done" || progress.status === "stopped";
  const canRun = ready && targets.length > 0 && operations.length > 0;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (isRunning) return;
        onOpenChange(next);
      }}
    >
      <DialogContent className="max-w-130">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles aria-hidden className="size-4" />
            Process all notes
          </DialogTitle>
        </DialogHeader>
        <DialogBody>
          {!ready ? (
            <p className="text-ui text-muted-foreground">
              Turn on Local AI in Settings first. Nothing is sent until you do.
            </p>
          ) : (
            <div className="grid gap-4">
              <p className="text-ui text-muted-foreground">
                {targets.length === 0
                  ? "There are no notes to process here."
                  : `${targets.length} ${targets.length === 1 ? "note" : "notes"} will be sent to the model and updated in place. This runs one at a time and can be stopped.`}
              </p>

              <fieldset className="grid gap-2 border-0 p-0">
                <legend className="mb-1 font-semibold text-meta">
                  What to do
                </legend>
                <label className="flex items-center gap-2 text-ui">
                  <input
                    type="checkbox"
                    checked={tagging}
                    disabled={isRunning}
                    onChange={(e) => setTagging(e.target.checked)}
                  />
                  Add matching tags (never removes existing ones)
                </label>
                <label className="flex items-center gap-2 text-ui">
                  <input
                    type="checkbox"
                    checked={spelling}
                    disabled={isRunning}
                    onChange={(e) => setSpelling(e.target.checked)}
                  />
                  Fix spelling (keeps formatting; skips code and links)
                </label>
              </fieldset>

              {progress.status !== "idle" && (
                <div className="grid gap-1.5" aria-live="polite">
                  <progress
                    className="h-1.5 w-full"
                    value={progress.done}
                    max={progress.total || 1}
                  />
                  <p className="text-meta text-muted-foreground">
                    {progress.status === "running"
                      ? `Working on “${progress.current ?? "…"}” (${progress.done + 1} of ${progress.total})`
                      : progress.status === "stopped"
                        ? `Stopped: ${progress.changed} updated, ${progress.failed} skipped.`
                        : progress.status === "done"
                          ? `Finished: ${progress.changed} updated, ${progress.failed} skipped.`
                          : null}
                  </p>
                </div>
              )}

              <p className="text-meta text-muted-foreground">
                Nothing is written until you press Process. Each note keeps its
                earlier text in History.
              </p>
            </div>
          )}
        </DialogBody>
        <DialogFooter>
          {isRunning ? (
            <button
              type="button"
              className="rounded-md bg-foreground/6 px-3 py-1.5 font-medium text-ui"
              onClick={stop}
            >
              Stop
            </button>
          ) : (
            <>
              {finished && progress.changed > 0 && (
                <button
                  type="button"
                  className="rounded-md px-3 py-1.5 text-ui"
                  onClick={() => void undoLastRun()}
                >
                  Undo this run
                </button>
              )}
              <button
                type="button"
                className="rounded-md px-3 py-1.5 text-ui"
                onClick={() => onOpenChange(false)}
              >
                {finished ? "Close" : "Cancel"}
              </button>
              <button
                type="button"
                className="rounded-md bg-foreground px-3 py-1.5 font-medium text-ui text-surface disabled:opacity-40"
                disabled={!canRun}
                onClick={() => start(targets, [...operations])}
              >
                {finished
                  ? "Run again"
                  : `Process ${targets.length} ${targets.length === 1 ? "note" : "notes"}`}
              </button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
