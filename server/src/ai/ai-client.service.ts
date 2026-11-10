import { Inject, Injectable, Logger } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { AiConfig } from '../config/configuration';
import { AI_CONSTANTS } from './ai.constants';
import { AiError } from './ai.types';

export interface ChatMessage {
  role: 'system' | 'user';
  content: string;
}

/**
 * Reads `choices[0].message.content` from an untrusted provider body, which
 * may be a string or an array of text parts.
 */
function choiceContent(body: unknown): string {
  if (!body || typeof body !== 'object' || !('choices' in body)) return '';
  const { choices } = body;
  if (!Array.isArray(choices) || choices.length === 0) return '';
  const choice: unknown = choices[0];
  if (!choice || typeof choice !== 'object' || !('message' in choice))
    return '';
  const { message } = choice;
  if (!message || typeof message !== 'object' || !('content' in message))
    return '';
  const { content } = message;
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  const parts: unknown[] = content;
  return parts
    .map((part) => {
      if (!part || typeof part !== 'object' || !('text' in part)) return '';
      const { text } = part;
      return typeof text === 'string' ? text : '';
    })
    .join('');
}

/**
 * Talks to an OpenAI-compatible chat-completions endpoint. Only the plain
 * `messages`/`choices` shape is required, so Ollama, LM Studio, llama.cpp and
 * vLLM all work; no vendor SDK, tools or structured-output extension.
 */
@Injectable()
export class AiClient {
  private readonly logger = new Logger(AiClient.name);
  private active = 0;
  private queued = 0;

  constructor(
    @Inject(AiConfig.KEY)
    private readonly config: ConfigType<typeof AiConfig>,
  ) {}

  get settings() {
    return this.config;
  }

  /** A stable identifier for the configured destination and model. */
  configKey(): string {
    return `${this.config.baseUrl}|${this.config.model}`;
  }

  /** Completes one request; `signal` lets a disconnecting client stop it. */
  async complete(
    messages: ChatMessage[],
    maxTokens: number,
    signal?: AbortSignal,
  ): Promise<string> {
    if (!this.config.enabled) {
      throw new AiError('AI_DISABLED', 'Local AI is not configured.');
    }

    return this.withSlot(async () => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.config.timeoutMs);
      const forward = () => controller.abort();
      signal?.addEventListener('abort', forward, { once: true });

      try {
        const response = await fetch(
          `${this.config.baseUrl}/chat/completions`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              ...(this.config.apiKey
                ? { Authorization: `Bearer ${this.config.apiKey}` }
                : {}),
            },
            body: JSON.stringify({
              model: this.config.model,
              messages,
              temperature: 0,
              max_tokens: maxTokens,
              stream: false,
            }),
            redirect: 'error',
            signal: controller.signal,
          },
        );

        if (!response.ok) {
          // The provider's body may quote the prompt; log the status only.
          this.logger.warn(`AI provider returned ${response.status}`);
          throw this.statusError(response.status);
        }

        const body = await this.readBounded(response);
        return this.contentOf(body);
      } catch (error) {
        if (error instanceof AiError) throw error;
        if (controller.signal.aborted && !signal?.aborted) {
          throw new AiError('AI_TIMEOUT', 'Local AI took too long to answer.');
        }
        throw new AiError('AI_UNREACHABLE', 'Local AI is not reachable.');
      } finally {
        clearTimeout(timer);
        signal?.removeEventListener('abort', forward);
      }
    });
  }

  private statusError(status: number): AiError {
    if (status === 401 || status === 403) {
      return new AiError('AI_AUTH_FAILED', 'Local AI rejected the API key.');
    }
    if (status === 404) {
      return new AiError('AI_MODEL_NOT_FOUND', 'The AI model was not found.');
    }
    if (status === 429) {
      return new AiError('AI_BUSY', 'Local AI is busy. Try again shortly.');
    }
    if (status === 413) {
      return new AiError(
        'AI_CONTEXT_LIMIT',
        'The note is too long for the model.',
      );
    }
    return new AiError('AI_UNREACHABLE', 'Local AI returned an error.');
  }

  private async readBounded(response: Response): Promise<unknown> {
    const declared = Number(response.headers.get('content-length') ?? '0');
    if (declared > AI_CONSTANTS.MAX_RESPONSE_BYTES) {
      throw new AiError('AI_INVALID_OUTPUT', 'The AI answer was too large.');
    }

    const text = await response.text();
    if (text.length > AI_CONSTANTS.MAX_RESPONSE_BYTES) {
      throw new AiError('AI_INVALID_OUTPUT', 'The AI answer was too large.');
    }

    try {
      return JSON.parse(text) as unknown;
    } catch {
      throw new AiError('AI_INVALID_OUTPUT', 'The AI answer was not JSON.');
    }
  }

  private contentOf(body: unknown): string {
    const content = choiceContent(body);
    if (!content.trim()) {
      throw new AiError('AI_INVALID_OUTPUT', 'The AI answer was empty.');
    }
    return content;
  }

  /**
   * Caps in-flight analyses so a batch cannot swamp a small local model. The
   * queue is bounded too: waiting forever is worse than a clear busy error.
   */
  private async withSlot<T>(work: () => Promise<T>): Promise<T> {
    if (this.active >= AI_CONSTANTS.MAX_CONCURRENT_REQUESTS) {
      if (this.queued >= AI_CONSTANTS.MAX_QUEUED_REQUESTS) {
        throw new AiError('AI_BUSY', 'Local AI has too much queued work.');
      }
      this.queued += 1;
      try {
        while (this.active >= AI_CONSTANTS.MAX_CONCURRENT_REQUESTS) {
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
      } finally {
        this.queued -= 1;
      }
    }

    this.active += 1;
    try {
      return await work();
    } finally {
      this.active -= 1;
    }
  }
}
