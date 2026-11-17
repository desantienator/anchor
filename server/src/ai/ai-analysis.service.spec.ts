import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConfigType } from '@nestjs/config';
import { AiClient } from './ai-client.service';
import { AiAnalysisService } from './ai-analysis.service';
import {
  AiPreferencesService,
  type AiEffectiveConfig,
} from './ai-preferences.service';
import { AiError } from './ai.types';
import type { AiConfig } from '../config/configuration';
import type { PrismaService } from '../prisma/prisma.service';
import type { NoteAccessService } from '../notes/services/note-access.service';

const settings = (
  overrides: Partial<ConfigType<typeof AiConfig>> = {},
): ConfigType<typeof AiConfig> => ({
  enabled: true,
  explicitlyDisabled: false,
  baseUrl: 'http://model.test/v1',
  model: 'tiny',
  apiKey: null,
  timeoutMs: 5000,
  contextTokens: 8192,
  ...overrides,
});

/** The server's own configuration expressed as an effective config. */
function effectiveFromSettings(
  cfg: ConfigType<typeof AiConfig>,
): AiEffectiveConfig {
  return {
    baseUrl: cfg.baseUrl || null,
    model: cfg.model || null,
    apiKey: cfg.apiKey,
    timeoutMs: cfg.timeoutMs,
    configured: cfg.enabled,
    source: {
      baseUrl: cfg.baseUrl ? 'environment' : 'none',
      model: cfg.model ? 'environment' : 'none',
      apiKey: cfg.apiKey ? 'environment' : 'none',
    },
  };
}

const content = (text: string) =>
  JSON.stringify({ ops: [{ insert: `${text}\n` }] });

interface Harness {
  service: AiAnalysisService;
  client: AiClient;
  prisma: ReturnType<typeof fakePrisma>;
  preferences: ReturnType<typeof fakePreferences>;
}

function fakePrisma(note: { title: string; content: string; version: number }) {
  return {
    note: {
      findFirst: vi.fn().mockResolvedValue({
        id: 'note-1',
        ...note,
      }),
    },
    tag: {
      findMany: vi.fn().mockResolvedValue([
        { id: 'tag-1', name: 'Home' },
        { id: 'tag-2', name: 'Work' },
      ]),
    },
  };
}

function fakePreferences(effective: AiEffectiveConfig) {
  const assertAllowed = vi.fn(async () => {
    if (!effective.configured) {
      throw new AiError(
        'AI_DISABLED',
        'Local AI is not configured on this server.',
      );
    }
    return { locale: 'en-AU', ...effective };
  });
  return {
    assertAllowed,
    effectiveConfig: vi.fn().mockResolvedValue(effective),
  };
}

function harness(
  note: { title: string; content: string; version: number },
  configOverrides: Partial<ConfigType<typeof AiConfig>> = {},
  effective?: AiEffectiveConfig,
): Harness {
  const prisma = fakePrisma(note);
  const cfg = settings(configOverrides);
  const client = new AiClient(cfg);
  const preferences = fakePreferences(
    effective ?? effectiveFromSettings(cfg),
  );
  const access = {
    ensureNoteAccess: vi.fn().mockResolvedValue({ hasAccess: true }),
    ensureNoteIsActive: vi.fn().mockResolvedValue(undefined),
  };
  const service = new AiAnalysisService(
    prisma as unknown as PrismaService,
    access as unknown as NoteAccessService,
    client,
    preferences as unknown as AiPreferencesService,
  );
  return { service, client, prisma, preferences };
}

const reply = (answer: unknown) =>
  new Response(
    JSON.stringify({
      choices: [{ message: { content: JSON.stringify(answer) } }],
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );

describe('AiAnalysisService', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  it('only suggests tags the person owns', async () => {
    fetchMock.mockResolvedValueOnce(
      reply({ tagIds: ['tag-2', 'someone-elses'] }),
    );
    const { service } = harness({
      title: 'Shopping',
      content: content('milk and bread'),
      version: 3,
    });

    const result = await service.analyze('user-1', 'note-1', 'tags', 3);

    expect(result.tagIds).toEqual(['tag-2']);
    expect(result.baseVersion).toBe(3);
  });

  it('does not call the model when there are no tags to choose from', async () => {
    const { service, prisma } = harness({
      title: 'Shopping',
      content: content('milk'),
      version: 3,
    });
    prisma.tag.findMany.mockResolvedValue([]);

    await expect(
      service.analyze('user-1', 'note-1', 'tags', 3),
    ).resolves.toMatchObject({ tagIds: [] });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns exact spelling patches and reports full coverage', async () => {
    fetchMock.mockResolvedValueOnce(
      reply({
        edits: [{ segmentId: 's0', original: 'teh', replacement: 'the' }],
      }),
    );
    const { service } = harness({
      title: 'Note',
      content: content('teh cat'),
      version: 1,
    });

    const result = await service.analyze('user-1', 'note-1', 'spelling', 1);

    expect(result.edits).toEqual([
      {
        segmentId: 's0',
        start: 0,
        length: 3,
        original: 'teh',
        replacement: 'the',
      },
    ]);
    expect(result.coverage).toMatchObject({ complete: true, chunks: 1 });
  });

  it('retries one malformed answer, then fails without applying anything', async () => {
    fetchMock
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ choices: [{ message: { content: 'not json' } }] }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            choices: [{ message: { content: 'still not json' } }],
          }),
          { status: 200 },
        ),
      );
    const { service } = harness({
      title: 'Note',
      content: content('teh cat'),
      version: 1,
    });

    await expect(
      service.analyze('user-1', 'note-1', 'spelling', 1),
    ).rejects.toMatchObject({ code: 'AI_INVALID_OUTPUT' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('accepts a fenced JSON answer from a small model', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: '```json\n{"tagIds":["tag-1"]}\n```',
              },
            },
          ],
        }),
        { status: 200 },
      ),
    );
    const { service } = harness({
      title: 'Shopping',
      content: content('milk'),
      version: 1,
    });

    await expect(
      service.analyze('user-1', 'note-1', 'tags', 1),
    ).resolves.toMatchObject({ tagIds: ['tag-1'] });
  });

  it('rejects a stale snapshot before any inference', async () => {
    const { service } = harness({
      title: 'Note',
      content: content('teh cat'),
      version: 4,
    });

    await expect(
      service.analyze('user-1', 'note-1', 'spelling', 3),
    ).rejects.toMatchObject({ code: 'AI_STALE_SNAPSHOT' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('maps provider failures to stable codes', async () => {
    fetchMock.mockResolvedValueOnce(new Response('{}', { status: 401 }));
    const { service } = harness({
      title: 'Note',
      content: content('the cat'),
      version: 1,
    });

    await expect(
      service.analyze('user-1', 'note-1', 'spelling', 1),
    ).rejects.toMatchObject({ code: 'AI_AUTH_FAILED' });
  });

  it('refuses to run when the server has no endpoint configured', async () => {
    const { service } = harness(
      { title: 'Note', content: content('the cat'), version: 1 },
      { enabled: false },
    );

    await expect(
      service.analyze('user-1', 'note-1', 'spelling', 1),
    ).rejects.toBeInstanceOf(AiError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('surfaces an unreachable endpoint as a retryable message', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('fetch failed'));
    const { service } = harness({
      title: 'Note',
      content: content('the cat'),
      version: 1,
    });

    await expect(
      service.analyze('user-1', 'note-1', 'spelling', 1),
    ).rejects.toMatchObject({ code: 'AI_UNREACHABLE' });
  });
  it('sends completions to the person’s own endpoint when they override it', async () => {
    fetchMock.mockResolvedValueOnce(
      reply({
        edits: [{ segmentId: 's0', original: 'teh', replacement: 'the' }],
      }),
    );
    const personal: AiEffectiveConfig = {
      baseUrl: 'http://personal.test/v1',
      model: 'personal-model',
      apiKey: 'personal-key',
      timeoutMs: 5000,
      configured: true,
      source: { baseUrl: 'user', model: 'user', apiKey: 'user' },
    };
    const { service } = harness(
      { title: 'Note', content: content('teh cat'), version: 1 },
      {},
      personal,
    );

    await service.analyze('user-1', 'note-1', 'spelling', 1);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [
      string,
      { headers: { Authorization?: string }; body: string },
    ];
    expect(url).toBe('http://personal.test/v1/chat/completions');
    expect(init.headers.Authorization).toBe('Bearer personal-key');
    expect(JSON.parse(init.body).model).toBe('personal-model');
  });
});
