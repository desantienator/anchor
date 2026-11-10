import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { AiConfig, AppConfig, StorageConfig } from './configuration';

describe('configuration namespaces', () => {
  const original = process.env;

  beforeEach(() => {
    process.env = { ...original };
    delete process.env.DATA_DIR;
    delete process.env.CORS_ORIGINS;
    delete process.env.APP_URL;
    delete process.env.PORT;
    delete process.env.AI_ENABLED;
    delete process.env.AI_BASE_URL;
    delete process.env.AI_MODEL;
    delete process.env.AI_API_KEY;
    delete process.env.AI_TIMEOUT_MS;
    delete process.env.AI_CONTEXT_TOKENS;
  });

  describe('AiConfig', () => {
    it('stays off until both a URL and a model are set', () => {
      process.env.AI_ENABLED = 'true';
      expect(AiConfig().enabled).toBe(false);

      process.env.AI_BASE_URL = 'http://model:11434/v1';
      expect(AiConfig().enabled).toBe(false);

      process.env.AI_MODEL = 'tiny';
      expect(AiConfig()).toMatchObject({
        enabled: true,
        baseUrl: 'http://model:11434/v1',
        model: 'tiny',
        apiKey: null,
      });
    });

    it('honours the explicit off switch', () => {
      process.env.AI_ENABLED = 'false';
      process.env.AI_BASE_URL = 'http://model:11434/v1';
      process.env.AI_MODEL = 'tiny';

      expect(AiConfig().enabled).toBe(false);
    });

    it('strips trailing slashes so the path appends once', () => {
      process.env.AI_BASE_URL = 'http://model:11434/v1///';

      expect(AiConfig().baseUrl).toBe('http://model:11434/v1');
    });

    it('falls back to defaults for blank limits', () => {
      process.env.AI_TIMEOUT_MS = '';
      process.env.AI_CONTEXT_TOKENS = '';

      expect(AiConfig()).toMatchObject({
        timeoutMs: 120_000,
        contextTokens: 8192,
      });
    });
  });

  afterAll(() => {
    process.env = original;
  });

  describe('StorageConfig', () => {
    it('derives upload paths from the default data dir', () => {
      const storageConfig = StorageConfig();

      expect(storageConfig.root).toBe('/data');
      expect(storageConfig.uploadsDir).toBe('/data/uploads');
      expect(storageConfig.profilesDir).toBe('/data/uploads/profiles');
      expect(storageConfig.attachmentsDir).toBe('/data/uploads/attachments');
    });

    it('honors a DATA_DIR override', () => {
      process.env.DATA_DIR = '/srv/anchor';

      const storageConfig = StorageConfig();

      expect(storageConfig.root).toBe('/srv/anchor');
      expect(storageConfig.profilesDir).toBe('/srv/anchor/uploads/profiles');
    });
  });

  describe('AppConfig', () => {
    it('defaults to no CORS allowlist and the default app URL', () => {
      const appConfig = AppConfig();

      expect(appConfig.corsOrigins).toEqual([]);
      expect(appConfig.appUrl).toBe('http://localhost:3000');
      expect(appConfig.port).toBe(3001);
    });

    it('splits and trims a comma-separated CORS allowlist', () => {
      process.env.CORS_ORIGINS = 'https://a.com, https://b.com ,';

      expect(AppConfig().corsOrigins).toEqual([
        'https://a.com',
        'https://b.com',
      ]);
    });

    it('strips trailing slashes from APP_URL', () => {
      process.env.APP_URL = 'https://notes.example.com/';

      expect(AppConfig().appUrl).toBe('https://notes.example.com');
    });
  });
});
