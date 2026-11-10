import { HttpException, HttpStatus } from '@nestjs/common';

/** Stable codes the clients branch on, instead of provider wording. */
export type AiErrorCode =
  | 'AI_DISABLED'
  | 'AI_NOT_OPTED_IN'
  | 'AI_OPERATION_DISABLED'
  | 'AI_UNREACHABLE'
  | 'AI_TIMEOUT'
  | 'AI_AUTH_FAILED'
  | 'AI_MODEL_NOT_FOUND'
  | 'AI_BUSY'
  | 'AI_INVALID_OUTPUT'
  | 'AI_CONTEXT_LIMIT'
  | 'AI_NOTE_NOT_ACTIVE'
  | 'AI_STALE_SNAPSHOT'
  | 'AI_PERMISSION_DENIED';

const STATUS: Record<AiErrorCode, HttpStatus> = {
  AI_DISABLED: HttpStatus.SERVICE_UNAVAILABLE,
  AI_NOT_OPTED_IN: HttpStatus.FORBIDDEN,
  AI_OPERATION_DISABLED: HttpStatus.FORBIDDEN,
  AI_UNREACHABLE: HttpStatus.BAD_GATEWAY,
  AI_TIMEOUT: HttpStatus.GATEWAY_TIMEOUT,
  AI_AUTH_FAILED: HttpStatus.BAD_GATEWAY,
  AI_MODEL_NOT_FOUND: HttpStatus.BAD_GATEWAY,
  AI_BUSY: HttpStatus.TOO_MANY_REQUESTS,
  AI_INVALID_OUTPUT: HttpStatus.BAD_GATEWAY,
  AI_CONTEXT_LIMIT: HttpStatus.UNPROCESSABLE_ENTITY,
  AI_NOTE_NOT_ACTIVE: HttpStatus.BAD_REQUEST,
  AI_STALE_SNAPSHOT: HttpStatus.CONFLICT,
  AI_PERMISSION_DENIED: HttpStatus.FORBIDDEN,
};

/**
 * An AI failure with a machine-readable code. The message is safe to show;
 * provider bodies never reach the client.
 */
export class AiError extends HttpException {
  constructor(
    readonly code: AiErrorCode,
    message: string,
  ) {
    super({ code, message }, STATUS[code]);
  }
}

export type AiOperation = 'tags' | 'spelling';

export const AI_OPERATIONS: readonly AiOperation[] = ['tags', 'spelling'];

/** One exact substring of the stored note, with its character offset. */
export interface ProseSegment {
  id: string;
  offset: number;
  text: string;
}

/** A replacement the client may apply to the exact range it validates. */
export interface SpellingEdit {
  segmentId: string;
  start: number;
  length: number;
  original: string;
  replacement: string;
}

export interface SpellingCoverage {
  complete: boolean;
  chunks: number;
  analyzedChars: number;
  totalChars: number;
}

export interface AiAnalysis {
  noteId: string;
  baseVersion: number;
  tagIds: string[];
  edits: SpellingEdit[];
  coverage: SpellingCoverage | null;
  warnings: string[];
}

/** Result of one chat completion. */
export interface ChatResult {
  content: string;
}
