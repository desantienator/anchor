"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useCallback, useRef, useState } from "react";
import { toast } from "@/components/ui/toast";
import { saveNote } from "@/features/notes/api";
import { type AiAnalysis, type AiOperation, analyzeNote } from "./api";
import { planUpdate } from "./batch";

export type BatchStatus = "idle" | "running" | "stopped" | "done";

export interface BatchProgress {
  status: BatchStatus;
  done: number;
  total: number;
  changed: number;
  failed: number;
  /** Title of the note being analysed, for a readable progress line. */
  current: string | null;
}

/** A note as the list already holds it; no extra fetch per note. */
export interface BatchTarget {
  id: string;
  title: string;
  version: number;
  content: string | null;
  tagIds: string[];
}

/** What a note looked like before this run, so one Undo can put it all back. */
interface Snapshot {
  content: string | null;
  tagIds: string[];
  savedVersion: number;
  /** Whether this run added tags, so Undo knows to restore the old set. */
  addedTags: boolean;
}

const IDLE: BatchProgress = {
  status: "idle",
  done: 0,
  total: 0,
  changed: 0,
  failed: 0,
  current: null,
};

/** Merges separate operation results into the one shape the planner reads. */
function combine(analyses: AiAnalysis[]): AiAnalysis {
  return {
    ...analyses[0],
    edits: analyses.flatMap((analysis) => analysis.edits),
    tagIds: [...new Set(analyses.flatMap((analysis) => analysis.tagIds))],
  };
}

/**
 * Runs notes through the model one at a time and applies what it suggests.
 * Sequential on purpose: a local model has one small queue, and a stampede
 * would only time out. Any single failure is counted and the run continues.
 */
export function useLibraryProcessing() {
  const queryClient = useQueryClient();
  const [progress, setProgress] = useState<BatchProgress>(IDLE);
  const cancelled = useRef(false);
  const snapshots = useRef(new Map<string, Snapshot>());

  const restoreAll = useCallback(async () => {
    const entries = [...snapshots.current.entries()];
    let restored = 0;

    for (const [id, snapshot] of entries) {
      const result = await saveNote(id, {
        ...(snapshot.content !== null ? { content: snapshot.content } : {}),
        // Only touch tags when this run added some, so concurrent tag edits
        // made elsewhere are left alone.
        ...(snapshot.addedTags ? { tagIds: snapshot.tagIds } : {}),
        baseVersion: snapshot.savedVersion,
      }).catch(() => null);
      if (result?.status === "saved") restored += 1;
    }

    snapshots.current.clear();
    await queryClient.invalidateQueries({ queryKey: ["notes"] });
    await queryClient.invalidateQueries({ queryKey: ["tags"] });
    if (restored !== entries.length) {
      toast.error("Some notes couldn’t be put back");
    }
  }, [queryClient]);

  const run = useMutation({
    mutationFn: async ({
      notes,
      operations,
    }: {
      notes: BatchTarget[];
      operations: AiOperation[];
    }) => {
      cancelled.current = false;
      snapshots.current = new Map();
      let changed = 0;
      let failed = 0;

      setProgress({ ...IDLE, status: "running", total: notes.length });

      for (const [index, target] of notes.entries()) {
        if (cancelled.current) break;

        setProgress({
          status: "running",
          done: index,
          total: notes.length,
          changed,
          failed,
          current: target.title || "Untitled",
        });

        try {
          const analyses: AiAnalysis[] = [];
          for (const operation of operations) {
            analyses.push(
              await analyzeNote(target.id, operation, target.version),
            );
          }
          const before = {
            content: target.content,
            tagIds: target.tagIds,
          };
          const plan = planUpdate(
            { id: target.id, ...before },
            combine(analyses),
          );
          if (!plan.changed) continue;
          const addedTags =
            plan.tagIds !== undefined &&
            plan.tagIds.length > before.tagIds.length;

          const result = await saveNote(target.id, {
            ...(plan.content !== undefined ? { content: plan.content } : {}),
            ...(plan.tagIds !== undefined ? { tagIds: plan.tagIds } : {}),
            // Guard against a note that moved while the model was thinking.
            baseVersion: target.version,
            // Keep a distinct history point before a bulk rewrite.
            replacesOtherEdit: plan.content !== undefined,
          });

          if (result.status !== "saved") {
            failed += 1;
            continue;
          }

          // The pre-run text and tags travel together, so one Undo reverses
          // both; the version guard keeps a later edit from being clobbered.
          snapshots.current.set(target.id, {
            ...before,
            savedVersion: result.note.version,
            addedTags,
          });
          changed += 1;
          queryClient.setQueryData(["notes", target.id], result.note);
        } catch {
          failed += 1;
        }
      }

      const stopped = cancelled.current;
      setProgress({
        status: stopped ? "stopped" : "done",
        done: notes.length,
        total: notes.length,
        changed,
        failed,
        current: null,
      });

      return { changed, failed, stopped };
    },
    onSuccess: ({ changed, failed, stopped }) => {
      void queryClient.invalidateQueries({ queryKey: ["notes"] });
      void queryClient.invalidateQueries({ queryKey: ["tags"] });

      if (stopped) {
        toast.info(
          `Stopped after ${changed} ${changed === 1 ? "note" : "notes"}`,
          changed > 0 ? { undo: () => void restoreAll() } : undefined,
        );
      } else if (changed === 0 && failed === 0) {
        toast.success("Nothing needed changing");
      } else if (changed > 0) {
        toast.success(
          `Updated ${changed} ${changed === 1 ? "note" : "notes"}`,
          {
            undo: () => void restoreAll(),
          },
        );
      }
      if (failed > 0) {
        toast.error(
          `${failed} ${failed === 1 ? "note" : "notes"} couldn’t be processed`,
        );
      }
    },
    onError: () => toast.error("Couldn’t process your notes"),
  });

  const start = useCallback(
    (notes: BatchTarget[], operations: AiOperation[]) => {
      if (notes.length === 0) return;
      run.mutate({ notes, operations });
    },
    [run],
  );

  return {
    progress,
    start,
    undoLastRun: restoreAll,
    stop: useCallback(() => {
      cancelled.current = true;
    }, []),
    isRunning: progress.status === "running",
  };
}
