"use client";

import { useQuery } from "@tanstack/react-query";
import * as React from "react";
import { type AiPreferences, analyzeNote, getAiPreferences } from "./api";

const QUIET_MS = 5_000;

/**
 * Adds matching existing tags shortly after a save settles, but only when the
 * person enabled it. A content fingerprint stops it re-running on its own
 * tag write, and tags are only ever added.
 */
export function useAutoTags({
  noteId,
  version,
  content,
  tagIds,
  settled,
  enabled,
  onChange,
}: {
  noteId: string;
  version: number;
  content: string;
  tagIds: string[];
  /** True once the draft has no unsaved changes and nothing is in flight. */
  settled: boolean;
  enabled: boolean;
  onChange: (tagIds: string[]) => void;
}) {
  const prefs = useQuery({
    queryKey: ["ai", "preferences"],
    queryFn: getAiPreferences,
    staleTime: 60_000,
  });
  const analysed = React.useRef<string | null>(null);
  const latest = React.useRef({ version, content, tagIds, onChange });
  latest.current = { version, content, tagIds, onChange };

  const active =
    enabled &&
    settled &&
    !!(prefs.data as AiPreferences | undefined)?.enabled &&
    !prefs.data?.consentRequired &&
    !!prefs.data?.taggingEnabled &&
    !!prefs.data?.autoApplyTags;

  React.useEffect(() => {
    if (!active) return;
    const fingerprint = `${version}:${content}`;
    if (analysed.current === fingerprint) return;

    const timer = setTimeout(() => {
      analysed.current = fingerprint;
      void analyzeNote(noteId, "tags", version)
        .then((result) => {
          const current = latest.current;
          const added = result.tagIds.filter(
            (id) => !current.tagIds.includes(id),
          );
          if (added.length > 0)
            current.onChange([...new Set([...current.tagIds, ...added])]);
        })
        .catch(() => {
          // Silent: an automatic pass must never interrupt writing.
        });
    }, QUIET_MS);

    return () => clearTimeout(timer);
  }, [active, noteId, content, version]);
}
