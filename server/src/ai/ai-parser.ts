import { AI_CONSTANTS } from './ai.constants';
import type { ProseSegment, SpellingEdit } from './ai.types';

/**
 * Small models wrap JSON in fences or add a sentence. Accept only one JSON
 * object, optionally fenced: never salvage a substring that happens to parse.
 */
export function parseJsonObject(raw: string): Record<string, unknown> | null {
  const trimmed = raw.trim();
  const fenced = /^```(?:json)?\s*\n?([\s\S]*?)\n?```$/i.exec(trimmed);
  const body = fenced ? fenced[1].trim() : trimmed;
  if (!body.startsWith('{') || !body.endsWith('}')) return null;
  try {
    const parsed: unknown = JSON.parse(body);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return null;
    }
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

/**
 * Keeps tag IDs the caller owns, in model order, without duplicates. An id
 * the person did not offer is dropped rather than trusted.
 */
export function acceptedTagIds(
  raw: Record<string, unknown>,
  allowed: Set<string>,
): string[] {
  if (!Array.isArray(raw.tagIds)) return [];
  const out: string[] = [];
  for (const value of raw.tagIds) {
    if (typeof value !== 'string') continue;
    if (!allowed.has(value)) continue;
    if (out.includes(value)) continue;
    out.push(value);
    if (out.length >= AI_CONSTANTS.MAX_TAG_SUGGESTIONS) break;
  }
  return out;
}

const hasLineBreak = (text: string) => /[\r\n]/.test(text);

/** Reads one property of an unvalidated object without trusting its shape. */
function readField(value: object, key: string): unknown {
  return Object.prototype.hasOwnProperty.call(value, key)
    ? Reflect.get(value, key)
    : undefined;
}

/**
 * Turns model edits into exact ranges on the original segment. Anything
 * ambiguous or structural is dropped: the model proposes, the code decides.
 */
export function acceptedEdits(
  raw: Record<string, unknown>,
  segments: Map<string, ProseSegment>,
): SpellingEdit[] {
  if (!Array.isArray(raw.edits)) return [];

  const edits: SpellingEdit[] = [];
  const claimed = new Map<string, Array<[number, number]>>();

  const candidates: unknown[] = raw.edits;
  for (const candidate of candidates) {
    if (edits.length >= AI_CONSTANTS.MAX_EDITS_PER_CHUNK) break;
    // Array elements are unvalidated; read the three fields we trust.
    if (!candidate || typeof candidate !== 'object') continue;
    const segmentId = readField(candidate, 'segmentId');
    const original = readField(candidate, 'original');
    const replacement = readField(candidate, 'replacement');
    if (
      typeof segmentId !== 'string' ||
      typeof original !== 'string' ||
      typeof replacement !== 'string'
    )
      continue;

    const segment = segments.get(segmentId);
    if (!segment) continue;
    if (original.length === 0 || original === replacement) continue;
    if (replacement.length > AI_CONSTANTS.MAX_REPLACEMENT_CHARS) continue;
    if (hasLineBreak(replacement) || hasLineBreak(original)) continue;
    // Reject markup: spelling must not introduce formatting or links.
    if (/[<>]/.test(replacement)) continue;

    const start = segment.text.indexOf(original);
    if (start < 0) continue;
    // A repeated spelling is only safe when the model quoted it uniquely.
    if (segment.text.indexOf(original, start + 1) >= 0) continue;

    const end = start + original.length;
    const ranges = claimed.get(segmentId) ?? [];
    if (ranges.some(([from, to]) => start < to && end > from)) continue;
    ranges.push([start, end]);
    claimed.set(segmentId, ranges);

    edits.push({
      segmentId,
      start,
      length: original.length,
      original,
      replacement,
    });
  }

  return edits;
}
