import { registerAs } from '@nestjs/config';
import * as path from 'path';

const DEFAULT_DATA_DIR = '/data';
const DEFAULT_APP_URL = 'http://localhost:3000';
const DEFAULT_PORT = 3001;

export const AppConfig = registerAs('app', () => ({
  port: parseInt(process.env.PORT ?? String(DEFAULT_PORT), 10),
  appUrl: (process.env.APP_URL?.trim() || DEFAULT_APP_URL).replace(/\/+$/, ''),
  corsOrigins:
    process.env.CORS_ORIGINS?.split(',')
      .map((origin) => origin.trim())
      .filter(Boolean) ?? [],
}));

export const DatabaseConfig = registerAs('database', () => ({
  url: process.env.DATABASE_URL,
}));

export const AuthConfig = registerAs('auth', () => ({
  jwtSecret: process.env.JWT_SECRET as string,
}));

export const StorageConfig = registerAs('storage', () => {
  const root = process.env.DATA_DIR?.trim() || DEFAULT_DATA_DIR;
  const uploadsDir = path.join(root, 'uploads');
  return {
    root,
    uploadsDir,
    profilesDir: path.join(uploadsDir, 'profiles'),
    attachmentsDir: path.join(uploadsDir, 'attachments'),
  };
});

const DEFAULT_AI_TIMEOUT_MS = 120_000;
const DEFAULT_AI_CONTEXT_TOKENS = 8192;

/** Empty or unparseable values fall back to the default. */
function intFromEnv(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

// An OpenAI-compatible chat-completions endpoint, reached from the server.
// Disabled unless a base URL and model are both set.
export const AiConfig = registerAs('ai', () => {
  const baseUrl = (process.env.AI_BASE_URL?.trim() ?? '').replace(/\/+$/, '');
  const model = process.env.AI_MODEL?.trim() ?? '';
  return {
    enabled: process.env.AI_ENABLED === 'true' && !!baseUrl && !!model,
    baseUrl,
    model,
    apiKey: process.env.AI_API_KEY?.trim() || null,
    timeoutMs: intFromEnv(process.env.AI_TIMEOUT_MS, DEFAULT_AI_TIMEOUT_MS),
    contextTokens: intFromEnv(
      process.env.AI_CONTEXT_TOKENS,
      DEFAULT_AI_CONTEXT_TOKENS,
    ),
  };
});

export const configurations = [
  AppConfig,
  DatabaseConfig,
  AuthConfig,
  StorageConfig,
  AiConfig,
];
