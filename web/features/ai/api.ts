import { api, getJson } from "@/lib/api/client";

export interface AiPreferences {
  enabled: boolean;
  taggingEnabled: boolean;
  spellingEnabled: boolean;
  onSaveEnabled: boolean;
  autoApplyTags: boolean;
  locale: string;
  consentedConfigKey: string | null;
  consentRequired: boolean;
}

export interface AiCapabilities {
  configured: boolean;
  baseUrl: string | null;
  model: string | null;
  timeoutMs: number;
}

export interface SpellingEdit {
  segmentId: string;
  start: number;
  length: number;
  original: string;
  replacement: string;
}

export interface AiAnalysis {
  noteId: string;
  baseVersion: number;
  tagIds: string[];
  edits: SpellingEdit[];
  coverage: {
    complete: boolean;
    chunks: number;
    analyzedChars: number;
    totalChars: number;
  } | null;
  warnings: string[];
}

export type AiOperation = "tags" | "spelling";

export function getAiPreferences(): Promise<AiPreferences> {
  return getJson<AiPreferences>("api/ai/preferences");
}

export function updateAiPreferences(
  patch: Partial<AiPreferences> & { consent?: boolean },
): Promise<AiPreferences> {
  return api.patch("api/ai/preferences", { json: patch }).json<AiPreferences>();
}

export function getAiCapabilities(): Promise<AiCapabilities> {
  return getJson<AiCapabilities>("api/ai/capabilities");
}

/**
 * The analysed snapshot travels in a header: the server refuses a request
 * without a version rather than reading whatever is current.
 */
export function analyzeNote(
  noteId: string,
  operation: AiOperation,
  baseVersion: number,
  signal?: AbortSignal,
): Promise<AiAnalysis> {
  return api
    .post(`api/ai/notes/${noteId}/analyze`, {
      json: { operation },
      headers: { "x-note-version": String(baseVersion) },
      signal,
      // Inference is slower than the client's default request budget.
      timeout: 130_000,
    })
    .json<AiAnalysis>();
}
