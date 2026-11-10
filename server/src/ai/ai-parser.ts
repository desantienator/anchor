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

/** A tag the caller owns, as offered to the model. */
export interface TagOption {
  id: string;
  name: string;
}

const normalise = (value: string) => value.trim().toLowerCase();

/**
 * Keeps tags the caller owns, in model order, without duplicates.
 *
 * Models answer with ids, names, or `{id}`/`{name}` objects depending on the
 * server and the model. Matching all of those is not lax: every candidate is
 * resolved against the caller's own vocabulary, so anything unknown is still
 * dropped rather than trusted.
 */
export function acceptedTagIds(
  raw: Record<string, unknown>,
  vocabulary: TagOption[] | Set<string>,
): string[] {
  if (!Array.isArray(raw.tagIds)) return [];

  // Allow a caller that only has ids (older call sites, tests).
  const options: TagOption[] =
    vocabulary instanceof Set
      ? [...vocabulary].map((id) => ({ id, name: id }))
      : vocabulary;
  const byId = new Map(options.map((tag) => [tag.id, tag.id]));
  const byName = new Map(options.map((tag) => [normalise(tag.name), tag.id]));

  const out: string[] = [];
  for (const value of raw.tagIds) {
    const candidate = candidateTag(value);
    if (candidate === null) continue;

    const resolved =
      byId.get(candidate.id ?? '') ??
      byName.get(normalise(candidate.name ?? '')) ??
      null;
    if (resolved === null || out.includes(resolved)) continue;

    out.push(resolved);
    if (out.length >= AI_CONSTANTS.MAX_TAG_SUGGESTIONS) break;
  }
  return out;
}

/** Reads one array entry as an id, a name, or an object holding either. */
function candidateTag(value: unknown): { id?: string; name?: string } | null {
  if (typeof value === 'string') {
    const text = value.trim();
    if (!text) return null;
    // An id may also arrive quoted as JSON, {"id":"..."}
    if (text.startsWith('{')) {
      try {
        const parsed: unknown = JSON.parse(text);
        if (parsed && typeof parsed === 'object') return candidateTag(parsed);
      } catch {
        return { name: text };
      }
    }
    return { id: text, name: text };
  }

  if (value && typeof value === 'object') {
    const id = readField(value, 'id');
    const name = readField(value, 'name');
    const picked = {
      ...(typeof id === 'string' && id.trim() ? { id: id.trim() } : {}),
      ...(typeof name === 'string' && name.trim() ? { name: name.trim() } : {}),
    };
    return Object.keys(picked).length > 0 ? picked : null;
  }

  return null;
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
