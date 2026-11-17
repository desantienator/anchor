import { describe, expect, it, vi } from 'vitest';
import type { ConfigType } from '@nestjs/config';
import type { AiConfig } from '../config/configuration';
import { AiClient } from './ai-client.service';
import { AiPreferencesService } from './ai-preferences.service';
import { AiError } from './ai.types';
import type { PrismaService } from '../prisma/prisma.service';

const env = (
  overrides: Partial<ConfigType<typeof AiConfig>> = {},
): ConfigType<typeof AiConfig> => ({
  enabled: true,
  explicitlyDisabled: false,
  baseUrl: 'http://env.test/v1',
  model: 'env-model',
  apiKey: 'env-key',
  timeoutMs: 5000,
  contextTokens: 8192,
  ...overrides,
});

const row = (overrides: Record<string, unknown> = {}) => ({
  enabled: false,
  taggingEnabled: true,
  spellingEnabled: true,
  onSaveEnabled: false,
  autoApplyTags: false,
  locale: 'en',
  consentedConfigKey: null,
  baseUrl: null,
  model: null,
  apiKey: null,
  ...overrides,
});

function makeHarness(rows: Record<string, Record<string, unknown>> = {}) {
  const stored: Record<string, Record<string, unknown>> = {};
  const upserts: Array<{
    where: { userId: string };
    create: Record<string, unknown>;
    update: Record<string, unknown>;
  }> = [];
  const prisma = {
    userAiPreferences: {
      findUnique: vi.fn(async ({ where: { userId } }: { where: { userId: string } }) => {
        const seed = rows[userId];
        if (!seed && !(userId in stored)) return null;
        return { ...row(), ...seed, ...stored[userId] };
      }),
      upsert: vi.fn(
        async ({
          where: { userId },
          create,
          update,
        }: {
          where: { userId: string };
          create: Record<string, unknown>;
          update: Record<string, unknown>;
        }) => {
          upserts.push({ where: { userId }, create, update });
          stored[userId] = { ...create, ...update };
        },
      ),
    },
  } as unknown as PrismaService;
  const config = env();
  const service = new AiPreferencesService(
    prisma,
    new AiClient(config),
    config,
  );
  return { service, config, upserts, prisma };
}

describe('AiPreferencesService.effectiveConfig', () => {
  it('falls back to the server values when the person has no overrides', async () => {
    const { service } = makeHarness();
    const effective = await service.effectiveConfig('user-1');
    expect(effective).toMatchObject({
      baseUrl: 'http://env.test/v1',
      model: 'env-model',
      apiKey: 'env-key',
      timeoutMs: 5000,
      configured: true,
      source: {
        baseUrl: 'environment',
        model: 'environment',
        apiKey: 'environment',
      },
    });
  });

  it('the person’s own values beat the server’s, field by field', async () => {
    const { service } = makeHarness({
      'user-1': { baseUrl: 'http://mine.test/v1', apiKey: 'mine' },
    });
    const effective = await service.effectiveConfig('user-1');
    expect(effective).toMatchObject({
      baseUrl: 'http://mine.test/v1',
      model: 'env-model',
      apiKey: 'mine',
      source: { baseUrl: 'user', model: 'environment', apiKey: 'user' },
    });
  });

  it('is not configured when there is no destination anywhere', async () => {
    const config = env({ baseUrl: '', model: '', enabled: false });
    const { prisma } = makeHarness();
    const service = new AiPreferencesService(
      prisma,
      new AiClient(config),
      config,
    );
    expect((await service.effectiveConfig('user-1')).configured).toBe(false);
  });

  it('AI_ENABLED=false disables even a person’s own endpoint', async () => {
    const config = env({ explicitlyDisabled: true, enabled: false });
    const { prisma } = makeHarness({
      'user-1': { baseUrl: 'http://mine.test/v1', model: 'mine' },
    });
    const disabled = new AiPreferencesService(
      prisma,
      new AiClient(config),
      config,
    );
    expect((await disabled.effectiveConfig('user-1')).configured).toBe(false);
  });
});

describe('AiPreferencesService.find', () => {
  it('exposes the effective destination and per-field sources, never the raw key', async () => {
    const { service } = makeHarness({
      'user-1': { baseUrl: 'http://mine.test/v1', apiKey: 'mine' },
    });
    const prefs = await service.find('user-1');
    expect(prefs.baseUrl).toBe('http://mine.test/v1');
    expect(prefs.model).toBe('env-model');
    expect(prefs.hasApiKey).toBe(true);
    expect(prefs.source).toEqual({
      baseUrl: 'user',
      model: 'environment',
      apiKey: 'user',
    });
    expect('apiKey' in prefs).toBe(false);
  });

  it('requires consent again when the effective destination changed', async () => {
    // Agreed to the server default, then the person saved their own endpoint.
    const { service } = makeHarness({
      'user-1': {
        enabled: true,
        consentedConfigKey: 'http://env.test/v1|env-model',
        baseUrl: 'http://mine.test/v1',
      },
    });
    expect((await service.find('user-1')).consentRequired).toBe(true);
  });

  it('does not require consent when the effective destination is unchanged', async () => {
    const { service } = makeHarness({
      'user-1': {
        enabled: true,
        consentedConfigKey: 'http://env.test/v1|env-model',
      },
    });
    expect((await service.find('user-1')).consentRequired).toBe(false);
  });
});

describe('AiPreferencesService.update', () => {
  it('stores trimmed endpoint overrides', async () => {
    const { service, upserts } = makeHarness();
    await service.update('user-1', { baseUrl: '  http://mine.test/v1  ' });
    expect(upserts.at(-1)?.update).toMatchObject({
      baseUrl: 'http://mine.test/v1',
    });
  });

  it('an empty string clears the override', async () => {
    const { service, upserts } = makeHarness({
      'user-1': { baseUrl: 'http://mine.test/v1', apiKey: 'mine' },
    });
    await service.update('user-1', { baseUrl: '   ', apiKey: '' });
    expect(upserts.at(-1)?.update).toMatchObject({
      baseUrl: null,
      apiKey: null,
    });
  });

  it('leaves the override untouched when the field is absent', async () => {
    const { service, upserts } = makeHarness({
      'user-1': { baseUrl: 'http://mine.test/v1' },
    });
    await service.update('user-1', { model: 'other' });
    const update = upserts.at(-1)?.update as Record<string, unknown>;
    expect(update).toMatchObject({ model: 'other' });
    expect(update).not.toHaveProperty('baseUrl');
  });

  it('records consent against the effective destination, not the server’s', async () => {
    const { service, upserts } = makeHarness({
      'user-1': {
        baseUrl: 'http://mine.test/v1',
        model: 'mine-model',
        enabled: false,
      },
    });
    await service.update('user-1', { consent: true });
    expect(upserts.at(-1)?.update?.consentedConfigKey).toBe(
      'http://mine.test/v1|mine-model',
    );
  });

  it('enabling records consent against the effective destination', async () => {
    const { service, upserts } = makeHarness();
    await service.update('user-1', { enabled: true });
    expect(upserts.at(-1)?.update?.consentedConfigKey).toBe(
      'http://env.test/v1|env-model',
    );
  });
});

describe('AiPreferencesService.assertAllowed', () => {
  it('refuses when no destination is configured anywhere', async () => {
    const config = env({ baseUrl: '', model: '', enabled: false });
    const { prisma } = makeHarness();
    const service = new AiPreferencesService(
      prisma,
      new AiClient(config),
      config,
    );
    await expect(service.assertAllowed('user-1', 'tags')).rejects.toMatchObject(
      { code: 'AI_DISABLED' },
    );
  });

  it('allows once the person has agreed to the effective destination', async () => {
    const { service } = makeHarness({
      'user-1': {
        enabled: true,
        consentedConfigKey: 'http://env.test/v1|env-model',
      },
    });
    await expect(
      service.assertAllowed('user-1', 'tags'),
    ).resolves.toMatchObject({ enabled: true });
  });

  it('blocks when the effective destination changed since consent', async () => {
    const { service } = makeHarness({
      'user-1': {
        enabled: true,
        consentedConfigKey: 'http://old.test/v1|old-model',
      },
    });
    await expect(
      service.assertAllowed('user-1', 'spelling'),
    ).rejects.toMatchObject({
      code: 'AI_NOT_OPTED_IN',
    });
  });
});
