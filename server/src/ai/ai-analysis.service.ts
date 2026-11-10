import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { NoteAccessService } from '../notes/services/note-access.service';
import { NoteState, NoteSharePermission } from 'src/generated/prisma/enums';
import { AiClient } from './ai-client.service';
import { AiPreferencesService } from './ai-preferences.service';
import { AI_CONSTANTS, chunkCharBudget } from './ai.constants';
import { acceptedEdits, acceptedTagIds, parseJsonObject } from './ai-parser';
import { chunkSegments, proseSegments, tagExcerpt } from './prose';
import { repairPrompt, spellingPrompt, tagPrompt } from './prompts';
import {
  AiError,
  type AiAnalysis,
  type AiOperation,
  type ProseSegment,
  type SpellingCoverage,
  type SpellingEdit,
} from './ai.types';

const TAG_SHAPE = '{"tagIds":["..."]}';
const SPELLING_SHAPE =
  '{"edits":[{"segmentId":"s1","original":"teh","replacement":"the"}]}';

/** One completion, retried once only if the answer cannot be parsed. */
async function askForJson(
  client: AiClient,
  messages: Parameters<AiClient['complete']>[0],
  shape: string,
  maxTokens: number,
  signal?: AbortSignal,
): Promise<Record<string, unknown>> {
  const first = parseJsonObject(
    await client.complete(messages, maxTokens, signal),
  );
  if (first !== null) return first;

  const retried = parseJsonObject(
    await client.complete(repairPrompt(messages, shape), maxTokens, signal),
  );
  if (retried === null) {
    throw new AiError(
      'AI_INVALID_OUTPUT',
      'The model did not return usable JSON.',
    );
  }
  return retried;
}

@Injectable()
export class AiAnalysisService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: NoteAccessService,
    private readonly client: AiClient,
    private readonly preferences: AiPreferencesService,
  ) {}

  /** Read-only: no note, revision or tag row is written here. */
  async analyze(
    userId: string,
    noteId: string,
    operation: AiOperation,
    baseVersion: number,
    signal?: AbortSignal,
  ): Promise<AiAnalysis> {
    const prefs = await this.preferences.assertAllowed(userId, operation);

    await this.access.ensureNoteAccess(
      userId,
      noteId,
      operation === 'spelling'
        ? NoteSharePermission.editor
        : NoteSharePermission.viewer,
    );
    await this.access.ensureNoteIsActive(noteId);

    const note = await this.prisma.note.findFirst({
      where: { id: noteId, state: { not: NoteState.deleted } },
      select: { id: true, title: true, content: true, version: true },
    });
    if (!note) {
      throw new AiError('AI_NOTE_NOT_ACTIVE', 'Note not found.');
    }
    if (note.version !== baseVersion) {
      throw new AiError(
        'AI_STALE_SNAPSHOT',
        'The note changed before it could be analysed.',
      );
    }

    const prose = proseSegments(note.content);
    if (prose.invalid) {
      throw new AiError(
        'AI_INVALID_OUTPUT',
        'This note’s content could not be read.',
      );
    }

    const analysis: AiAnalysis = {
      noteId,
      baseVersion: note.version,
      tagIds: [],
      edits: [],
      coverage: null,
      warnings: [],
    };

    if (operation === 'tags') {
      analysis.tagIds = await this.suggestTags(
        userId,
        note.title,
        prose.segments,
        signal,
      );
      return analysis;
    }

    const [edits, coverage, warnings] = await this.suggestSpelling(
      prose.segments,
      prose.totalChars,
      prefs.locale,
      signal,
    );
    analysis.edits = edits;
    analysis.coverage = coverage;
    analysis.warnings = warnings;
    return analysis;
  }

  private async suggestTags(
    userId: string,
    title: string,
    segments: ProseSegment[],
    signal?: AbortSignal,
  ): Promise<string[]> {
    const tags = await this.prisma.tag.findMany({
      where: { userId, isDeleted: false },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
      take: AI_CONSTANTS.MAX_TAG_VOCABULARY,
    });
    // Nothing to choose from: do not spend a completion inventing categories.
    if (tags.length === 0) return [];

    const excerpt = tagExcerpt(
      title,
      segments,
      AI_CONSTANTS.MAX_TAG_EXCERPT_CHARS,
    );
    const raw = await askForJson(
      this.client,
      tagPrompt(excerpt, tags),
      TAG_SHAPE,
      200,
      signal,
    );
    // Pass the names too: models often echo a name instead of the id.
    return acceptedTagIds(raw, tags);
  }

  private async suggestSpelling(
    segments: ProseSegment[],
    totalChars: number,
    locale: string,
    signal?: AbortSignal,
  ): Promise<[SpellingEdit[], SpellingCoverage, string[]]> {
    const warnings: string[] = [];
    const budget = chunkCharBudget(this.client.settings.contextTokens);
    const chunks = chunkSegments(segments, budget, AI_CONSTANTS.MAX_CHUNKS);

    const analyzedChars = chunks
      .flat()
      .reduce((sum, segment) => sum + segment.text.length, 0);
    const complete = analyzedChars >= totalChars;

    if (!complete) {
      warnings.push(
        'Only part of this note was checked. Correct the rest in sections.',
      );
    }

    const edits: SpellingEdit[] = [];
    let failures = 0;

    // Sequential on purpose: one small model, no thundering herd.
    for (const chunk of chunks) {
      const byId = new Map(chunk.map((segment) => [segment.id, segment]));
      try {
        const raw = await askForJson(
          this.client,
          spellingPrompt(
            chunk.map(({ id, text }) => ({ id, text })),
            locale,
          ),
          SPELLING_SHAPE,
          800,
          signal,
        );
        edits.push(...acceptedEdits(raw, byId));
      } catch (error) {
        if (error instanceof AiError && error.code === 'AI_INVALID_OUTPUT') {
          failures += 1;
          continue;
        }
        throw error;
      }
    }

    if (failures > 0 && failures === chunks.length) {
      throw new AiError(
        'AI_INVALID_OUTPUT',
        'The model did not return usable corrections.',
      );
    }

    if (failures > 0) {
      warnings.push(
        `${failures} section${failures === 1 ? '' : 's'} could not be checked.`,
      );
    }

    return [
      edits,
      {
        complete: complete && failures === 0,
        chunks: chunks.length,
        analyzedChars,
        totalChars,
      },
      warnings,
    ];
  }
}
