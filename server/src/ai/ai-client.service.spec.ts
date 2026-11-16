import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ConfigType } from '@nestjs/config';
import { AiClient } from './ai-client.service';
import type { AiConfig } from '../config/configuration';

function makeClient(
  overrides: Partial<ConfigType<typeof AiConfig>> = {},
): AiClient {
  const config: ConfigType<typeof AiConfig> = {
    enabled: true,
    baseUrl: 'http://model.test/v1',
    model: 'tiny',
    apiKey: null,
    timeoutMs: 50,
    contextTokens: 8192,
    ...overrides,
  };
  return new AiClient(config);
}

/**
 * A fetch mock that hangs until the passed signal aborts, then rejects
 * with an AbortError — mimicking a slow-but-alive model endpoint.
 */
function hangingFetch() {
  return vi.fn(
    (_url: string, init: { signal?: AbortSignal }) =>
      new Promise<never>((_, reject) => {
        init.signal?.addEventListener(
          'abort',
          () =>
            reject(
              new DOMException('The operation was aborted.', 'AbortError'),
            ),
          { once: true },
        );
      }),
  );
}

describe('AiClient.complete – timeout error mapping', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('AI_TIMEOUT when the internal timer fires with no external abort', async () => {
    vi.stubGlobal('fetch', hangingFetch());
    const client = makeClient({ timeoutMs: 30 });

    await expect(
      client.complete([{ role: 'user', content: 'hi' }], 8),
    ).rejects.toMatchObject({ code: 'AI_TIMEOUT' });
  }, 200);

  it('AI_TIMEOUT when the caller signal aborts while the model is still responding', async () => {
    // Simulates the admin probe: the caller sets a 30 s timeout, the
    // client's own timeout is 120 s. The probe timer fires first; the
    // model is alive but slow. The error must be AI_TIMEOUT, not
    // AI_UNREACHABLE.
    vi.stubGlobal('fetch', hangingFetch());
    const client = makeClient({ timeoutMs: 100 }); // longer than the external abort

    const external = new AbortController();
    setTimeout(() => external.abort(), 20); // external aborts at 20 ms

    await expect(
      client.complete([{ role: 'user', content: 'ping' }], 8, external.signal),
    ).rejects.toMatchObject({ code: 'AI_TIMEOUT' });
  }, 200);

  it('AI_UNREACHABLE on a plain network error (no abort)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => {
        throw new TypeError('fetch failed');
      }),
    );
    const client = makeClient({ timeoutMs: 1000 });

    await expect(
      client.complete([{ role: 'user', content: 'hi' }], 8),
    ).rejects.toMatchObject({ code: 'AI_UNREACHABLE' });
  });
});
