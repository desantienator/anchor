import { api, getJson } from "@/lib/api/client";

/** Where a field's effective value comes from. */
export type AiFieldSource = "user" | "environment" | "none";

export interface AiPreferences {
  enabled: boolean;
  taggingEnabled: boolean;
  spellingEnabled: boolean;
  onSaveEnabled: boolean;
  autoApplyTags: boolean;
  locale: string;
  consentedConfigKey: string | null;
  consentRequired: boolean;
  configured: boolean;
  baseUrl: string | null;
  model: string | null;
  hasApiKey: boolean;
  source: {
    baseUrl: AiFieldSource;
    model: AiFieldSource;
    apiKey: AiFieldSource;
  };
}

export interface AiCapabilities {
  configured: boolean;
  baseUrl: string | null;
  model: string | null;
  timeoutMs: number;
  hasApiKey: boolean;
  source: {
    baseUrl: AiFieldSource;
    model: AiFieldSource;
    apiKey: AiFieldSource;
  };
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

/** The fields a person may change; the raw API key only travels this way. */
export type AiPreferencesPatch = Partial<
  Pick<
    AiPreferences,
    | "enabled"
    | "taggingEnabled"
    | "spellingEnabled"
    | "onSaveEnabled"
    | "autoApplyTags"
    | "locale"
    | "baseUrl"
    | "model"
  >
> & {
  consent?: boolean;
  /** An empty string removes the person's saved key. */
  apiKey?: string;
};

export function getAiPreferences(): Promise<AiPreferences> {
  return getJson<AiPreferences>("api/ai/preferences");
}

export function updateAiPreferences(
  patch: AiPreferencesPatch,
): Promise<AiPreferences> {
  return api.patch("api/ai/preferences", { json: patch }).json<AiPreferences>();
}

export function getAiCapabilities(): Promise<AiCapabilities> {
  return getJson<AiCapabilities>("api/ai/capabilities");
}

/** A tiny completion against the person's own endpoint. */
export function testAiConnection(): Promise<{
  ok: boolean;
  model: string;
  reply: string;
}> {
  // A little past the server's 30-second probe window.
  return api
    .post("api/ai/test", { timeout: 35_000 })
    .json<{ ok: boolean; model: string; reply: string }>();
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
