import type { ProseSegment } from './ai.types';

type DeltaOp = { insert?: unknown; attributes?: Record<string, unknown> };
type Delta = { ops: DeltaOp[] };

/**
 * Notes are stored as serialized Quill Deltas. Only string inserts are prose;
 * embeds, code blocks and link URLs are never sent to the model.
 */
export function parseOps(content: string | null | undefined): DeltaOp[] | null {
  if (!content) return [];

  try {
    const parsed: unknown = JSON.parse(content);
    if (Array.isArray(parsed)) return parsed as DeltaOp[];
    if (
      parsed &&
      typeof parsed === 'object' &&
      Array.isArray((parsed as Delta).ops)
    ) {
      return (parsed as Delta).ops;
    }
  } catch {
    // Unparseable content is not something the model should guess at.
  }
  return null;
}

const BLOCKED_ATTRIBUTES = ['code-block', 'code'];

const isBlocked = (attributes: Record<string, unknown> | undefined): boolean =>
  !!attributes && BLOCKED_ATTRIBUTES.some((name) => !!attributes[name]);

const URL_PATTERN = /(?:https?:\/\/|www\.)\S+/i;
const EMAIL_PATTERN = /\S+@\S+\.\S+/;

/**
 * Splits the note into prose runs with exact offsets into the stored Delta's
 * plain text, so a correction maps back without guessing. Text inside code,
 * links, URLs and embeds is excluded.
 */
export function proseSegments(content: string | null | undefined): {
  segments: ProseSegment[];
  totalChars: number;
  invalid: boolean;
} {
  const ops = parseOps(content);
  if (!ops) return { segments: [], totalChars: 0, invalid: true };

  const segments: ProseSegment[] = [];
  let offset = 0;
  let totalChars = 0;
  let next = 0;

  for (const op of ops) {
    if (typeof op.insert !== 'string') {
      // An embed occupies one character in Quill's plain text.
      if (op.insert !== undefined) offset += 1;
      continue;
    }

    const text = op.insert;
    const blocked =
      isBlocked(op.attributes) ||
      !!op.attributes?.link ||
      URL_PATTERN.test(text) ||
      EMAIL_PATTERN.test(text);

    if (blocked) {
      offset += text.length;
      continue;
    }

    // Line breaks end a run: a replacement must not restructure the note.
    const parts = text.split('\n');
    for (const [index, part] of parts.entries()) {
      if (part.length > 0) {
        segments.push({ id: `s${next++}`, offset, text: part });
        totalChars += part.length;
      }
      offset += part.length;
      // Only the breaks between parts advance the offset; the empty tail
      // after a trailing newline is not another character.
      if (index < parts.length - 1) offset += 1;
    }
  }

  return { segments, totalChars, invalid: false };
}

/** Packs segments into chunks without splitting a segment's characters. */
export function chunkSegments(
  segments: ProseSegment[],
  budget: number,
  maxChunks: number,
): ProseSegment[][] {
  const chunks: ProseSegment[][] = [];
  let current: ProseSegment[] = [];
  let size = 0;

  for (const segment of segments) {
    if (segment.text.length > budget) continue;
    if (size + segment.text.length > budget && current.length > 0) {
      chunks.push(current);
      current = [];
      size = 0;
    }
    if (chunks.length >= maxChunks) break;
    current.push(segment);
    size += segment.text.length;
  }

  if (current.length > 0 && chunks.length < maxChunks) chunks.push(current);
  return chunks.filter((chunk) => chunk.length > 0);
}

/** Text for categorisation: the beginning of the note, plus the title. */
export function tagExcerpt(
  title: string,
  segments: ProseSegment[],
  limit: number,
): string {
  const parts: string[] = [];
  let size = 0;
  for (const segment of segments) {
    if (size >= limit) break;
    const text = segment.text.slice(0, limit - size);
    parts.push(text);
    size += text.length;
  }
  return [title, parts.join('\n')].filter(Boolean).join('\n\n').slice(0, limit);
}
