import { Controller, Post, UseGuards } from '@nestjs/common';
import { AdminGuard } from '../admin/admin.guard';
import { AiClient } from './ai-client.service';
import { AiError } from './ai.types';

const PROBE_TIMEOUT_MS = 30_000;

/**
 * Checks the configured endpoint with a tiny completion. It does not use a
 * `/models` listing: several servers omit or misreport that route.
 */
@Controller('api/admin/ai')
@UseGuards(AdminGuard)
export class AdminAiController {
  constructor(private readonly client: AiClient) {}

  @Post('test')
  async test() {
    if (!this.client.settings.enabled) {
      throw new AiError('AI_DISABLED', 'Local AI is not configured.');
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
    try {
      const reply = await this.client.complete(
        [
          { role: 'system', content: 'Reply with the single word OK.' },
          { role: 'user', content: 'ping' },
        ],
        8,
        controller.signal,
      );
      return {
        ok: true,
        model: this.client.settings.model,
        reply: reply.slice(0, 40),
      };
    } finally {
      clearTimeout(timer);
    }
  }
}
