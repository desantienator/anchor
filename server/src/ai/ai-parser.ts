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

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

/**
 * Keeps tag IDs the caller owns, in model order, without duplicates. An id
 * the person did not offer is dropped rather than trusted.
 */
export function acceptedTagIds(raw: unknown, allowed: Set<string>): string[] {
  if (!isRecord(raw) || !Array.isArray(raw.tagIds)) return [];
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

/**
 * Turns model edits into exact ranges on the original segment. Anything
 * ambiguous or structural is dropped: the model proposes, the code decides.
 */
export function acceptedEdits(
  raw: unknown,
  segments: Map<string, ProseSegment>,
): SpellingEdit[] {
  if (!isRecord(raw) || !Array.isArray(raw.edits)) return [];

  const edits: SpellingEdit[] = [];
  const claimed = new Map<string, Array<[number, number]>>();

  for (const value of raw.edits) {
    if (edits.length >= AI_CONSTANTS.MAX_EDITS_PER_CHUNK) break;
    if (!isRecord(value)) continue;

    const { segmentId, original, replacement } = value;
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
