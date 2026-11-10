/** Tunables for the local-model feature. */
export const AI_CONSTANTS = {
  /** Most tags a single note may be given. */
  MAX_TAG_SUGGESTIONS: 3,
  /** Tags offered to the model; keeps the prompt small on big libraries. */
  MAX_TAG_VOCABULARY: 80,
  /** Longest single replacement accepted for a spelling fix. */
  MAX_REPLACEMENT_CHARS: 120,
  /** Most edits accepted from one chunk. */
  MAX_EDITS_PER_CHUNK: 200,
  /** Notes longer than this are analysed in part, with a warning. */
  MAX_TOTAL_PROSE_CHARS: 120_000,
  /** Chunks beyond this are skipped and reported as incomplete. */
  MAX_CHUNKS: 12,
  /** Title plus this much prose is sent for categorisation. */
  MAX_TAG_EXCERPT_CHARS: 4_000,
  /** Cap on a provider response body. */
  MAX_RESPONSE_BYTES: 1_000_000,
  /** Analyses allowed in flight against the endpoint, per process. */
  MAX_CONCURRENT_REQUESTS: 2,
  /** Analyses waiting once the slots are taken. */
  MAX_QUEUED_REQUESTS: 24,
  /** Default locale when the client sends nothing usable. */
  DEFAULT_LOCALE: 'en',
  TAG_OPERATION: 'tags',
  SPELLING_OPERATION: 'spelling',
} as const;

/** Chars sent to the model per completion, from the configured context. */
export function chunkCharBudget(contextTokens: number): number {
  return Math.min(12_000, Math.max(2_000, contextTokens * 2));
}
